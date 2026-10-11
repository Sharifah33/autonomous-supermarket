import { runSimulation } from '../sim/engine.js';

// Seed used for the Submitted Run. Recorded in runs.seed for audit.
export const SUBMITTED_SEED = 20261011;

// If the database has no designated Submitted Run (e.g. a fresh clone without the database file),
// create one completed 60-day run and designate it. Never touches an existing run.
export function ensureSubmittedRun(db, { quiet = false } = {}) {
  const existing = db.prepare('SELECT run_id FROM submitted_run WHERE id = 1').get();
  if (existing) return existing.run_id;
  const runId = runSimulation(db, { seed: SUBMITTED_SEED, label: 'Submitted Run' });
  db.prepare('INSERT INTO submitted_run (id, run_id, designated_at) VALUES (1, ?, ?)').run(runId, new Date().toISOString());
  if (!quiet) console.log(`Created and designated Submitted Run ${runId}`);
  return runId;
}
