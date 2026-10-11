import React, { useMemo, useState } from 'react';
import { href } from './router.js';

export const money = (x, dp = 0) =>
  x == null ? '-' : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const num = (x, dp = 0) => (x == null ? '-' : Number(x).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const pct = (x, dp = 1) => (x == null ? '-' : `${Number(x).toFixed(dp)}%`);
export const hhmm = (m) => (m == null ? '-' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

export const MISSION_LABEL = {
  COMMUTER: 'Commuter grab-and-go',
  LUNCH: 'Lunch run',
  SNACK: 'Snack & drink top-up',
  DINNER_TOPUP: 'Dinner / top-up shop',
  STOCK_UP: 'Household stock-up',
};
export const EVENT_LABEL = {
  SOLD_OUT: 'Sold out (during trading)',
  SOLD_OUT_RESPONSE: 'Sold-out response',
  LOW_STOCK: 'Low stock',
  EXPIRY_WRITE_OFF: 'Expiry write-off',
  EXPIRY_WARNING: 'Near-expiry warning',
  SLOW_MOVER: 'Slow-moving stock',
  WASTE_ADJUST: 'Waste-aware order adjustment',
  CASH_CONSTRAINED: 'Cash-constrained order',
  CASH_REVIEW: 'Daily cash & ordering review',
  END_OF_HORIZON: 'End of horizon (Day 60)',
};

export const RunContext = React.createContext({ runId: null });
export function useRun() {
  return React.useContext(RunContext);
}

export function L({ page, arg, query, children, className }) {
  const { runId } = useRun();
  return (
    <a className={className ?? 'link'} href={href(runId, page, arg, query)}>
      {children}
    </a>
  );
}
export const DayLink = ({ day, children }) => <L page="day" arg={day} className="link nowrap">{children ?? `Day ${day}`}</L>;
export const ProductLink = ({ id, name }) => <L page="product" arg={id}>{name ?? id}</L>;

export function Page({ title, intro, actions, children }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {intro && <p className="intro">{intro}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({ title, note, children, id }) {
  return (
    <section className="section" id={id}>
      <div className="section-head">
        <h2>{title}</h2>
        {note && <p className="note">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, to }) {
  const body = (
    <>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return to ? (
    <L page={to.page} arg={to.arg} query={to.query} className={`stat stat-link ${tone ?? ''}`}>{body}</L>
  ) : (
    <div className={`stat ${tone ?? ''}`}>{body}</div>
  );
}
export const Stats = ({ children }) => <div className="stats">{children}</div>;

export function Status({ pass, children }) {
  return <span className={`status ${pass ? 'pass' : 'fail'}`}>{children ?? (pass ? 'PASS' : 'FAIL')}</span>;
}
export function Sev({ s }) {
  return <span className={`sev sev-${s?.toLowerCase()}`}>{s === 'CRITICAL' ? 'Critical' : s === 'WARN' ? 'Warning' : 'Info'}</span>;
}

// Simple sortable table. columns: [{key, label, render?, num?, sort?}]
export function Table({ columns, rows, initialSort, limit, empty = 'No records.', dense, rowKey }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = col?.sort ?? ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1);
    });
  }, [rows, sort, columns]);
  const shown = limit && !showAll ? sorted.slice(0, limit) : sorted;
  if (!rows?.length) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className={dense ? 'dense' : ''}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''}>
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                  aria-label={`Sort by ${c.label}`}
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {limit && rows.length > limit && (
        <button type="button" className="more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export function Loading({ state, children }) {
  if (state.error) return <div className="error">Could not load this view: {state.error}. Check that the API server is running (npm run dev).</div>;
  if (!state.data) return <div className="loading">Loading from the run history…</div>;
  return children(state.data);
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => onChange(t.id)} type="button">
          {t.label}
        </button>
      ))}
    </div>
  );
}

export const CAT_COLORS = {
  'Ready-to-Eat': '#0B5D4B',
  Drinks: '#2F6F9F',
  'Dairy & Chilled': '#7FA7C4',
  'Fresh Produce': '#5E9C5A',
  'Snacks & Confectionery': '#C98A1B',
  Bakery: '#A9673D',
  'Pantry & Grocery': '#6B6B8F',
  'Household & Personal Care': '#8C9AA0',
};
