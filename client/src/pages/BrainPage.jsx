import React from 'react';
import { useApi } from '../api.js';
import { href } from '../router.js';
import { DayLink, EVENT_LABEL, Loading, Page, ProductLink, Sev, Table, hhmm, num, useRun } from '../ui.jsx';

export default function BrainPage({ query }) {
  const { runId } = useRun();
  const { type = '', product = '', day = '', page = '1' } = query;
  const qs = new URLSearchParams(Object.entries({ type, product, day, page }).filter(([, v]) => v)).toString();
  const state = useApi(`/runs/${runId}/brain?${qs}`);
  const products = useApi(`/runs/${runId}/products`);
  const set = (k, v) => (window.location.hash = href(runId, 'brain', null, { type, product, day, [k]: v, page: k === 'page' ? v : '' }));

  return (
    <Page
      title="Store Brain log"
      intro="Every condition the Store Brain detected and the action it took, in the order it happened. Each row links to the day and product it concerns."
    >
      <div className="filters">
        <select value={type} onChange={(e) => set('type', e.target.value)} aria-label="Event type">
          <option value="">All event types</option>
          {Object.entries(EVENT_LABEL).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <select value={product} onChange={(e) => set('product', e.target.value)} aria-label="Product">
          <option value="">All products</option>
          {products.data?.map((p) => (
            <option key={p.product_id} value={p.product_id}>{p.product_id} {p.name}</option>
          ))}
        </select>
        <select value={day} onChange={(e) => set('day', e.target.value)} aria-label="Day">
          <option value="">All days</option>
          {Array.from({ length: 60 }, (_, i) => (
            <option key={i + 1} value={i + 1}>Day {i + 1}</option>
          ))}
        </select>
      </div>
      <Loading state={state}>
        {(d) => {
          const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
          return (
            <>
              <p className="note">{num(d.total)} events match.</p>
              <Table
                dense
                columns={[
                  { key: 'day', label: 'Day', render: (r) => <DayLink day={r.day} /> },
                  { key: 'time_min', label: 'Time', render: (r) => hhmm(r.time_min) },
                  { key: 'event_type', label: 'Event', render: (r) => EVENT_LABEL[r.event_type] ?? r.event_type },
                  { key: 'severity', label: 'Severity', render: (r) => <Sev s={r.severity} /> },
                  { key: 'name', label: 'Product', render: (r) => (r.product_id ? <ProductLink id={r.product_id} name={r.name} /> : 'Store') },
                  { key: 'condition', label: 'Condition detected' },
                  { key: 'action', label: 'Action taken' },
                  { key: 'order_id', label: 'Order', render: (r) => (r.order_id ? `#${r.order_id}` : '') },
                ]}
                rows={d.rows}
                empty="No events of this type were recorded in this run (0)."
              />
              <div className="pager">
                <button type="button" disabled={d.page <= 1} onClick={() => set('page', String(d.page - 1))}>Previous</button>
                <span>Page {d.page} of {pages}</span>
                <button type="button" disabled={d.page >= pages} onClick={() => set('page', String(d.page + 1))}>Next</button>
              </div>
            </>
          );
        }}
      </Loading>
    </Page>
  );
}
