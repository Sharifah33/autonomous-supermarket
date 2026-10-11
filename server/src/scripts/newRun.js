import { getDb } from '../db.js';
import { runSimulation } from '../sim/engine.js';

// Usage: npm run new-run [-- <seed>]
const seedArg = process.argv[2];
const db = getDb();
const t0 = Date.now();
const runId = runSimulation(db, { seed: seedArg ? Number(seedArg) : undefined, label: 'Additional verification run' });
const run = db.prepare('SELECT seed FROM runs WHERE run_id=?').get(runId);
console.log(`Created ${runId} (seed ${run.seed}) in ${Date.now() - t0} ms`);
