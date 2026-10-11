import { getDb, DB_PATH } from '../db.js';
import { ensureSubmittedRun } from './bootstrap.js';

const db = getDb();
const runId = ensureSubmittedRun(db);
console.log(`Submitted Run: ${runId} (database ${DB_PATH})`);
