import React, { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { href } from '../router.js';
import { EVENT_LABEL, L, Loading, MISSION_LABEL, Page, ProductLink, Section, Sev, Stat, Stats, Status, Table, hhmm, money, num, useRun } from '../ui.jsx';

export default function DailyPage({ day }) {
  const { runId } = useRun();
  const perf = useApi(`/runs/${runId}/report/performance`);
  const state = useApi(`/runs/${runId}/days/${day}`);
  const go = (d) => (window.location.hash = href(runId, 'day', Math.min(60, Math.max(1, d))));

  return (
    <Page
      title={`Daily Report: Day ${day}`}
      intro="One report for every simulated day, rebuilt from that day's stored records. Day tiles are shaded by revenue (darker is higher); weekends are underlined in yellow."
      actions={
        <div className="day-nav">
          <button type="button" onClick={() => go(day - 1)} disabled={day <= 1}>Previous day</button>
          <select value={day} onChange={(e) => go(Number(e.target.value))} aria-label="Select day">
            {Array.from({ length: 60 }, (_, i) => (
              <option key={i + 1} value={i + 1}>Day {i + 1}</option>
            ))}
          </select>
          <button type="button" onClick={() => go(day + 1)} disabled={day >= 60}>Next day</button>
        </div>
      }
    >
      {perf.data && <DayStrip daily={perf.data.daily} day={day} runId={runId} />}
      <Loading state={state}>{(d) => <Body d={d} runId={runId} />}</Loading>
    </Page>
  );
}

function DayStrip({ daily, day, runId }) {
  const max = Math.max(...daily.map((x) => x.revenue));
  const min = Math.min(...daily.map((x) => x.revenue));
  return (
    <div className="strip" role="list" aria-label="Days 1 to 60">
      {daily.map((x) => (
        <a
          role="listitem"
          key={x.day}
          href={href(runId, 'day', x.day)}
          className={`${x.day === day ? 'on' : ''} ${x.is_weekend ? 'we' : ''}`}
          style={{ '--v': (x.revenue - min) / (max - min || 1) }}
          title={`Day ${x.day} (${x.weekday}): ${money(x.revenue)}, ${x.customers} customers`}
        >
          <span>{x.day}</span>
        </a>
      ))}
    </div>
  );
}

function Body({ d, runId }) {
  const s = d.summary;
  const booksOk = Object.values(d.booksCheck).every(Boolean);
  const [stockFilter, setStockFilter] = useState('activity');
  const stockRows = d.stock.filter((r) =>
    stockFilter === 'all' ? true : stockFilter === 'issues' ? r.sold_out_min != null || r.expired_qty > 0 || r.lost_units > 0 : r.sold_qty || r.received_qty || r.expired_qty || r.ordered_qty,
  );
  const phases = ['OPEN', 'TRADING', 'CLOSE'];

  return (
    <>
      <div className="day-meta">
        <span>
          {d.meta.weekday} ({d.meta.is_weekend ? 'weekend' : 'weekday'})
        </span>
        <span>Opening-ramp traffic factor {Math.round(d.meta.ramp_factor * 100)}%</span>
        <span>
          Daily books vs transaction log <Status pass={booksOk}>{booksOk ? 'agree' : 'mismatch'}</Status>
        </span>
      </div>

      <Section title="Day summary">
        <Stats>
          <Stat label="Customers" value={num(s.customers)} sub={s.walkouts ? `${s.walkouts} left without buying` : 'all bought something'} />
          <Stat label="Transactions" value={num(s.transactions)} />
          <Stat label="Units sold" value={num(s.units)} sub={`${num(s.avg_basket_units, 2)} per basket`} />
          <Stat label="Revenue" value={money(s.revenue, 2)} sub={`avg ${money(s.atv, 2)} per transaction`} />
          <Stat label="Gross profit" value={money(s.gross_profit, 2)} sub={`COGS ${money(s.cogs, 2)}`} />
          <Stat label="Written off" value={money(s.writeoff_value ?? 0, 2)} sub={`${num(s.writeoff_units ?? 0)} units expired`} tone={s.writeoff_units ? 'warn' : ''} />
          <Stat label="Lost demand" value={`${num(s.lost_units ?? 0)} units`} sub={money(s.lost_value ?? 0, 2)} tone={s.lost_units ? 'bad' : ''} />
          <Stat label="Replenishment ordered" value={money(s.replenishment_spend ?? 0, 2)} sub={`${s.orders_placed} orders for Day ${d.day + 1 <= 60 ? d.day + 1 : '-'}`} />
          <Stat label="Operating cash" value={money(s.closing_cash, 2)} sub={`opened at ${money(s.opening_cash, 2)}`} />
        </Stats>
      </Section>

      <Section title="Customers and sales by hour">
        <div className="grid-2 wide-left">
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.hourly}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={36} />
                <Tooltip labelFormatter={(h) => `${h}:00-${h}:59`} formatter={(v, n) => (n === 'Revenue' ? money(v) : v)} />
                <Legend />
                <Bar isAnimationActive={false} dataKey="customers" name="Customers" fill="var(--tram)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <Table
              dense
              columns={[
                { key: 'mission', label: 'Mission', render: (r) => MISSION_LABEL[r.mission] },
                { key: 'customers', label: 'Customers', num: true },
                { key: 'avg_units', label: 'Units', num: true },
                { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
              ]}
              rows={d.missions}
            />
            <Table
              dense
              columns={[
                { key: 'category', label: 'Category' },
                { key: 'units', label: 'Units', num: true },
                { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
              ]}
              rows={d.categories}
            />
          </div>
        </div>
      </Section>

      <Section title="Store Brain activity" note="06:00 deliveries arrive; 06:30 expired stock removed; trading 07:00-22:00; 22:05 close review and ordering.">
        {phases.map((ph) => {
          const ev = d.events.filter((e) => e.phase === ph);
          return (
            <div className="phase" key={ph}>
              <h3>{ph === 'OPEN' ? 'Before opening' : ph === 'TRADING' ? 'During trading' : 'Close review'}</h3>
              <Table
                dense
                limit={8}
                columns={[
                  { key: 'time_min', label: 'Time', render: (r) => hhmm(r.time_min) },
                  { key: 'event_type', label: 'Event', render: (r) => EVENT_LABEL[r.event_type] ?? r.event_type },
                  { key: 'severity', label: 'Severity', render: (r) => <Sev s={r.severity} /> },
                  { key: 'name', label: 'Product', render: (r) => (r.product_id ? <ProductLink id={r.product_id} name={r.name} /> : 'Store') },
                  { key: 'condition', label: 'Condition detected' },
                  { key: 'action', label: 'Action taken' },
                ]}
                rows={ev}
                empty={ph === 'TRADING' ? 'No product sold out during trading.' : 'No events.'}
              />
            </div>
          );
        })}
      </Section>

      <Section title={`Replenishment orders placed at close (${d.orders.length})`} note="Each order records the forecast, usable stock, target and the cash balance before and after it.">
        <Table
          dense
          limit={10}
          columns={[
            { key: 'order_id', label: 'Order', render: (r) => `#${r.order_id}` },
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'reason', label: 'Reason' },
            { key: 'forecast_daily', label: 'Forecast/day', num: true },
            { key: 'usable_stock', label: 'Usable stock', num: true },
            { key: 'target_stock', label: 'Target', num: true },
            { key: 'qty', label: 'Ordered', num: true, render: (r) => `${r.qty} (${r.cases} cs)` },
            { key: 'total_cost', label: 'Cost', num: true, render: (r) => money(r.total_cost, 2) },
            { key: 'cash_after', label: 'Cash after', num: true, render: (r) => money(r.cash_after, 2) },
          ]}
          rows={d.orders}
          empty={d.day === 60 ? 'No orders on Day 60: the simulation ends after this day.' : 'No orders placed.'}
        />
      </Section>

      <Section title="Stock movements by product" note="Opening + received - expired - sold = closing, as held in the store's daily books.">
        <div className="filters">
          {[
            ['activity', 'Products with movement'],
            ['issues', 'Sell-outs, expiry or lost demand'],
            ['all', 'All products'],
          ].map(([k, l]) => (
            <button key={k} type="button" className={stockFilter === k ? 'on' : ''} onClick={() => setStockFilter(k)}>{l}</button>
          ))}
        </div>
        <Table
          dense
          limit={15}
          columns={[
            { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
            { key: 'opening_qty', label: 'Opening', num: true },
            { key: 'received_qty', label: '+ Received', num: true },
            { key: 'expired_qty', label: '− Expired', num: true },
            { key: 'sold_qty', label: '− Sold', num: true },
            { key: 'closing_qty', label: '= Closing', num: true },
            { key: 'sold_out_min', label: 'Sold out at', num: true, render: (r) => (r.sold_out_min != null ? <span className="bad-text">{hhmm(r.sold_out_min)}</span> : '') },
            { key: 'lost_units', label: 'Lost', num: true, render: (r) => r.lost_units || '' },
            { key: 'forecast_next', label: 'Forecast next day', num: true },
            { key: 'ordered_qty', label: 'Ordered', num: true, render: (r) => r.ordered_qty ?? '' },
          ]}
          rows={stockRows}
        />
      </Section>

      <Transactions runId={runId} day={d.day} total={s.transactions} />
    </>
  );
}

function Transactions({ runId, day, total }) {
  const [page, setPage] = useState(1);
  const state = useApi(`/runs/${runId}/days/${day}/transactions?page=${page}`);
  const pages = Math.ceil(total / 50);
  return (
    <Section title={`Transactions (${num(total)})`} note="Every completed sale. Open a transaction to see its lines, the stock batches it drew from, and its cash entry.">
      <Loading state={state}>
        {(t) => (
          <>
            <Table
              dense
              columns={[
                { key: 'txn_id', label: 'Transaction', render: (r) => <L page="txn" arg={r.txn_id}>#{r.txn_id}</L> },
                { key: 'time_min', label: 'Time', render: (r) => hhmm(r.time_min) },
                { key: 'mission', label: 'Mission', render: (r) => MISSION_LABEL[r.mission] },
                { key: 'line_count', label: 'Lines', num: true },
                { key: 'units', label: 'Units', num: true },
                { key: 'total', label: 'Total', num: true, render: (r) => money(r.total, 2) },
              ]}
              rows={t.rows}
            />
            <div className="pager">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous 50</button>
              <span>Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next 50</button>
            </div>
          </>
        )}
      </Loading>
    </Section>
  );
}
