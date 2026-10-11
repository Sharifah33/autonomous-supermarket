import React, { useEffect, useState } from 'react';
import { useApi } from './api.js';
import { href, useRoute } from './router.js';
import { RunContext, money } from './ui.jsx';
import ModelPage from './pages/ModelPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import DailyPage from './pages/DailyPage.jsx';
import ProductPage from './pages/ProductPage.jsx';
import BrainPage from './pages/BrainPage.jsx';
import AssurancePage from './pages/AssurancePage.jsx';
import RunsPage from './pages/RunsPage.jsx';
import TransactionPage from './pages/TransactionPage.jsx';

const NAV = [
  { page: 'report', label: '60-Day Commercial Report' },
  { page: 'day', label: 'Daily Reports' },
  { page: 'assurance', label: 'Commercial Assurance' },
  { page: 'brain', label: 'Store Brain log' },
  { page: 'product', label: 'Product trace' },
  { page: 'model', label: 'Model Declaration' },
  { page: 'runs', label: 'Simulation runs' },
];

export default function App() {
  const route = useRoute();
  const [runsVersion, setRunsVersion] = useState(0);
  useEffect(() => {
    const bump = () => setRunsVersion((v) => v + 1);
    window.addEventListener('runs-changed', bump);
    return () => window.removeEventListener('runs-changed', bump);
  }, []);
  const runs = useApi(`/runs?v=${runsVersion}`);
  const submitted = runs.data?.submitted;

  useEffect(() => {
    if (submitted && (!route.runId || !route.page)) window.location.replace(href(submitted, 'report'));
  }, [submitted, route.runId, route.page]);

  const runId = route.runId ?? submitted;
  const run = runs.data?.runs.find((r) => r.run_id === runId);

  return (
    <RunContext.Provider value={{ runId, run, submitted }}>
      <div className="shell">
        <aside className="side">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <strong>Swanston St</strong>
              <span>Remote manager console</span>
            </div>
          </div>
          {run && (
            <div className={`run-label ${run.is_submitted ? 'is-submitted' : ''}`}>
              <span className="run-kind">{run.is_submitted ? 'Submitted Run' : 'Verification run'}</span>
              <span className="run-id">{run.run_id}</span>
              <span className="run-facts">
                60 days, seed {run.seed}
                <br />
                Revenue {money(run.revenue)}, cash {money(run.closing_cash)}
              </span>
            </div>
          )}
          <nav aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.page} href={href(runId, n.page)} className={route.page === n.page ? 'on' : ''}>
                {n.label}
              </a>
            ))}
          </nav>
          {runs.data && runs.data.runs.length > 1 && (
            <label className="run-switch">
              Viewing run
              <select
                value={runId ?? ''}
                onChange={(e) => {
                  window.location.hash = href(e.target.value, route.page && route.page !== 'runs' ? route.page : 'report', ['day', 'product'].includes(route.page) ? route.arg : undefined);
                }}
              >
                {runs.data.runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.run_id}
                    {r.is_submitted ? ' (Submitted)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </aside>
        <main className="main">
          {runs.error && <div className="error">The API is not reachable ({runs.error}). Start it with npm run dev from the project folder.</div>}
          {runId && <Router route={route} key={runId} />}
        </main>
      </div>
    </RunContext.Provider>
  );
}

function Router({ route }) {
  switch (route.page) {
    case 'model':
      return <ModelPage />;
    case 'day':
      return <DailyPage day={Number(route.arg || 1)} query={route.query} />;
    case 'product':
      return <ProductPage productId={route.arg} />;
    case 'brain':
      return <BrainPage query={route.query} />;
    case 'assurance':
      return <AssurancePage />;
    case 'runs':
      return <RunsPage />;
    case 'txn':
      return <TransactionPage txnId={Number(route.arg)} />;
    case 'report':
    default:
      return <ReportPage tab={route.arg || 'performance'} />;
  }
}
