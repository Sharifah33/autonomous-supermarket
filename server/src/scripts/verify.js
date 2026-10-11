import { getDb } from '../db.js';
import { assurance } from '../reports/assurance.js';

// Usage: npm run verify [-- RUN-0001]   (defaults to the Submitted Run)
const db = getDb();
const runId = process.argv[2] || db.prepare('SELECT run_id FROM submitted_run WHERE id=1').get()?.run_id;
if (!runId) {
  console.error('No Submitted Run found. Run `npm run seed` first.');
  process.exit(1);
}
const a = assurance(db, runId);
for (const c of a.checks) console.log(`${c.status.padEnd(4)}  [${c.section}] ${c.name}\n        ${c.detail}`);
console.log(`\nOverall: ${a.overall} for ${runId}`);
process.exit(a.overall === 'PASS' ? 0 : 1);
