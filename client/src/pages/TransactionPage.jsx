import React from 'react';
import { useApi } from '../api.js';
import { DayLink, Loading, MISSION_LABEL, Page, ProductLink, Section, Table, hhmm, money, useRun } from '../ui.jsx';

export default function TransactionPage({ txnId }) {
  const { runId } = useRun();
  const state = useApi(`/runs/${runId}/transactions/${txnId}`);
  return (
    <Page title={`Transaction #${txnId}`} intro="A single completed sale with the records it created: line items, stock drawn from each batch, and the cash entry.">
      <Loading state={state}>
        {(d) => (
          <>
            <div className="day-meta">
              <span><DayLink day={d.txn.day} /> at {hhmm(d.txn.time_min)}</span>
              <span>Customer #{d.txn.customer_id}, {MISSION_LABEL[d.txn.mission]}</span>
              <span>Intended {d.txn.intended_lines} products, bought {d.txn.line_count}</span>
              <span>Total {money(d.txn.total, 2)}</span>
            </div>
            <Section title="Line items">
              <Table
                dense
                columns={[
                  { key: 'line_no', label: 'Line' },
                  { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
                  { key: 'qty', label: 'Qty', num: true },
                  { key: 'unit_price', label: 'Price', num: true, render: (r) => money(r.unit_price, 2) },
                  { key: 'line_total', label: 'Line total', num: true, render: (r) => money(r.line_total, 2) },
                  { key: 'unit_cost', label: 'Unit cost', num: true, render: (r) => money(r.unit_cost, 2) },
                  { key: 'substituted_for', label: 'Substitute for', render: (r) => (r.substituted_for ? <ProductLink id={r.substituted_for} /> : '') },
                ]}
                rows={d.lines}
              />
            </Section>
            <Section title="Stock drawn (first-expiring-first-out)">
              <Table
                dense
                columns={[
                  { key: 'movement_id', label: 'Movement', render: (r) => `#${r.movement_id}` },
                  { key: 'product_id', label: 'Product', render: (r) => <ProductLink id={r.product_id} /> },
                  { key: 'batch_id', label: 'Batch', render: (r) => `#${r.batch_id}` },
                  { key: 'received_day', label: 'Batch received', num: true, render: (r) => `Day ${r.received_day}` },
                  { key: 'expiry_day', label: 'Batch expires', num: true, render: (r) => (r.expiry_day ? `Day ${r.expiry_day}` : '-') },
                  { key: 'qty', label: 'Qty', num: true },
                ]}
                rows={d.movements}
              />
            </Section>
            <Section title="Cash entry">
              <p className="prose">
                Ledger entry #{d.cash.entry_id}: +{money(d.cash.amount, 2)}, balance after {money(d.cash.balance_after, 2)}.
              </p>
            </Section>
            {d.lost.length > 0 && (
              <Section title="Demand this customer could not get">
                <Table
                  dense
                  columns={[
                    { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
                    { key: 'qty', label: 'Qty', num: true },
                    { key: 'reason', label: 'Reason' },
                  ]}
                  rows={d.lost}
                />
              </Section>
            )}
          </>
        )}
      </Loading>
    </Page>
  );
}
