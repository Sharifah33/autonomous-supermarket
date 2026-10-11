import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './db.js';
import { runSimulation } from './sim/engine.js';
import { runMeta, performance, operations, productTable } from './reports/reports.js';
import { assurance } from './reports/assurance.js';
import { dailyReport, dayTransactions, transactionDetail, productTrace, brainLog } from './reports/daily.js';
import { findings } from './reports/findings.js';
import { ensureSubmittedRun } from './scripts/bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const db = getDb();
ensureSubmittedRun(db);

const app = express();
app.use(express.json());

// Small helper: wrap handlers, 404 on null, JSON errors.
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out == null) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const runGuard = (req) => {
  const run = db.prepare('SELECT run_id, status FROM runs WHERE run_id=?').get(req.params.runId);
  if (!run) throw Object.assign(new Error('Unknown run'), { status: 404 });
  if (run.status !== 'COMPLETED') throw new Error('Run not completed');
  return run.run_id;
};

app.get('/api/health', h(() => ({ ok: true, db: DB_PATH })));

app.get('/api/runs', h(() => {
  const submitted = db.prepare('SELECT run_id FROM submitted_run WHERE id=1').get()?.run_id ?? null;
  const runs = db.prepare(`SELECT r.run_id, r.label, r.status, r.seed, r.model_version, r.created_at, r.completed_at, r.runtime_ms, r.opening_inventory_cost,
      (SELECT ROUND(SUM(revenue),2) FROM day_close c WHERE c.run_id=r.run_id) revenue,
      (SELECT closing_cash FROM day_close c WHERE c.run_id=r.run_id AND c.day=r.horizon_days) closing_cash,
      (SELECT SUM(customers) FROM day_close c WHERE c.run_id=r.run_id) customers
    FROM runs r ORDER BY r.run_id`).all();
  return { submitted, runs: runs.map((r) => ({ ...r, is_submitted: r.run_id === submitted })) };
}));

// Start a NEW run (the only write operation exposed by the API). Existing runs are never modified.
app.post('/api/runs', h((req) => {
  const seed = req.body?.seed != null && req.body.seed !== '' ? Number(req.body.seed) : undefined;
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error('seed must be an integer');
  const t0 = Date.now();
  const runId = runSimulation(db, { seed, label: req.body?.label || 'Additional verification run' });
  return { run_id: runId, ms: Date.now() - t0 };
}));

app.get('/api/runs/:runId', h((req) => runMeta(db, runGuard(req))));
app.get('/api/runs/:runId/products', h((req) => productTable(db, runGuard(req))));
app.get('/api/runs/:runId/report/performance', h((req) => performance(db, runGuard(req))));
app.get('/api/runs/:runId/report/operations', h((req) => operations(db, runGuard(req))));
app.get('/api/runs/:runId/report/findings', h((req) => findings(db, runGuard(req))));
app.get('/api/runs/:runId/assurance', h((req) => assurance(db, runGuard(req))));
app.get('/api/runs/:runId/days/:day', h((req) => dailyReport(db, runGuard(req), Number(req.params.day))));
app.get('/api/runs/:runId/days/:day/transactions', h((req) =>
  dayTransactions(db, runGuard(req), Number(req.params.day), { page: Number(req.query.page || 1), productId: req.query.product || null })));
app.get('/api/runs/:runId/transactions/:txnId', h((req) => transactionDetail(db, runGuard(req), Number(req.params.txnId))));
app.get('/api/runs/:runId/product/:productId', h((req) => productTrace(db, runGuard(req), req.params.productId)));
app.get('/api/runs/:runId/brain', h((req) =>
  brainLog(db, runGuard(req), { type: req.query.type || null, productId: req.query.product || null, day: req.query.day ? Number(req.query.day) : null, page: Number(req.query.page || 1) })));

// There are deliberately NO update/delete endpoints for runs or history.

// Serve the built React app (npm start). In development Vite serves the client and proxies /api.
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Autonomous Supermarket API on http://localhost:${PORT}  (database: ${DB_PATH})`);
});
