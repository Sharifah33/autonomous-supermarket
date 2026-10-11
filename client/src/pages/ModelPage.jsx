import React, { useState } from 'react';
import { useApi } from '../api.js';
import { CAT_COLORS, Loading, MISSION_LABEL, Page, Section, Stat, Stats, Table, money, num, pct, useRun } from '../ui.jsx';

const CAT = { DRK: 'Drinks', SNK: 'Snacks', DAI: 'Dairy & chilled', BAK: 'Bakery', FRS: 'Fresh produce', RTE: 'Ready-to-eat', PAN: 'Pantry', HHP: 'Household & personal' };

export default function ModelPage() {
  const { runId } = useRun();
  const meta = useApi(`/runs/${runId}`);
  const products = useApi(`/runs/${runId}/products`);
  return (
    <Page
      title="Model Declaration"
      intro={`The assumptions behind ${runId}, read from the configuration frozen when the run started. This is a pre-operational prototype: every number below is a modelling choice to be replaced by real operating data.`}
    >
      <Loading state={meta}>{(m) => <Declaration m={m} products={products.data} />}</Loading>
    </Page>
  );
}

function Declaration({ m, products }) {
  const c = m.config;
  const C = c.customers;
  const B = c.storeBrain;
  const [cat, setCat] = useState('');
  const peak = (hours) =>
    Object.entries(hours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([h]) => Number(h))
      .sort((a, b) => a - b)
      .map((h) => `${h}:00`)
      .join(' and ');
  const topCats = (cats) =>
    Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${CAT[k]} ${Math.round(v * 100)}%`)
      .join(', ');
  const util = (m.opening_inventory_cost / m.inventory_budget) * 100;

  return (
    <>
      <Section title="Run setup and client constraints">
        <Stats>
          <Stat label="Run ID" value={m.run_id} sub={m.is_submitted ? 'Submitted Run' : 'Verification run'} />
          <Stat label="Simulation period" value={`${m.horizon_days} days`} sub="Day 1 is a Monday" />
          <Stat label="Opening inventory" value={money(m.opening_inventory_cost, 2)} sub={`${pct(util)} of the ${money(m.inventory_budget)} budget; unused budget is not cash`} />
          <Stat label="Opening operating cash" value={money(m.opening_cash)} sub="available from Day 1 for replenishment only" />
          <Stat label="Products" value={products ? products.length : '-'} sub="8 categories" />
          <Stat label="Random seed" value={m.seed} sub={`model ${m.model_version}; configuration frozen ${new Date(m.created_at).toLocaleDateString('en-AU')}`} />
        </Stats>
        <div className="budget-bar" aria-label={`Opening inventory uses ${util.toFixed(1)}% of budget`}>
          <span style={{ width: `${util}%` }} />
        </div>
        <p className="note">
          Model boundary (from the brief): rent, fit-out, refrigeration, utilities, insurance, store hardware and corporate overhead are excluded. Opening inventory is funded from the inventory budget, not from operating cash.
        </p>
      </Section>

      <Section title="1. How customer activity is generated">
        <div className="prose">
          <p>
            Each day the store expects {C.baseWeekday} visits on a full-trading weekday and {C.baseWeekend} on a weekend day, scaled by a day-of-week factor (
            {Object.entries(C.dowFactor).map(([d, f], i) => `${i ? ', ' : ''}${d} ${f}`)}). The location is office-heavy, so weekday traffic is higher. As a new store it
            starts at {Math.round(C.rampStart * 100)}% of that level and ramps up linearly to 100% by Day {C.rampDays}. Day-to-day variation (weather, events and so on, not modelled
            separately) is a log-normal factor with σ = {C.dailyNoiseSigma}. The store trades {c.calendar.storeOpenHour}:00-{c.calendar.storeCloseHour}:00. There are no public holidays in the simulated calendar.
          </p>
          <p>Every visitor is given one shopping mission. The mission sets their arrival time, how many different products they want, and which categories they choose from:</p>
        </div>
        <Table
          columns={[
            { key: 'label', label: 'Mission' },
            { key: 'wd', label: 'Weekday share', num: true, render: (r) => pct(r.mix.weekday * 100, 0) },
            { key: 'we', label: 'Weekend share', num: true, render: (r) => pct(r.mix.weekend * 100, 0) },
            { key: 'lines', label: 'Products wanted', num: true, render: (r) => `${r.lines.min}-${r.lines.max} (mean ${r.lines.mean})` },
            { key: 'peak', label: 'Peak hours', render: (r) => peak(r.hours) },
            { key: 'cats', label: 'Main categories', render: (r) => topCats(r.categories) },
          ]}
          rows={Object.entries(c.missions).map(([k, v]) => ({ key: k, ...v, label: MISSION_LABEL[k] }))}
        />
      </Section>

      <Section title="2. How shopping behaviour and product demand are generated">
        <div className="prose">
          <p>
            For each product a customer wants, the model first draws a category using the mission's weights, then a product within that category in proportion to its
            popularity weight. Popularity is not uniform: for example, water and chocolate bars carry weights of 10 and 9, while olive oil and umbrellas carry 1 or less.
            Product demand therefore comes from who is shopping, when, and why, rather than from a fixed number of sales per product.
          </p>
          <p>
            Most lines are for one unit. Drinks have a {pct(c.quantity.twoUnitProb.DRK * 100, 0)} chance of two units and snacks {pct(c.quantity.twoUnitProb.SNK * 100, 0)};
            stock-up shoppers take two units {pct(c.quantity.twoUnitProb.STOCK_UP * 100, 0)} of the time. Fruit sold individually and cans are bought {c.quantity.multiUnitRange[0]}-{c.quantity.multiUnitRange[1]} at a time.
          </p>
          <p>
            A customer can only buy stock that is on the shelf and not expired. If their choice is sold out, they may take another product from the same category, with a
            probability that varies by category ({Object.entries(c.substitution.acceptProb).map(([k, v], i) => `${i ? ', ' : ''}${CAT[k]} ${Math.round(v * 100)}%`)}).
            Otherwise the demand is recorded as lost. If none of a customer's wanted products is available, they leave without a transaction. Prices are fixed: there are no markdowns or promotions.
          </p>
        </div>
      </Section>

      <Section title="3. How perishable stock and shelf life are handled">
        <div className="prose">
          <p>
            Every delivery (and the opening stock) is stored as a batch with a receipt day. A perishable batch received on day <i>d</i> with a shelf life of <i>L</i> days can be sold
            on days <i>d</i> to <i>d+L-1</i>; it is removed from sale and written off at cost at 06:30 on day <i>d+L</i>, before customers arrive. Sales draw on the
            first-expiring batch first (FEFO). Each morning the Brain warns about batches on their last saleable day when the units at risk exceed half a day's forecast.
            Shelf lives range from 1 day (sushi) and 2 days (sandwiches, wraps, croissants) to 45 days (butter). Packaged drinks, snacks, pantry and household goods are treated as non-perishable within the 60-day horizon.
          </p>
        </div>
      </Section>

      <Section title="4. How the Store Brain identifies stock, expiry and slow-moving conditions">
        <div className="prose">
          <p>
            The Brain never sees the demand model. It forecasts tomorrow's sales for each product from its last {B.forecastWindowDays} days of recorded sales, blended with the
            planner's pre-opening estimate, which counts as {B.priorWeightDays} days of evidence. A day on which the product sold out is scaled up by {B.censoredUplift}× because
            sales understate demand on that day. Sales are converted to weekday-equivalents using each category's observed weekend-to-weekday ratio over the last 14 days, so
            the forecast for a Saturday differs from the forecast for a Monday.
          </p>
          <ul>
            <li><b>Sold out:</b> the moment a product's stock reaches zero during trading it is recorded with the time, and it gets top ordering priority at close.</li>
            <li><b>Low stock:</b> usable stock at close is below {B.nonPerishable.lowStockDays} days of forecast (non-perishable) or {B.perishable.lowStockDays} day (perishable). Units that expire tomorrow morning do not count as usable.</li>
            <li><b>Expiry:</b> expired batches are removed before opening; near-expiry stock is flagged on its last saleable day.</li>
            <li><b>Slow-moving:</b> from Day {B.slowMover.minDay}, a non-perishable product holding more than {B.slowMover.coverDaysThreshold} days of cover at its last-{B.slowMover.lookbackDays}-day sales rate is flagged, and re-flagged every {B.slowMover.refreshEveryDays} days while the condition persists.</li>
            <li><b>Waste feedback:</b> if a perishable product wrote off more than {Math.round(B.waste.highWasteRate * 100)}% of its units over {B.waste.lookbackDays} days and has not sold out in the last 3 days, its order target is multiplied by {B.waste.stepDown} (minimum {B.waste.minFactor}). A later sell-out raises it again by ×{B.waste.stepUp}.</li>
          </ul>
        </div>
      </Section>

      <Section title="5. How replenishment is decided under the cash constraint">
        <div className="prose">
          <ul>
            <li><b>Daily cycle:</b> orders are placed at the 22:05 close review, their cost is deducted from operating cash immediately, and the stock is received at 06:00 the next day (a fixed 1-day lead time). No orders are placed after Day {c.horizonDays}.</li>
            <li><b>Non-perishable:</b> reorder when usable stock is at or below {B.nonPerishable.reorderPointDays} days of forecast, ordering up to {B.nonPerishable.orderUpToDays} days, rounded up to whole supplier cases.</li>
            <li><b>Perishable:</b> each day, order up to the forecast demand for the next min(shelf life − 1, {B.perishable.maxCoverDays}) days (at least 1) plus {Math.round(B.perishable.safetyFactor * 100)}% safety stock, times the waste factor. The order is capped at what can sell before the batch expires and rounded to the nearest case.</li>
            <li><b>Cash:</b> needs are ranked in priority order: sold-out first, then low stock, then perishable top-ups, then reorder-point items. Within each priority, products with the most expected gross profit come first. Orders are approved while cash stays above a {money(B.cashReserve)} reserve; an order that does not fit is cut to the cases that fit, or skipped, and the decision is recorded.</li>
          </ul>
        </div>
      </Section>

      <Section title="6. Other assumptions that materially affect the result">
        <div className="prose">
          <ul>
            <li><b>Opening inventory:</b> the planner's daily estimate × {c.openingInventory.nonPerishableCoverDays} days for non-perishables and × min(shelf life, {c.openingInventory.perishableCoverDays}) days for perishables, rounded up to whole cases, with at least {c.openingInventory.minCases} case of every product. The planner's estimates are deliberately independent of the demand model, so the run shows how the Brain recovers from a plan that is wrong in both directions.</li>
            <li><b>Prices and costs</b> are indicative 2026 Melbourne CBD convenience-supermarket prices, with category gross margins of about 32-60%. They are fixed for the whole run.</li>
            <li><b>Supplier</b> always delivers the full order on time. Case packs are the only ordering restriction.</li>
            <li><b>Not modelled:</b> theft and shrinkage, card fees, repeat-visit effects of stockouts, weather, public holidays and price elasticity.</li>
          </ul>
        </div>
      </Section>

      <Section title="Product data and opening inventory" note="Frozen copy of the product data used by this run. Runtime stock is not a product attribute; it comes from the movement history.">
        {products && (
          <>
            <div className="filters">
              <button type="button" className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>All</button>
              {[...new Set(products.map((p) => p.category))].map((k) => (
                <button key={k} type="button" className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>
                  <i className="dot" style={{ background: CAT_COLORS[k] }} />
                  {k}
                </button>
              ))}
            </div>
            <Table
              dense
              columns={[
                { key: 'product_id', label: 'ID' },
                { key: 'name', label: 'Product (pack size)' },
                { key: 'category', label: 'Category' },
                { key: 'unit_cost', label: 'Unit cost', num: true, render: (r) => money(r.unit_cost, 2) },
                { key: 'unit_price', label: 'Price', num: true, render: (r) => money(r.unit_price, 2) },
                { key: 'perishable', label: 'Perishable', render: (r) => (r.perishable ? 'Yes' : 'No') },
                { key: 'shelf_life_days', label: 'Shelf life', num: true, render: (r) => (r.shelf_life_days ? `${r.shelf_life_days} d` : '-') },
                { key: 'case_size', label: 'Case', num: true },
                { key: 'plan_daily_units', label: 'Plan / day', num: true },
                { key: 'initial_qty', label: 'Initial qty', num: true },
                { key: 'opening_cost', label: 'Opening cost', num: true, sort: (r) => r.initial_qty * r.unit_cost, render: (r) => money(r.initial_qty * r.unit_cost, 2) },
              ]}
              rows={products.filter((p) => !cat || p.category === cat)}
            />
            <p className="note">
              Total opening inventory: {num(products.reduce((s, p) => s + p.initial_qty, 0))} units costing {money(products.reduce((s, p) => s + p.initial_qty * p.unit_cost, 0), 2)} (limit {money(m.inventory_budget)}).
            </p>
          </>
        )}
      </Section>
    </>
  );
}
