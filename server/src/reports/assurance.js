import { HISTORY_TABLES } from '../db.js';
import { makeQ, runMeta } from './reports.js';

// Commercial Assurance: independent checks over the stored history of one run.
// Several checks compare two independently written records - e.g. the engine's own end-of-day books
// (day_close, daily_stock) against the event-level logs (transactions, inventory_movements, cash_ledger).

const TOL = 0.005;
const eq = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < TOL;
const r2 = (x) => Math.round((x ?? 0) * 100) / 100;

export function assurance(db, runId) {
  const { all, get } = makeQ(db, runId);
  const run = runMeta(db, runId);
  const H = run.horizon_days;
  const checks = [];
  const add = (section, name, pass, detail, evidence = null) => checks.push({ section, name, status: pass ? 'PASS' : 'FAIL', detail, evidence });

  // ===== 1. History completeness =====
  const counts = {};
  for (const t of HISTORY_TABLES) counts[t] = get(`SELECT COUNT(*) n FROM ${t} WHERE run_id=@r`).n;
  const days = get(`SELECT COUNT(DISTINCT day) n, MIN(day) mn, MAX(day) mx FROM sim_days WHERE run_id=@r`);
  add('History', 'Run completed and configuration frozen', run.status === 'COMPLETED' && !!run.config,
    `Run ${runId} status ${run.status}; seed ${run.seed}; model ${run.model_version}; completed ${run.completed_at}`);
  add('History', `${H}/${H} simulated days retained`, days.n === H && days.mn === 1 && days.mx === H, `${days.n}/${H} days (Day ${days.mn}-${days.mx})`);
  const dayClose = get(`SELECT COUNT(*) n FROM day_close WHERE run_id=@r`).n;
  const nProducts = get(`SELECT COUNT(*) n FROM run_products WHERE run_id=@r`).n;
  add('History', 'Daily Report books retained for every day', dayClose === H && counts.daily_stock === H * nProducts,
    `${dayClose} day-close records; ${counts.daily_stock} product-day stock records (${H} x ${nProducts})`);
  const daysNoTxn = get(`SELECT COUNT(*) n FROM sim_days d WHERE d.run_id=@r AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.run_id=d.run_id AND t.day=d.day)`).n;
  add('History', 'Every day has recorded trading', daysNoTxn === 0, `${daysNoTxn} days without transactions`);
  const reviews = get(`SELECT SUM(event_type='CASH_REVIEW') cr, SUM(event_type='END_OF_HORIZON') eoh, COUNT(DISTINCT CASE WHEN phase='CLOSE' THEN day END) d FROM brain_events WHERE run_id=@r`);
  add('History', 'Store Brain close review recorded every day', reviews.d === H && reviews.cr === H - 1 && reviews.eoh === 1,
    `${reviews.cr} close reviews with ordering (Days 1-${H - 1}) + ${reviews.eoh} end-of-horizon review (Day ${H})`);
  const triggers = get(`SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND (name LIKE '%_no_update' OR name LIKE '%_no_delete' OR name LIKE '%_only_running' OR name='runs_frozen')`).n;
  let tamper = 'not attempted';
  try {
    db.prepare('UPDATE transactions SET total = total + 1 WHERE run_id = ? AND txn_id = 1').run(runId);
    tamper = 'UPDATE SUCCEEDED (protection missing)';
  } catch (e) {
    tamper = `blocked: "${e.message}"`;
  }
  add('History', 'History is append-only (live tamper test)', tamper.startsWith('blocked') && triggers >= HISTORY_TABLES.length * 3 + 1,
    `${triggers} database guard triggers active; test edit of transaction #1 ${tamper}`);

  // ===== 2. Inventory reconciliation =====
  const inv = all(`
    SELECT p.product_id, p.name, p.initial_qty,
      COALESCE(SUM(CASE WHEN m.type='OPENING' THEN m.qty END),0) AS opening,
      COALESCE(SUM(CASE WHEN m.type='RECEIPT' THEN m.qty END),0) AS received,
      COALESCE(-SUM(CASE WHEN m.type='SALE' THEN m.qty END),0) AS sold,
      COALESCE(-SUM(CASE WHEN m.type='EXPIRY' THEN m.qty END),0) AS expired,
      COALESCE(SUM(m.qty),0) AS closing_movements,
      (SELECT closing_qty FROM daily_stock d WHERE d.run_id=p.run_id AND d.product_id=p.product_id AND d.day=@h) AS closing_books,
      COALESCE((SELECT SUM(qty) FROM transaction_lines l WHERE l.run_id=p.run_id AND l.product_id=p.product_id),0) AS sold_lines,
      COALESCE((SELECT SUM(qty) FROM replenishment_orders o WHERE o.run_id=p.run_id AND o.product_id=p.product_id),0) AS ordered
    FROM run_products p LEFT JOIN inventory_movements m ON m.run_id=p.run_id AND m.product_id=p.product_id
    WHERE p.run_id=@r GROUP BY p.product_id ORDER BY p.product_id`, { h: H });
  for (const x of inv) {
    x.closing_formula = x.opening + x.received - x.sold - x.expired;
    x.pass = x.closing_formula === x.closing_books && x.closing_movements === x.closing_books && x.sold === x.sold_lines && x.opening === x.initial_qty && x.received === x.ordered;
  }
  const invFail = inv.filter((x) => !x.pass);
  const invTot = inv.reduce((a, x) => ({ opening: a.opening + x.opening, received: a.received + x.received, sold: a.sold + x.sold, expired: a.expired + x.expired, closing: a.closing + x.closing_books }), { opening: 0, received: 0, sold: 0, expired: 0, closing: 0 });
  add('Inventory', 'Opening + received - sold - expired = closing (all products)', invFail.length === 0,
    `${invTot.opening} + ${invTot.received} - ${invTot.sold} - ${invTot.expired} = ${invTot.opening + invTot.received - invTot.sold - invTot.expired}; closing stock in Day ${H} books = ${invTot.closing}; ${inv.length - invFail.length}/${inv.length} products reconcile`,
    { type: 'inventory', totals: invTot });
  const cont = get(`SELECT
      SUM(d.opening_qty + d.received_qty - d.expired_qty - d.sold_qty <> d.closing_qty) AS formula_breaks,
      SUM(d.day > 1 AND d.opening_qty <> (SELECT closing_qty FROM daily_stock y WHERE y.run_id=d.run_id AND y.product_id=d.product_id AND y.day=d.day-1)) AS carry_breaks,
      SUM(d.sold_qty <> COALESCE((SELECT -SUM(qty) FROM inventory_movements m WHERE m.run_id=d.run_id AND m.product_id=d.product_id AND m.day=d.day AND m.type='SALE'),0)) AS sale_breaks,
      SUM(d.expired_qty <> COALESCE((SELECT -SUM(qty) FROM inventory_movements m WHERE m.run_id=d.run_id AND m.product_id=d.product_id AND m.day=d.day AND m.type='EXPIRY'),0)) AS expiry_breaks,
      SUM(d.received_qty <> COALESCE((SELECT SUM(qty) FROM inventory_movements m WHERE m.run_id=d.run_id AND m.product_id=d.product_id AND m.day=d.day AND m.type IN ('OPENING','RECEIPT')),0)) AS receipt_breaks,
      COUNT(*) AS n
    FROM daily_stock d WHERE d.run_id=@r`);
  const contBreaks = cont.formula_breaks + cont.carry_breaks + cont.sale_breaks + cont.expiry_breaks + cont.receipt_breaks;
  add('Inventory', 'Daily stock books agree with movement log for every product-day', contBreaks === 0,
    `${cont.n} product-days checked: ${cont.formula_breaks} formula, ${cont.carry_breaks} carry-forward, ${cont.sale_breaks} sales, ${cont.expiry_breaks} expiry, ${cont.receipt_breaks} receipt mismatches`);
  const neg = get(`SELECT COUNT(*) n FROM (SELECT batch_id, SUM(qty) OVER (PARTITION BY batch_id ORDER BY movement_id) bal FROM inventory_movements WHERE run_id=@r) WHERE bal < 0`).n;
  add('Inventory', 'No negative stock (running balance of every batch >= 0)', neg === 0, `${neg} movements left a batch below zero across ${counts.inventory_movements} movements`);
  const over = get(`SELECT COUNT(*) n FROM (SELECT l.txn_id, l.product_id, SUM(l.qty) q,
        (SELECT -SUM(m.qty) FROM inventory_movements m WHERE m.run_id=l.run_id AND m.ref_type='TXN' AND m.ref_id=l.txn_id AND m.product_id=l.product_id) mq
      FROM transaction_lines l WHERE l.run_id=@r GROUP BY l.txn_id, l.product_id) WHERE q <> COALESCE(mq,0)`).n;
  add('Inventory', 'No overselling (every sold unit drawn from a batch holding stock)', over === 0 && neg === 0, `${over} transaction lines without matching stock draw-down`);
  const expSale = get(`SELECT COUNT(*) n FROM inventory_movements m JOIN batches b ON b.run_id=m.run_id AND b.batch_id=m.batch_id
      WHERE m.run_id=@r AND m.type='SALE' AND b.expiry_day IS NOT NULL AND m.day >= b.expiry_day`).n;
  const expTiming = get(`SELECT COUNT(*) n FROM inventory_movements m JOIN batches b ON b.run_id=m.run_id AND b.batch_id=m.batch_id
      WHERE m.run_id=@r AND m.type='EXPIRY' AND (b.expiry_day IS NULL OR m.day <> b.expiry_day)`).n;
  add('Inventory', 'No expired product sold; expiry removed on the expiry morning', expSale === 0 && expTiming === 0,
    `${expSale} sales from batches on/after expiry day; ${expTiming} write-offs on the wrong day`);
  const rcv = get(`SELECT COUNT(*) n, SUM(CASE WHEN b.qty_received<>o.qty OR b.received_day<>o.delivery_day OR o.delivery_day<>o.day_placed+1 THEN 1 ELSE 0 END) bad,
      (SELECT COUNT(*) FROM replenishment_orders WHERE run_id=@r AND day_placed >= @h) late
      FROM replenishment_orders o LEFT JOIN batches b ON b.run_id=o.run_id AND b.order_id=o.order_id WHERE o.run_id=@r`, { h: H });
  add('Inventory', 'Every order received in full next morning (1-day lead time); none after Day 60', rcv.bad === 0 && rcv.late === 0,
    `${rcv.n} orders; ${rcv.bad} with quantity/lead-time mismatch; ${rcv.late} placed on Day ${H}`);
  add('Inventory', 'Opening inventory within A$40,000 budget', run.opening_inventory_cost <= run.inventory_budget + TOL,
    `Opening inventory cost $${run.opening_inventory_cost.toFixed(2)} <= $${run.inventory_budget.toFixed(2)}`);

  // ===== 3. Revenue reconciliation =====
  const txnBad = get(`SELECT COUNT(*) n FROM transactions t WHERE t.run_id=@r AND ABS(t.total - (SELECT SUM(line_total) FROM transaction_lines l WHERE l.run_id=t.run_id AND l.txn_id=t.txn_id)) > 0.005`).n;
  const lineBad = get(`SELECT COUNT(*) n FROM transaction_lines WHERE run_id=@r AND ABS(line_total - qty*unit_price) > 0.005`).n;
  add('Revenue', 'Each transaction total = sum of its line items', txnBad === 0 && lineBad === 0, `${counts.transactions} transactions, ${counts.transaction_lines} lines; ${txnBad} total mismatches; ${lineBad} line mismatches`);
  const revDaily = all(`SELECT c.day, c.revenue AS reported, ROUND(COALESCE((SELECT SUM(total) FROM transactions t WHERE t.run_id=c.run_id AND t.day=c.day),0),2) AS from_transactions,
      (SELECT COUNT(*) FROM transactions t WHERE t.run_id=c.run_id AND t.day=c.day) AS txns, c.transactions AS reported_txns
    FROM day_close c WHERE c.run_id=@r ORDER BY c.day`);
  for (const d of revDaily) d.pass = eq(d.reported, d.from_transactions) && d.txns === d.reported_txns;
  const revFail = revDaily.filter((d) => !d.pass);
  add('Revenue', 'Daily revenue = sum of that day\'s recorded transactions (all days)', revFail.length === 0,
    `${revDaily.length - revFail.length}/${revDaily.length} days reconcile`, { type: 'revenue_daily' });
  const sumDaily = r2(revDaily.reduce((s, d) => s + d.reported, 0));
  const sumTxn = r2(get(`SELECT SUM(total) s FROM transactions WHERE run_id=@r`).s);
  const sumLedger = r2(get(`SELECT SUM(amount) s FROM cash_ledger WHERE run_id=@r AND type='SALE'`).s);
  add('Revenue', `${H}-day revenue = sum of daily revenue = sum of transactions = cash received`, eq(sumDaily, sumTxn) && eq(sumTxn, sumLedger),
    `Sum of daily revenue $${sumDaily.toFixed(2)}; sum of transactions $${sumTxn.toFixed(2)}; SALE cash receipts $${sumLedger.toFixed(2)}`);
  const cogsBad = get(`SELECT COUNT(*) n FROM transaction_lines l JOIN run_products p ON p.run_id=l.run_id AND p.product_id=l.product_id WHERE l.run_id=@r AND (l.unit_cost<>p.unit_cost OR l.unit_price<>p.unit_price)`).n;
  const cogsDaily = get(`SELECT SUM(ABS(c.cogs - COALESCE(x.cogs,0)) > 0.005) n FROM day_close c
      LEFT JOIN (SELECT t.day, SUM(l.qty*l.unit_cost) cogs FROM transactions t JOIN transaction_lines l ON l.run_id=t.run_id AND l.txn_id=t.txn_id WHERE t.run_id=@r GROUP BY t.day) x ON x.day=c.day
      WHERE c.run_id=@r`).n;
  add('Revenue', 'COGS uses catalogue cost/price; daily COGS reconciles', cogsBad === 0 && cogsDaily === 0, `${cogsBad} lines priced off-catalogue; ${cogsDaily} days with COGS mismatch`);

  // ===== 4. Operating-cash reconciliation =====
  const spend = r2(-get(`SELECT SUM(amount) s FROM cash_ledger WHERE run_id=@r AND type='REPLENISHMENT'`).s);
  const orderSpend = r2(get(`SELECT SUM(total_cost) s FROM replenishment_orders WHERE run_id=@r`).s);
  const closing = get(`SELECT balance_after b FROM cash_ledger WHERE run_id=@r ORDER BY entry_id DESC LIMIT 1`).b;
  const formula = r2(run.opening_cash + sumTxn - spend);
  add('Cash', 'Closing cash = opening cash + sales revenue - replenishment spending', eq(closing, formula) && eq(spend, orderSpend),
    `$${run.opening_cash.toFixed(2)} + $${sumTxn.toFixed(2)} - $${spend.toFixed(2)} = $${formula.toFixed(2)}; ledger closing balance $${closing.toFixed(2)}`,
    { type: 'cash', opening: run.opening_cash, revenue: sumTxn, spend, closing });
  const breaks = get(`SELECT COUNT(*) n FROM (SELECT amount, balance_after, LAG(balance_after) OVER (ORDER BY entry_id) prev, entry_id FROM cash_ledger WHERE run_id=@r)
      WHERE (prev IS NULL AND ABS(balance_after - @oc) > 0.005) OR (prev IS NOT NULL AND ABS(prev + amount - balance_after) > 0.005)`, { oc: run.opening_cash }).n;
  add('Cash', 'Cash ledger is continuous (no unexplained movement)', breaks === 0, `${counts.cash_ledger} ledger entries; ${breaks} balance breaks`);
  const ord = get(`SELECT COUNT(*) n, SUM(total_cost > cash_before + 0.005) over_cash, SUM(ABS(total_cost - qty*unit_cost) > 0.005) cost_bad,
      SUM(ABS(cash_after - (cash_before - total_cost)) > 0.005) after_bad, MIN(cash_after) min_after, SUM(cash_constrained) constrained FROM replenishment_orders WHERE run_id=@r`);
  add('Cash', 'No replenishment order exceeded cash available when placed', ord.over_cash === 0 && ord.cost_bad === 0 && ord.after_bad === 0,
    `${ord.n} orders; ${ord.over_cash} exceeded cash; lowest cash after any order $${(ord.min_after ?? 0).toFixed(2)}; ${ord.constrained} orders reduced by the cash rule`);
  const neg2 = get(`SELECT COUNT(*) n, MIN(balance_after) mn FROM cash_ledger WHERE run_id=@r AND balance_after < 0`);
  add('Cash', 'Operating cash never negative', neg2.n === 0, `${neg2.n} negative balances`);
  const dc = get(`SELECT SUM(ABS(c.closing_cash - (SELECT balance_after FROM cash_ledger l WHERE l.run_id=c.run_id AND l.day=c.day ORDER BY entry_id DESC LIMIT 1)) > 0.005) close_bad,
      SUM(ABS(c.replenishment_spend - COALESCE((SELECT SUM(total_cost) FROM replenishment_orders o WHERE o.run_id=c.run_id AND o.day_placed=c.day),0)) > 0.005) spend_bad,
      SUM(c.day>1 AND ABS(c.opening_cash - (SELECT closing_cash FROM day_close y WHERE y.run_id=c.run_id AND y.day=c.day-1)) > 0.005) carry_bad
    FROM day_close c WHERE c.run_id=@r`);
  add('Cash', 'Daily cash books agree with ledger and orders', dc.close_bad + dc.spend_bad + dc.carry_bad === 0,
    `${dc.close_bad} closing-balance, ${dc.spend_bad} spend, ${dc.carry_bad} carry-forward mismatches across ${H} days`);

  // ===== 5. Exceptions =====
  const failures = checks.filter((c) => c.status === 'FAIL');
  const biz = get(`SELECT
      (SELECT COUNT(*) FROM brain_events WHERE run_id=@r AND event_type='SOLD_OUT') sold_out,
      (SELECT COALESCE(SUM(qty),0) FROM lost_sales WHERE run_id=@r) lost_units,
      (SELECT COALESCE(-SUM(qty),0) FROM inventory_movements WHERE run_id=@r AND type='EXPIRY') expired_units,
      (SELECT COUNT(DISTINCT product_id) FROM brain_events WHERE run_id=@r AND event_type='SLOW_MOVER') slow,
      (SELECT COUNT(*) FROM brain_events WHERE run_id=@r AND event_type='CASH_CONSTRAINED') cash_constrained,
      (SELECT COUNT(*) FROM customers WHERE run_id=@r AND outcome='NO_PURCHASE_STOCKOUT') walkouts`);
  const businessExceptions = [
    { item: 'Sold-out events', value: biz.sold_out, note: 'Business outcome (availability), not an integrity failure' },
    { item: 'Units of demand lost to stockouts', value: biz.lost_units, note: 'Recorded in lost_sales; not revenue' },
    { item: 'Customers leaving with nothing (all wanted items unavailable)', value: biz.walkouts, note: 'Counted in customers, no transaction' },
    { item: 'Units expired and written off', value: biz.expired_units, note: 'Removed before opening; never sold' },
    { item: 'Products flagged as slow movers', value: biz.slow, note: 'Capital tied up; flagged to manager' },
    { item: 'Orders reduced/skipped by cash constraint', value: biz.cash_constrained, note: 'Zero = cash never binding in this run' },
  ];
  add('Exceptions', 'No unresolved integrity failures', failures.length === 0,
    failures.length ? `${failures.length} failed checks: ${failures.map((f) => f.name).join('; ')}` : 'All integrity checks passed; business exceptions disclosed separately below');

  return {
    run_id: runId, overall: failures.length === 0 ? 'PASS' : 'FAIL', checks,
    recordCounts: counts, inventory: inv, revenueDaily: revDaily, businessExceptions,
    generated_at: new Date().toISOString(),
  };
}
