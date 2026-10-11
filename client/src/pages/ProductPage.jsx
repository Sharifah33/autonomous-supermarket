import React from 'react';
import { CartesianGrid, ComposedChart, Bar, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api.js';
import { href } from '../router.js';
import { DayLink, EVENT_LABEL, Loading, Page, ProductLink, Section, Sev, Stat, Stats, Table, hhmm, money, num, useRun } from '../ui.jsx';

export default function ProductPage({ productId }) {
  const { runId } = useRun();
  const list = useApi(`/runs/${runId}/products`);
  const state = useApi(productId ? `/runs/${runId}/product/${productId}` : null);
  return (
    <Page
      title="Product trace"
      intro="Follow one product through the run: stock by day, every batch received with its expiry, every order and every Store Brain decision."
      actions={
        list.data && (
          <select
            aria-label="Select product"
            value={productId ?? ''}
            onChange={(e) => (window.location.hash = href(runId, 'product', e.target.value))}
          >
            <option value="">Choose a product…</option>
            {list.data.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.product_id} {p.name}
              </option>
            ))}
          </select>
        )
      }
    >
      {!productId ? (
        <Loading state={list}>
          {(rows) => (
            <Table
              dense
              columns={[
                { key: 'product_id', label: 'ID' },
                { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
                { key: 'category', label: 'Category' },
                { key: 'units', label: 'Units sold', num: true, render: (r) => num(r.units) },
                { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue) },
                { key: 'sold_out_days', label: 'Sold-out days', num: true },
                { key: 'expired_units', label: 'Expired', num: true },
                { key: 'closing_qty', label: 'Closing', num: true },
              ]}
              rows={rows}
            />
          )}
        </Loading>
      ) : (
        <Loading state={state}>{(d) => <Body d={d} runId={runId} />}</Loading>
      )}
    </Page>
  );
}

function Body({ d, runId }) {
  const p = d.product;
  return (
    <>
      <div className="product-head">
        <h2>{p.name}</h2>
        <p>
          {p.product_id}, {p.category}. Cost {money(p.unit_cost, 2)}, price {money(p.unit_price, 2)} ({Math.round((1 - p.unit_cost / p.unit_price) * 100)}% margin).{' '}
          {p.perishable ? `Perishable, ${p.shelf_life_days}-day shelf life.` : 'Non-perishable within the 60-day horizon.'} Supplier case {p.case_size}. Planner estimate{' '}
          {p.plan_daily_units}/day; opening quantity {p.initial_qty}.
        </p>
      </div>
      <Stats>
        <Stat label="Units sold" value={num(d.totals.units ?? 0)} />
        <Stat label="Revenue" value={money(d.totals.revenue ?? 0)} />
        <Stat label="Lost demand" value={`${num(d.totals.lost ?? 0)} units`} tone={d.totals.lost ? 'bad' : ''} />
        <Stat label="Substitutes sold when out" value={num(d.totals.substituted_away ?? 0)} sub="another product bought instead" />
        <Stat label="Orders" value={num(d.orders.length)} sub={`${num(d.orders.reduce((s, o) => s + o.qty, 0))} units`} />
        <Stat label="Expired" value={num(d.days.reduce((s, x) => s + x.expired_qty, 0))} tone="warn" />
      </Stats>

      <Section title="Stock, sales and forecast by day" note="Select a day on the chart to open its Daily Report.">
        <div className="chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={d.days} onClick={(e) => e?.activeLabel && (window.location.hash = href(runId, 'day', e.activeLabel))}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip labelFormatter={(l) => `Day ${l}`} />
              <Legend />
              <Bar isAnimationActive={false} dataKey="sold_qty" name="Sold" fill="var(--tram-soft)" />
              <Bar isAnimationActive={false} dataKey="expired_qty" name="Expired" fill="var(--bad)" />
              <Line isAnimationActive={false} dataKey="closing_qty" name="Closing stock" stroke="var(--ink)" dot={false} strokeWidth={2} />
              <Line isAnimationActive={false} dataKey="forecast_next" name="Brain forecast for next day" stroke="var(--signal-ink)" dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Table
          dense
          limit={10}
          columns={[
            { key: 'day', label: 'Day', render: (r) => <DayLink day={r.day} /> },
            { key: 'opening_qty', label: 'Opening', num: true },
            { key: 'received_qty', label: '+ Received', num: true },
            { key: 'expired_qty', label: '− Expired', num: true },
            { key: 'sold_qty', label: '− Sold', num: true },
            { key: 'closing_qty', label: '= Closing', num: true },
            { key: 'sold_out_min', label: 'Sold out at', num: true, render: (r) => (r.sold_out_min != null ? hhmm(r.sold_out_min) : '') },
            { key: 'lost_units', label: 'Lost', num: true },
            { key: 'revenue', label: 'Revenue', num: true, render: (r) => money(r.revenue ?? 0, 2) },
            { key: 'forecast_next', label: 'Forecast', num: true },
            { key: 'ordered_qty', label: 'Ordered', num: true },
          ]}
          rows={d.days}
        />
      </Section>

      <Section title="Store Brain events for this product">
        <Table
          dense
          limit={12}
          columns={[
            { key: 'day', label: 'Day', render: (r) => <DayLink day={r.day} /> },
            { key: 'time_min', label: 'Time', render: (r) => hhmm(r.time_min) },
            { key: 'event_type', label: 'Event', render: (r) => EVENT_LABEL[r.event_type] ?? r.event_type },
            { key: 'severity', label: 'Severity', render: (r) => <Sev s={r.severity} /> },
            { key: 'condition', label: 'Condition' },
            { key: 'action', label: 'Action' },
          ]}
          rows={d.events}
          empty="No Store Brain events for this product."
        />
      </Section>

      <Section title="Stock batches" note="Each delivery is a batch with its own receipt day and expiry day. Units are sold first-expiring-first-out; anything left is removed on the morning of its expiry day.">
        <Table
          dense
          limit={10}
          columns={[
            { key: 'batch_id', label: 'Batch', render: (r) => `#${r.batch_id}` },
            { key: 'source', label: 'Source', render: (r) => (r.source === 'OPENING' ? 'Opening stock' : `Order #${r.order_id}`) },
            { key: 'received_day', label: 'Received', num: true, render: (r) => <DayLink day={r.received_day} /> },
            { key: 'expiry_day', label: 'Expires (morning of)', num: true, render: (r) => (r.expiry_day ? `Day ${r.expiry_day}` : '-') },
            { key: 'qty_received', label: 'Qty', num: true },
            { key: 'sold', label: 'Sold', num: true },
            { key: 'expired', label: 'Expired', num: true },
            { key: 'remaining', label: 'Remaining', num: true },
          ]}
          rows={d.batches}
        />
      </Section>

      <Section title="Replenishment orders">
        <Table
          dense
          limit={10}
          columns={[
            { key: 'order_id', label: 'Order', render: (r) => `#${r.order_id}` },
            { key: 'day_placed', label: 'Placed', render: (r) => <DayLink day={r.day_placed} /> },
            { key: 'reason', label: 'Reason' },
            { key: 'forecast_daily', label: 'Forecast/day', num: true },
            { key: 'usable_stock', label: 'Usable', num: true },
            { key: 'target_stock', label: 'Target', num: true },
            { key: 'qty', label: 'Qty', num: true },
            { key: 'total_cost', label: 'Cost', num: true, render: (r) => money(r.total_cost, 2) },
            { key: 'cash_constrained', label: 'Cash-limited', render: (r) => (r.cash_constrained ? 'Yes' : 'No') },
          ]}
          rows={d.orders}
          empty="Never re-ordered in this run."
        />
      </Section>
    </>
  );
}
