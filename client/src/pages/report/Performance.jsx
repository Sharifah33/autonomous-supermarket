import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../../api.js';
import { href } from '../../router.js';
import { CAT_COLORS, DayLink, Loading, MISSION_LABEL, ProductLink, Section, Stat, Stats, Table, money, num, pct, useRun } from '../../ui.jsx';

export default function Performance() {
  const { runId } = useRun();
  const state = useApi(`/runs/${runId}/report/performance`);
  return <Loading state={state}>{(d) => <Body d={d} runId={runId} />}</Loading>;
}

function Body({ d, runId }) {
  const t = d.totals;
  const wd = d.dayType.find((x) => x.day_type === 'Weekday');
  const we = d.dayType.find((x) => x.day_type === 'Weekend');
  const best = [...d.daily].sort((a, b) => b.revenue - a.revenue)[0];
  const worst = [...d.daily].sort((a, b) => a.revenue - b.revenue)[0];
  const topMission = d.missions[0];
  const missionRev = d.missions.reduce((s, m) => s + m.revenue, 0);
  const topCat = d.categories[0];
  const gpCat = [...d.categories].sort((a, b) => b.gross_profit - a.gross_profit)[0];

  return (
    <>
      <Section title="What happened">
        <div className="prose">
          <p>
            Over 60 days the store served <b>{num(t.customers)}</b> customers in <b>{num(t.transactions)}</b> transactions and took{' '}
            <b>{money(t.revenue)}</b> in sales at a {pct(t.gross_margin_pct)} gross margin. After {money(t.writeoff_value)} of expired stock, gross
            profit was <b>{money(t.gp_after_writeoff)}</b>. Traffic followed the opening ramp, averaging {num(d.ramp.first14, 0)} customers a day in the
            first fortnight and {num(d.ramp.after14, 0)} afterwards.
          </p>
          <p>
            This is a weekday, office-driven store. Weekdays averaged {num(wd?.avg_customers, 0)} customers against {num(we?.avg_customers, 0)} at weekends.
            Weekend shoppers bought bigger baskets ({num(we?.avg_basket_units, 2)} vs {num(wd?.avg_basket_units, 2)} units, {money(we?.avg_transaction_value, 2)} vs{' '}
            {money(wd?.avg_transaction_value, 2)}), so the weekend revenue gap is smaller than the traffic gap. {MISSION_LABEL[topMission.mission]} trips were{' '}
            {pct((topMission.revenue / missionRev) * 100)} of revenue. {topCat.category} was the largest category ({pct(topCat.revenue_share_pct)} of sales) and{' '}
            {gpCat.category} the largest source of gross profit.
          </p>
          <p>
            The best day was <DayLink day={best.day}>Day {best.day}</DayLink> ({best.weekday}, {money(best.revenue)}), the weakest{' '}
            <DayLink day={worst.day}>Day {worst.day}</DayLink> ({worst.weekday}, {money(worst.revenue)}, during the opening ramp). Operating cash finished at{' '}
            {money(t.closing_cash)}, but this is before rent, systems and other costs outside the model boundary (see Finding F3).
          </p>
        </div>
      </Section>

      <Section title="Store performance" note="Totals for Days 1-60, calculated from transactions, inventory movements and the cash ledger.">
        <Stats>
          <Stat label="Customers (store visits)" value={num(t.customers)} sub={`${num(t.walkouts)} left without buying`} />
          <Stat label="Transactions" value={num(t.transactions)} />
          <Stat label="Units sold" value={num(t.units)} />
          <Stat label="Sales revenue" value={money(t.revenue)} />
          <Stat label="Cost of goods sold" value={money(t.cogs)} />
          <Stat label="Gross profit" value={money(t.gross_profit)} sub={`${pct(t.gross_margin_pct)} margin`} />
          <Stat label="Expiry / write-off value" value={money(t.writeoff_value)} sub={`${num(t.writeoff_units)} units at cost`} tone="warn" to={{ page: 'report', arg: 'ops' }} />
          <Stat label="Closing operating cash" value={money(t.closing_cash)} sub={`from ${money(t.opening_cash)} opening`} to={{ page: 'assurance' }} />
          <Stat label="Closing inventory value" value={money(t.closing_inventory_value)} sub={`${num(t.closing_inventory_units)} units at cost; opened at ${money(t.opening_inventory_cost)}`} />
        </Stats>
      </Section>

      <Section title="Customer activity across the 60 days" note="Bars are customers per day (weekends shaded); the line is revenue. Select a bar to open that day's Daily Report.">
        <div className="chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={d.daily} onClick={(e) => e?.activeLabel && (window.location.hash = href(runId, 'day', e.activeLabel))}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} />
              <YAxis yAxisId="c" tick={{ fontSize: 11 }} width={40} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip formatter={(v, n) => (n === 'Revenue' ? money(v) : num(v))} labelFormatter={(l) => `Day ${l} (select to open)`} />
              <Legend />
              <Bar isAnimationActive={false} yAxisId="c" dataKey="customers" name="Customers" cursor="pointer">
                {d.daily.map((x) => (
                  <Cell key={x.day} fill={x.is_weekend ? 'var(--signal)' : 'var(--tram-soft)'} />
                ))}
              </Bar>
              <Line isAnimationActive={false} yAxisId="r" dataKey="revenue" name="Revenue" stroke="var(--tram)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Shoppers and baskets">
        <Stats>
          <Stat label="Average customers per day" value={num(t.avg_customers_per_day, 1)} />
          <Stat label="Average basket size" value={`${num(t.avg_basket_units, 2)} units`} sub={`${num(t.avg_basket_lines, 2)} different products`} />
          <Stat label="Average transaction value" value={money(t.avg_transaction_value, 2)} />
          <Stat label="Same-category substitutions" value={num(t.substitutions)} sub="first choice sold out" />
        </Stats>
        <div className="grid-2">
          <div>
            <h3>Weekday vs weekend</h3>
            <Table
              columns={[
                { key: 'day_type', label: 'Day type' },
                { key: 'days', label: 'Days', num: true },
                { key: 'avg_customers', label: 'Customers / day', num: true, render: (r) => num(r.avg_customers, 1) },
                { key: 'steady', label: 'After ramp (Day 15+)', num: true, render: (r) => num(d.dayTypeSteady.find((s) => s.day_type === r.day_type)?.avg_customers, 1) },
                { key: 'avg_revenue', label: 'Revenue / day', num: true, render: (r) => money(r.avg_revenue) },
                { key: 'avg_basket_units', label: 'Basket units', num: true },
                { key: 'avg_transaction_value', label: 'Avg transaction', num: true, render: (r) => money(r.avg_transaction_value, 2) },
              ]}
              rows={d.dayType}
            />
            <h3>Shopping missions</h3>
            <Table
              columns={[
                { key: 'mission', label: 'Mission', render: (r) => MISSION_LABEL[r.mission] },
                { key: 'customers', label: 'Customers', num: true, render: (r) => num(r.customers) },
                { key: 'weekend_share', label: 'Weekend share', num: true, sort: (r) => r.weekend_customers / r.customers, render: (r) => pct((r.weekend_customers / r.customers) * 100) },
                { key: 'avg_units', label: 'Units / basket', num: true },
                { key: 'avg_value', label: 'Avg value', num: true, render: (r) => money(r.avg_value, 2) },
                { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
              ]}
              rows={d.missions}
            />
          </div>
          <div>
            <h3>Average customers by hour</h3>
            <div className="chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={d.hourly}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={36} />
                  <Tooltip labelFormatter={(h) => `${h}:00-${h}:59`} />
                  <Legend />
                  <Line isAnimationActive={false} dataKey="weekday_avg" name="Weekday" stroke="var(--tram)" strokeWidth={2} dot={false} />
                  <Line isAnimationActive={false} dataKey="weekend_avg" name="Weekend" stroke="var(--signal-ink)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="note">Weekday peaks come from commuters (7-9 am), lunch (12-1 pm) and dinner top-ups (5-7 pm); weekends are flatter and later, as declared in the model.</p>
          </div>
        </div>
      </Section>

      <Section title="Categories" note="Gross profit is before write-off; the last column deducts expired stock at cost.">
        <div>
          <Table
            columns={[
              { key: 'category', label: 'Category' },
              { key: 'units', label: 'Units', num: true, render: (r) => num(r.units) },
              { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
              { key: 'revenue_share_pct', label: 'Share', num: true, render: (r) => pct(r.revenue_share_pct) },
              { key: 'gross_profit', label: 'Gross profit', num: true, render: (r) => money(r.gross_profit) },
              { key: 'gross_margin_pct', label: 'Margin', num: true, render: (r) => pct(r.gross_margin_pct) },
              { key: 'writeoff_value', label: 'Write-off', num: true, render: (r) => money(r.writeoff_value) },
              { key: 'gp_after_writeoff', label: 'GP after write-off', num: true, render: (r) => money(r.gp_after_writeoff) },
            ]}
            rows={d.categories}
          />
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={d.categories} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="var(--grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => money(v)} />
                <Legend />
                <Bar isAnimationActive={false} dataKey="revenue" name="Revenue" fill="var(--tram-soft)" />
                <Bar isAnimationActive={false} dataKey="gross_profit" name="Gross profit" fill="var(--tram)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>

      <Section title="Products">
        <div className="grid-2">
          <div>
            <h3>Top 10 by revenue</h3>
            <Table
              dense
              columns={[
                { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
                { key: 'units', label: 'Units', num: true, render: (r) => num(r.units) },
                { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
                { key: 'gross_profit', label: 'GP', num: true, render: (r) => money(r.gross_profit) },
              ]}
              rows={d.topProducts}
            />
          </div>
          <div>
            <h3>Weakest 10 (revenue per day, last 14 days)</h3>
            <Table
              dense
              columns={[
                { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
                { key: 'units_last14_per_day', label: 'Units / day', num: true },
                { key: 'units', label: '60-day units', num: true },
                { key: 'closing_qty', label: 'On hand', num: true },
                { key: 'closing_cover_days', label: 'Days cover', num: true, render: (r) => (r.closing_cover_days == null ? '-' : num(r.closing_cover_days, 0)) },
              ]}
              rows={d.weakProducts}
            />
          </div>
        </div>
        <h3>All products</h3>
        <Table
          dense
          limit={15}
          initialSort={{ key: 'revenue', dir: 'desc' }}
          columns={[
            { key: 'product_id', label: 'ID' },
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'category', label: 'Category', render: (r) => <span className="cat"><i style={{ background: CAT_COLORS[r.category] }} />{r.category}</span> },
            { key: 'units', label: 'Units', num: true, render: (r) => num(r.units) },
            { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
            { key: 'gross_profit', label: 'GP', num: true, render: (r) => money(r.gross_profit) },
            { key: 'expired_units', label: 'Expired', num: true },
            { key: 'lost_units', label: 'Lost demand', num: true },
            { key: 'sold_out_days', label: 'Sold-out days', num: true },
            { key: 'closing_qty', label: 'Closing', num: true },
          ]}
          rows={d.products}
        />
      </Section>
    </>
  );
}
