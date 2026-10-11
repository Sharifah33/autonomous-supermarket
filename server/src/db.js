import Database from './sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'supermarket.db');

// History tables: written only while their run is RUNNING, never updated or deleted.
export const HISTORY_TABLES = [
  'run_products',
  'sim_days',
  'customers',
  'transactions',
  'transaction_lines',
  'batches',
  'inventory_movements',
  'lost_sales',
  'replenishment_orders',
  'cash_ledger',
  'brain_events',
  'daily_stock',
  'day_close',
];

const SCHEMA = `
-- ===== Model configuration (frozen per run) =====
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  label TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED')),
  seed INTEGER NOT NULL,
  horizon_days INTEGER NOT NULL,
  opening_cash REAL NOT NULL,
  inventory_budget REAL NOT NULL,
  opening_inventory_cost REAL NOT NULL,
  model_version TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  runtime_ms INTEGER
);

CREATE TABLE IF NOT EXISTS run_products (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  category_code TEXT NOT NULL,
  unit_cost REAL NOT NULL,
  unit_price REAL NOT NULL,
  initial_qty INTEGER NOT NULL,
  perishable INTEGER NOT NULL,
  shelf_life_days INTEGER,
  case_size INTEGER NOT NULL,
  popularity REAL NOT NULL,
  plan_daily_units REAL NOT NULL,
  PRIMARY KEY (run_id, product_id)
) WITHOUT ROWID;

-- Single designated Submitted Run (set once, cannot be changed through the application)
CREATE TABLE IF NOT EXISTS submitted_run (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  designated_at TEXT NOT NULL
);

-- ===== Recorded history (append-only) =====
CREATE TABLE IF NOT EXISTS sim_days (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  day INTEGER NOT NULL,
  weekday TEXT NOT NULL,
  is_weekend INTEGER NOT NULL,
  ramp_factor REAL NOT NULL,
  expected_customers REAL NOT NULL,
  PRIMARY KEY (run_id, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS customers (
  run_id TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  arrival_min INTEGER NOT NULL,      -- minutes after midnight
  mission TEXT NOT NULL,
  intended_lines INTEGER NOT NULL,
  outcome TEXT NOT NULL,             -- PURCHASED | NO_PURCHASE_STOCKOUT
  PRIMARY KEY (run_id, customer_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_customers_day ON customers(run_id, day);

CREATE TABLE IF NOT EXISTS transactions (
  run_id TEXT NOT NULL,
  txn_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  time_min INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  units INTEGER NOT NULL,
  total REAL NOT NULL,
  PRIMARY KEY (run_id, txn_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_txn_day ON transactions(run_id, day);

CREATE TABLE IF NOT EXISTS transaction_lines (
  run_id TEXT NOT NULL,
  txn_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL,
  line_total REAL NOT NULL,
  substituted_for TEXT,
  PRIMARY KEY (run_id, txn_id, line_no)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_lines_product ON transaction_lines(run_id, product_id);

CREATE TABLE IF NOT EXISTS batches (
  run_id TEXT NOT NULL,
  batch_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,              -- OPENING | REPLENISHMENT
  order_id INTEGER,
  received_day INTEGER NOT NULL,
  expiry_day INTEGER,                -- first day the batch is NOT saleable (removed that morning); NULL = non-perishable
  qty_received INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  PRIMARY KEY (run_id, batch_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS inventory_movements (
  run_id TEXT NOT NULL,
  movement_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  time_min INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  batch_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('OPENING','RECEIPT','SALE','EXPIRY')),
  qty INTEGER NOT NULL,              -- signed: + into stock, - out of stock
  unit_cost REAL NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  PRIMARY KEY (run_id, movement_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_mov_day ON inventory_movements(run_id, day, product_id);
CREATE INDEX IF NOT EXISTS ix_mov_batch ON inventory_movements(run_id, batch_id);

CREATE TABLE IF NOT EXISTS lost_sales (
  run_id TEXT NOT NULL,
  lost_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  time_min INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  reason TEXT NOT NULL,              -- SOLD_OUT | PARTIAL
  PRIMARY KEY (run_id, lost_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS replenishment_orders (
  run_id TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  day_placed INTEGER NOT NULL,
  delivery_day INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_qty INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  cases INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  cash_before REAL NOT NULL,
  cash_after REAL NOT NULL,
  cash_constrained INTEGER NOT NULL,
  forecast_daily REAL NOT NULL,
  usable_stock INTEGER NOT NULL,
  target_stock REAL NOT NULL,
  PRIMARY KEY (run_id, order_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS cash_ledger (
  run_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  time_min INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('OPENING','SALE','REPLENISHMENT')),
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  ref_id INTEGER,
  PRIMARY KEY (run_id, entry_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_cash_day ON cash_ledger(run_id, day);

CREATE TABLE IF NOT EXISTS brain_events (
  run_id TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  time_min INTEGER NOT NULL,
  phase TEXT NOT NULL,               -- OPEN | TRADING | CLOSE
  product_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,            -- INFO | WARN | CRITICAL
  condition TEXT NOT NULL,           -- what was detected
  action TEXT NOT NULL,              -- what the Brain did
  metrics_json TEXT,
  order_id INTEGER,
  PRIMARY KEY (run_id, event_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_brain_day ON brain_events(run_id, day);
CREATE INDEX IF NOT EXISTS ix_brain_type ON brain_events(run_id, event_type);

-- Store's own end-of-day state as held by the engine (independent of the event log; used by assurance)
CREATE TABLE IF NOT EXISTS daily_stock (
  run_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  opening_qty INTEGER NOT NULL,      -- stock carried in from previous close (or 0 on day 1)
  received_qty INTEGER NOT NULL,     -- opening inventory (day 1) or replenishment received
  expired_qty INTEGER NOT NULL,
  sold_qty INTEGER NOT NULL,
  closing_qty INTEGER NOT NULL,
  closing_value REAL NOT NULL,
  sold_out_min INTEGER,              -- time the product first hit zero during trading
  lost_units INTEGER NOT NULL,
  forecast_next REAL,
  PRIMARY KEY (run_id, day, product_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS day_close (
  run_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  customers INTEGER NOT NULL,
  transactions INTEGER NOT NULL,
  units_sold INTEGER NOT NULL,
  revenue REAL NOT NULL,
  cogs REAL NOT NULL,
  writeoff_value REAL NOT NULL,
  replenishment_spend REAL NOT NULL,
  opening_cash REAL NOT NULL,
  closing_cash REAL NOT NULL,
  closing_inventory_value REAL NOT NULL,
  PRIMARY KEY (run_id, day)
) WITHOUT ROWID;
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS ix_mov_ref ON inventory_movements(run_id, ref_type, ref_id);
CREATE INDEX IF NOT EXISTS ix_orders_product ON replenishment_orders(run_id, product_id, day_placed);
CREATE INDEX IF NOT EXISTS ix_orders_day ON replenishment_orders(run_id, day_placed);
CREATE INDEX IF NOT EXISTS ix_batches_order ON batches(run_id, order_id);
CREATE INDEX IF NOT EXISTS ix_lost_product ON lost_sales(run_id, product_id);
CREATE INDEX IF NOT EXISTS ix_lost_day ON lost_sales(run_id, day);
CREATE INDEX IF NOT EXISTS ix_txn_customer ON transactions(run_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_brain_product ON brain_events(run_id, product_id, event_type);
CREATE INDEX IF NOT EXISTS ix_stock_product ON daily_stock(run_id, product_id, day);
`;

function guardTriggers() {
  let sql = '';
  for (const t of HISTORY_TABLES) {
    sql += `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t}
BEGIN SELECT RAISE(ABORT, 'append-only history: ${t} rows cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t}
BEGIN SELECT RAISE(ABORT, 'append-only history: ${t} rows cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_only_running BEFORE INSERT ON ${t}
WHEN (SELECT status FROM runs WHERE run_id = NEW.run_id) IS NOT 'RUNNING'
BEGIN SELECT RAISE(ABORT, 'history can only be appended to a RUNNING run'); END;`;
  }
  sql += `
CREATE TRIGGER IF NOT EXISTS runs_frozen BEFORE UPDATE ON runs
WHEN OLD.status = 'COMPLETED'
  OR NEW.run_id IS NOT OLD.run_id OR NEW.seed IS NOT OLD.seed OR NEW.config_json IS NOT OLD.config_json
  OR NEW.opening_cash IS NOT OLD.opening_cash OR NEW.inventory_budget IS NOT OLD.inventory_budget
  OR NEW.opening_inventory_cost IS NOT OLD.opening_inventory_cost OR NEW.horizon_days IS NOT OLD.horizon_days
BEGIN SELECT RAISE(ABORT, 'run configuration is frozen; only RUNNING -> COMPLETED is allowed'); END;
CREATE TRIGGER IF NOT EXISTS runs_no_delete BEFORE DELETE ON runs
BEGIN SELECT RAISE(ABORT, 'runs cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS submitted_no_update BEFORE UPDATE ON submitted_run
BEGIN SELECT RAISE(ABORT, 'the Submitted Run designation cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS submitted_no_delete BEFORE DELETE ON submitted_run
BEGIN SELECT RAISE(ABORT, 'the Submitted Run designation cannot be removed'); END;
CREATE TRIGGER IF NOT EXISTS submitted_completed_only BEFORE INSERT ON submitted_run
WHEN (SELECT status FROM runs WHERE run_id = NEW.run_id) IS NOT 'COMPLETED'
BEGIN SELECT RAISE(ABORT, 'only a COMPLETED run can be designated as the Submitted Run'); END;`;
  return sql;
}

let instance;
export function getDb() {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const isNew = !fs.existsSync(DB_PATH);
  instance = new Database(DB_PATH); // SQLite file at DB_PATH (via sql.js, no native build needed)
  instance.pragma('foreign_keys = ON');
  instance.exec(SCHEMA);
  instance.exec(INDEXES);
  instance.exec(guardTriggers());
  const hasStats = instance.prepare("SELECT 1 AS x FROM sqlite_master WHERE name = 'sqlite_stat1'").get();
  if (!hasStats) instance.exec('ANALYZE');
  if (isNew || !hasStats) instance.save();
  return instance;
}
