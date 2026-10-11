import React from 'react';
import { useApi } from '../api.js';
import { DayLink, Loading, Page, ProductLink, Section, Status, Table, money, num, useRun } from '../ui.jsx';

export default function AssurancePage() {
  const { runId } = useRun();
  return (
    <Page
      title="Commercial Assurance"
      intro={`Can the client trust the report? These checks run against the stored history of ${runId} each time the page loads. Several compare two independently written records: the store's end-of-day books and the event-level logs.`}
    >
      <AssuranceView />
    </Page>
  );
}

const SECTIONS = [
  ['History', 'History completeness'],
  ['Inventory', 'Inventory reconciliation'],
  ['Revenue', 'Revenue reconciliation'],
  ['Cash', 'Operating-cash reconciliation'],
  ['Exceptions', 'Exceptions'],
];

export function AssuranceView({ compact }) {
  const { runId } = useRun();
  const state = useApi(`/runs/${runId}/assurance`);
  return (
    <Loading state={state}>
      {(a) => {
        const inv = a.checks.find((c) => c.evidence?.type === 'inventory')?.evidence.totals;
        const cash = a.checks.find((c) => c.evidence?.type === 'cash')?.evidence;
        const passCount = a.checks.filter((c) => c.status === 'PASS').length;
        return (
          <>
            <div className={`verdict ${a.overall === 'PASS' ? 'ok' : 'bad'}`}>
              <Status pass={a.overall === 'PASS'}>{a.overall}</Status>
              <div>
                <strong>
                  {passCount} of {a.checks.length} integrity checks passed for {a.run_id}
                </strong>
                <span>
                  {a.overall === 'PASS'
                    ? 'No contradictions found in the recorded history. Business problems such as stockouts and write-offs are disclosed separately below; they are outcomes, not integrity failures.'
                    : 'At least one integrity check failed. Figures that depend on the failed area should not be relied on until resolved.'}
                </span>
              </div>
            </div>

            <div className="equations">
              {inv && (
                <div className="equation">
                  <h3>Inventory, all products (units)</h3>
                  <p>
                    <span>{num(inv.opening)}<small>opening</small></span>+<span>{num(inv.received)}<small>received</small></span>−
                    <span>{num(inv.sold)}<small>sold</small></span>−<span>{num(inv.expired)}<small>expired</small></span>=
                    <span className="eq-result">{num(inv.closing)}<small>closing Day 60</small></span>
                  </p>
                </div>
              )}
              {cash && (
                <div className="equation">
                  <h3>Operating cash (A$)</h3>
                  <p>
                    <span>{money(cash.opening, 2)}<small>opening</small></span>+<span>{money(cash.revenue, 2)}<small>sales revenue</small></span>−
                    <span>{money(cash.spend, 2)}<small>replenishment</small></span>=<span className="eq-result">{money(cash.closing, 2)}<small>closing cash</small></span>
                  </p>
                </div>
              )}
            </div>

            {SECTIONS.map(([key, title]) => (
              <Section title={title} key={key}>
                <ul className="checks">
                  {a.checks
                    .filter((c) => c.section === key)
                    .map((c) => (
                      <li key={c.name}>
                        <Status pass={c.status === 'PASS'} />
                        <div>
                          <strong>{c.name}</strong>
                          <span>{c.detail}</span>
                        </div>
                      </li>
                    ))}
                </ul>
                {key === 'History' && (
                  <Table
                    dense
                    columns={[
                      { key: 'table', label: 'Stored record type' },
                      { key: 'n', label: 'Records retained', num: true, render: (r) => num(r.n) },
                    ]}
                    rows={Object.entries(a.recordCounts).map(([table, n]) => ({ table: TABLE_LABEL[table] ?? table, n }))}
                  />
                )}
                {key === 'Inventory' && !compact && (
                  <Table
                    dense
                    limit={12}
                    columns={[
                      { key: 'name', label: 'Product', render: (r) => <ProductLink id={r.product_id} name={r.name} /> },
                      { key: 'opening', label: 'Opening', num: true },
                      { key: 'received', label: '+ Received', num: true },
                      { key: 'sold', label: '− Sold', num: true },
                      { key: 'expired', label: '− Expired', num: true },
                      { key: 'closing_formula', label: '= Calculated', num: true },
                      { key: 'closing_books', label: 'Closing (books)', num: true },
                      { key: 'sold_lines', label: 'Sold per receipts', num: true },
                      { key: 'pass', label: 'Check', render: (r) => <Status pass={r.pass} /> },
                    ]}
                    rows={a.inventory}
                  />
                )}
                {key === 'Revenue' && !compact && (
                  <Table
                    dense
                    limit={10}
                    columns={[
                      { key: 'day', label: 'Day', render: (r) => <DayLink day={r.day} /> },
                      { key: 'reported', label: 'Daily Report revenue', num: true, render: (r) => money(r.reported, 2) },
                      { key: 'from_transactions', label: 'Sum of transactions', num: true, render: (r) => money(r.from_transactions, 2) },
                      { key: 'txns', label: 'Transactions', num: true },
                      { key: 'pass', label: 'Check', render: (r) => <Status pass={r.pass} /> },
                    ]}
                    rows={a.revenueDaily}
                  />
                )}
                {key === 'Exceptions' && (
                  <>
                    <h3>Business exceptions disclosed (not integrity failures)</h3>
                    <Table
                      dense
                      columns={[
                        { key: 'item', label: 'Item' },
                        { key: 'value', label: 'Count', num: true, render: (r) => num(r.value) },
                        { key: 'note', label: 'Treatment' },
                      ]}
                      rows={a.businessExceptions}
                    />
                  </>
                )}
              </Section>
            ))}
            {compact && (
              <p className="note">
                The full product-by-product inventory and day-by-day revenue reconciliations are on the <a className="link" href={`#/${runId}/assurance`}>Commercial Assurance page</a>.
              </p>
            )}
          </>
        );
      }}
    </Loading>
  );
}

const TABLE_LABEL = {
  run_products: 'Product data (frozen per run)',
  sim_days: 'Simulated days',
  customers: 'Customer visits',
  transactions: 'Transactions',
  transaction_lines: 'Transaction lines',
  batches: 'Stock batches (receipt + expiry date)',
  inventory_movements: 'Inventory movements',
  lost_sales: 'Lost-demand records',
  replenishment_orders: 'Replenishment orders',
  cash_ledger: 'Cash ledger entries',
  brain_events: 'Store Brain events',
  daily_stock: 'Daily stock books (product-days)',
  day_close: 'Daily close books',
};
