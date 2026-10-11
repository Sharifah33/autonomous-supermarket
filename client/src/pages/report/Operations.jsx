import React from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../../api.js';
import { href } from '../../router.js';
import { DayLink, EVENT_LABEL, L, Loading, ProductLink, Section, Stat, Stats, Table, money, num, pct, useRun } from '../../ui.jsx';

export default function Operations() {
  const { runId } = useRun();
  const state = useApi(`/runs/${runId}/report/operations`);
  const perf = useApi(`/runs/${runId}/report/performance`);
  return <Loading state={state}>{(d) => <Body d={d} t={perf.data?.totals} runId={runId} />}</Loading>;
}

function Body({ d, t, runId }) {
  const c = Object.fromEntries(d.counts.map((x) => [x.event_type, x]));
  const spendSeries = d.cashDaily.map((x) => ({ day: x.day, revenue: x.revenue, spend: x.replenishment_spend, cash: x.closing_cash }));
  const lostTotal = d.stockouts.reduce((s, p) => s + p.lost_value, 0);
  const lostUnits = d.stockouts.reduce((s, p) => s + p.lost_units, 0);
  const woTotal = d.writeoffs.reduce((s, p) => s + p.writeoff_value, 0);
  const woUnits = d.writeoffs.reduce((s, p) => s + p.expired_units, 0);

  return (
    <>
      <Section title="What the Store Brain dealt with">
        <div className="prose">
          <p>
            Availability problems were concentrated in short-life lines. {num(c.SOLD_OUT.n)} sell-outs hit {c.SOLD_OUT.products} products, costing{' '}
            {num(lostUnits)} units ({money(lostTotal)} at retail) of demand that could not be met. Expired stock totalled {num(woUnits)} units ({money(woTotal)} at
            cost). Most of it came from the same ready-to-eat lines, which is the trade-off examined in Finding F1. The Brain placed {num(d.orders.n)} replenishment orders worth{' '}
            {money(d.orders.spend)}. None were reduced for lack of cash: the tightest point was {money(d.cashHeadroom.min_headroom)} of headroom on{' '}
            <DayLink day={d.cashHeadroom.min_day} />.
          </p>
        </div>
        <Stats>
          <Stat label="Sold-out events" value={num(c.SOLD_OUT.n)} sub={`${c.SOLD_OUT.products} products`} tone="bad" to={{ page: 'brain', query: { type: 'SOLD_OUT' } }} />
          <Stat label="Lost demand" value={money(lostTotal)} sub={`${num(lostUnits)} units at retail`} tone="bad" />
          <Stat label="Low-stock alerts" value={num(c.LOW_STOCK.n)} sub={`${c.LOW_STOCK.products} products`} tone="warn" to={{ page: 'brain', query: { type: 'LOW_STOCK' } }} />
          <Stat label="Expired / written off" value={`${num(woUnits)} units`} sub={`${money(woTotal)} at cost`} tone="warn" to={{ page: 'brain', query: { type: 'EXPIRY_WRITE_OFF' } }} />
          <Stat label="Slow-moving products" value={num(d.slowMovers.length)} sub={`${c.SLOW_MOVER.n} flags`} to={{ page: 'brain', query: { type: 'SLOW_MOVER' } }} />
          <Stat label="Replenishment orders" value={num(d.orders.n)} sub={`${num(d.orders.units)} units, ${money(d.orders.spend)}`} />
          <Stat label="Cash-constrained orders" value={num(d.orders.constrained)} sub="orders reduced or skipped" tone={d.orders.constrained ? 'bad' : ''} to={{ page: 'brain', query: { type: 'CASH_REVIEW' } }} />
          {t && <Stat label="Closing inventory" value={money(t.closing_inventory_value)} sub={`${num(t.closing_inventory_units)} units at cost`} />}
        </Stats>
      </Section>

      <Section title="Store Brain decisions by type" note="Every required condition is listed; a zero means the condition did not occur in this run. Select a row to see each recorded event.">
        <Table
          columns={[
            { key: 'event_type', label: 'Condition / decision', render: (r) => <L page="brain" query={{ type: r.event_type }}>{EVENT_LABEL[r.event_type] ?? r.event_type}</L> },
            { key: 'n', label: 'Events', num: true, render: (r) => num(r.n) },
            { key: 'products', label: 'Products', num: true },
            { key: 'days', label: 'Days', num: true },
            { key: 'what', label: 'What the Brain does', render: (r) => WHAT[r.event_type] },
          ]}
          rows={d.counts}
        />
      </Section>

      <Section title="Material cases: condition, action and recorded outcome" note="Largest stockout, write-off and slow-mover cases. The outcome compares the first and second halves of the run.">
        <Table
          columns={[
            { key: 'kind', label: 'Problem' },
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'condition', label: 'Condition detected' },
            { key: 'action', label: 'Store Brain action' },
            { key: 'outcome', label: 'Recorded outcome' },
          ]}
          rows={d.material}
        />
      </Section>

      <Section title="Stockouts and lost demand">
        <Table
          dense
          limit={10}
          columns={[
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'category', label: 'Category' },
            { key: 'shelf_life_days', label: 'Shelf life', num: true, render: (r) => (r.shelf_life_days ? `${r.shelf_life_days} d` : '-') },
            { key: 'sold_out_days', label: 'Sold-out days', num: true },
            { key: 'lost_units', label: 'Lost units', num: true },
            { key: 'lost_value', label: 'Lost at retail', num: true, render: (r) => money(r.lost_value) },
            { key: 'units', label: 'Units sold', num: true, render: (r) => num(r.units) },
          ]}
          rows={d.stockouts}
          empty="No stockouts occurred in this run (0)."
        />
      </Section>

      <Section title="Expiry and write-off">
        <div className="grid-2 wide-left">
          <Table
            dense
            limit={10}
            columns={[
              { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
              { key: 'shelf_life_days', label: 'Shelf life', num: true, render: (r) => `${r.shelf_life_days} d` },
              { key: 'expired_units', label: 'Units', num: true },
              { key: 'writeoff_value', label: 'Value at cost', num: true, render: (r) => money(r.writeoff_value, 2) },
              { key: 'waste_rate_pct', label: 'Waste rate', num: true, render: (r) => pct(r.waste_rate_pct) },
            ]}
            rows={d.writeoffs}
            empty="No stock expired in this run (0)."
          />
          <div>
            <h3>By category</h3>
            <Table
              dense
              columns={[
                { key: 'category', label: 'Category' },
                { key: 'units', label: 'Units', num: true },
                { key: 'value', label: 'Value', num: true, render: (r) => money(r.value, 2) },
              ]}
              rows={d.writeoffByCategory}
              empty="0 write-offs"
            />
            <h3>Waste-aware order adjustments</h3>
            <p className="note">
              {d.wasteAdjust.length} adjustments: {d.wasteAdjust.filter((x) => x.severity === 'WARN').length} cuts after high write-off,{' '}
              {d.wasteAdjust.filter((x) => x.severity === 'INFO').length} restores after a sell-out. <L page="brain" query={{ type: 'WASTE_ADJUST' }}>Open the log</L>.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Slow-moving stock" note="Non-perishable lines holding more than 30 days of cover at their recent sales rate, checked from Day 10 and re-flagged weekly while it persists.">
        <Table
          dense
          columns={[
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'first_day', label: 'First flagged', num: true, render: (r) => <DayLink day={r.first_day} /> },
            { key: 'flags', label: 'Flags', num: true },
            { key: 'first_cover_days', label: 'Cover at flag (days)', num: true },
            { key: 'initial_qty', label: 'Opening qty', num: true },
            { key: 'units', label: 'Sold (60 d)', num: true },
            { key: 'closing_qty', label: 'Closing qty', num: true },
            { key: 'closing_cover_days', label: 'Closing cover (days)', num: true, render: (r) => (r.closing_cover_days == null ? 'no recent sales' : num(r.closing_cover_days, 0)) },
            { key: 'closing_value', label: 'Closing value', num: true, render: (r) => money(r.closing_value, 2) },
          ]}
          rows={d.slowMovers}
          empty="No slow movers were detected in this run (0)."
        />
      </Section>

      <Section title="Replenishment and cash" note="Order cost is deducted from operating cash at the end-of-day review; stock arrives before opening the next day. Select a day on the chart to open it.">
        <div className="chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={spendSeries} onClick={(e) => e?.activeLabel && (window.location.hash = href(runId, 'day', e.activeLabel))}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} />
              <YAxis yAxisId="a" tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="b" orientation="right" tick={{ fontSize: 11 }} width={60} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => money(v)} labelFormatter={(l) => `Day ${l}`} />
              <Legend />
              <Bar isAnimationActive={false} yAxisId="a" dataKey="revenue" name="Revenue" fill="var(--tram-soft)" />
              <Bar isAnimationActive={false} yAxisId="a" dataKey="spend" name="Replenishment spend" fill="var(--signal)" />
              <Line isAnimationActive={false} yAxisId="b" dataKey="cash" name="Closing cash (right)" stroke="var(--ink)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="grid-2">
          <div>
            <h3>Orders by reason</h3>
            <Table
              dense
              columns={[
                { key: 'reason', label: 'Reason', render: (r) => REASON[r.reason] ?? r.reason },
                { key: 'n', label: 'Orders', num: true, render: (r) => num(r.n) },
                { key: 'units', label: 'Units', num: true, render: (r) => num(r.units) },
                { key: 'spend', label: 'Spend', num: true, render: (r) => money(r.spend) },
              ]}
              rows={d.ordersByReason}
            />
          </div>
          <div>
            <h3>Orders by category</h3>
            <Table
              dense
              columns={[
                { key: 'category', label: 'Category' },
                { key: 'n', label: 'Orders', num: true, render: (r) => num(r.n) },
                { key: 'units', label: 'Units', num: true, render: (r) => num(r.units) },
                { key: 'spend', label: 'Spend', num: true, render: (r) => money(r.spend) },
              ]}
              rows={d.ordersByCategory}
            />
          </div>
        </div>
      </Section>

      <Section title="Closing inventory position" note="Opening inventory was funded from the separate A$40,000 budget; closing stock is the result of 60 days of receipts, sales and write-offs.">
        <Table
          dense
          columns={[
            { key: 'category', label: 'Category' },
            { key: 'opening_units', label: 'Opening units', num: true, render: (r) => num(r.opening_units) },
            { key: 'opening_value', label: 'Opening value', num: true, render: (r) => money(r.opening_value) },
            { key: 'closing_units', label: 'Closing units', num: true, render: (r) => num(r.closing_units) },
            { key: 'closing_value', label: 'Closing value', num: true, render: (r) => money(r.closing_value) },
          ]}
          rows={d.closingInventory}
        />
        <h3>Conditions reported at the close of Day 60 (no orders possible)</h3>
        <Table
          dense
          limit={8}
          columns={[
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'event_type', label: 'Condition', render: (r) => EVENT_LABEL[r.event_type] },
            { key: 'condition', label: 'Detail' },
          ]}
          rows={d.endState}
          empty="No low-stock or sold-out conditions at the final close."
        />
      </Section>
    </>
  );
}

const REASON = {
  SOLD_OUT: 'Sold out (priority)',
  LOW_STOCK: 'Low stock',
  PERISHABLE_DAILY: 'Perishable daily top-up',
  REORDER_POINT: 'Reorder point reached',
};
const WHAT = {
  SOLD_OUT: 'Marks the product unavailable the moment stock hits zero; customers may take a same-category substitute.',
  SOLD_OUT_RESPONSE: 'At close, orders the product first, ahead of every other need.',
  LOW_STOCK: 'Raises order priority when usable stock is below 2 days (non-perishable) or 1 day (perishable) of forecast.',
  EXPIRY_WRITE_OFF: 'Removes expired units before opening and writes them off at cost.',
  EXPIRY_WARNING: 'Flags material stock on its last saleable day; FEFO sells it first.',
  SLOW_MOVER: 'Holds replenishment and flags the line for markdown or range review.',
  WASTE_ADJUST: 'Cuts a perishable order target after high write-off; restores it after a sell-out.',
  CASH_CONSTRAINED: 'Cuts or skips an order that would take cash below the A$1,000 reserve.',
  CASH_REVIEW: 'Checks closing cash against the day\'s total order need before ordering.',
  END_OF_HORIZON: 'Places no orders after Day 60 and reports the conditions still open.',
};
