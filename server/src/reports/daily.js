import { makeQ } from './reports.js';

const r2 = (x) => Math.round((x ?? 0) * 100) / 100;

// One reusable Daily Report, computed from the stored history for the selected day.
export function dailyReport(db, runId, day) {
  const { all, get } = makeQ(db, runId);
  const p = { d: day };
  const meta = get(`SELECT * FROM sim_days WHERE run_id=@r AND day=@d`, p);
  if (!meta) return null;
  const books = get(`SELECT * FROM day_close WHERE run_id=@r AND day=@d`, p);
  const fromHistory = get(`SELECT
      (SELECT COUNT(*) FROM customers WHERE run_id=@r AND day=@d) customers,
      (SELECT COUNT(*) FROM customers WHERE run_id=@r AND day=@d AND outcome='NO_PURCHASE_STOCKOUT') walkouts,
      (SELECT COUNT(*) FROM transactions WHERE run_id=@r AND day=@d) transactions,
      (SELECT ROUND(SUM(total),2) FROM transactions WHERE run_id=@r AND day=@d) revenue,
      (SELECT SUM(units) FROM transactions WHERE run_id=@r AND day=@d) units,
      (SELECT ROUND(SUM(l.qty*l.unit_cost),2) FROM transaction_lines l JOIN transactions t USING(run_id,txn_id) WHERE t.run_id=@r AND t.day=@d) cogs,
      (SELECT ROUND(-SUM(qty*unit_cost),2) FROM inventory_movements WHERE run_id=@r AND day=@d AND type='EXPIRY') writeoff_value,
      (SELECT -SUM(qty) FROM inventory_movements WHERE run_id=@r AND day=@d AND type='EXPIRY') writeoff_units,
      (SELECT ROUND(-SUM(amount),2) FROM cash_ledger WHERE run_id=@r AND day=@d AND type='REPLENISHMENT') replenishment_spend,
      (SELECT COUNT(*) FROM replenishment_orders WHERE run_id=@r AND day_placed=@d) orders_placed,
      (SELECT SUM(qty) FROM inventory_movements WHERE run_id=@r AND day=@d AND type IN ('RECEIPT','OPENING')) units_received,
      (SELECT SUM(qty) FROM lost_sales WHERE run_id=@r AND day=@d) lost_units,
      (SELECT ROUND(SUM(qty*unit_price),2) FROM lost_sales WHERE run_id=@r AND day=@d) lost_value,
      (SELECT balance_after FROM cash_ledger WHERE run_id=@r AND day=@d ORDER BY entry_id DESC LIMIT 1) closing_cash`, p);
  const summary = {
    ...fromHistory,
    gross_profit: r2((fromHistory.revenue ?? 0) - (fromHistory.cogs ?? 0)),
    avg_basket_units: fromHistory.transactions ? r2(fromHistory.units / fromHistory.transactions) : 0,
    atv: fromHistory.transactions ? r2(fromHistory.revenue / fromHistory.transactions) : 0,
    opening_cash: books.opening_cash,
    closing_inventory_value: books.closing_inventory_value,
  };
  const booksCheck = {
    revenue: Math.abs(books.revenue - (fromHistory.revenue ?? 0)) < 0.005,
    transactions: books.transactions === fromHistory.transactions,
    customers: books.customers === fromHistory.customers,
    cash: Math.abs(books.closing_cash - fromHistory.closing_cash) < 0.005,
    cogs: Math.abs(books.cogs - (fromHistory.cogs ?? 0)) < 0.005,
  };

  const hourly = all(`SELECT c.arrival_min/60 hour, COUNT(*) customers, COUNT(t.txn_id) transactions, ROUND(COALESCE(SUM(t.total),0),2) revenue
    FROM customers c LEFT JOIN transactions t ON t.run_id=c.run_id AND t.customer_id=c.customer_id
    WHERE c.run_id=@r AND c.day=@d GROUP BY hour ORDER BY hour`, p);
  const missions = all(`SELECT c.mission, COUNT(*) customers, ROUND(AVG(t.units),2) avg_units, ROUND(AVG(t.total),2) avg_value, ROUND(SUM(t.total),2) revenue
    FROM customers c LEFT JOIN transactions t ON t.run_id=c.run_id AND t.customer_id=c.customer_id
    WHERE c.run_id=@r AND c.day=@d GROUP BY c.mission ORDER BY customers DESC`, p);
  const categories = all(`SELECT rp.category, SUM(l.qty) units, ROUND(SUM(l.line_total),2) revenue, ROUND(SUM(l.qty*(l.unit_price-l.unit_cost)),2) gross_profit
    FROM transaction_lines l JOIN transactions t USING(run_id,txn_id) JOIN run_products rp ON rp.run_id=l.run_id AND rp.product_id=l.product_id
    WHERE t.run_id=@r AND t.day=@d GROUP BY rp.category ORDER BY revenue DESC`, p);
  const stock = all(`SELECT d.product_id, rp.name, rp.category, rp.perishable, d.opening_qty, d.received_qty, d.expired_qty, d.sold_qty, d.closing_qty,
      d.closing_value, d.sold_out_min, d.lost_units, d.forecast_next,
      (SELECT SUM(qty) FROM replenishment_orders o WHERE o.run_id=d.run_id AND o.product_id=d.product_id AND o.day_placed=d.day) ordered_qty
    FROM daily_stock d JOIN run_products rp ON rp.run_id=d.run_id AND rp.product_id=d.product_id
    WHERE d.run_id=@r AND d.day=@d ORDER BY d.product_id`, p);
  const events = all(`SELECT b.*, rp.name FROM brain_events b LEFT JOIN run_products rp ON rp.run_id=b.run_id AND rp.product_id=b.product_id
    WHERE b.run_id=@r AND b.day=@d ORDER BY b.time_min, b.event_id`, p);
  const orders = all(`SELECT o.*, rp.name FROM replenishment_orders o JOIN run_products rp ON rp.run_id=o.run_id AND rp.product_id=o.product_id
    WHERE o.run_id=@r AND o.day_placed=@d ORDER BY o.order_id`, p);
  const cash = all(`SELECT type, COUNT(*) entries, ROUND(SUM(amount),2) amount FROM cash_ledger WHERE run_id=@r AND day=@d GROUP BY type`, p);
  const topProducts = all(`SELECT l.product_id, rp.name, SUM(l.qty) units, ROUND(SUM(l.line_total),2) revenue FROM transaction_lines l JOIN transactions t USING(run_id,txn_id)
    JOIN run_products rp ON rp.run_id=l.run_id AND rp.product_id=l.product_id WHERE t.run_id=@r AND t.day=@d GROUP BY l.product_id ORDER BY revenue DESC LIMIT 8`, p);
  return { day, meta, summary, books, booksCheck, hourly, missions, categories, stock, events, orders, cash, topProducts };
}

export function dayTransactions(db, runId, day, { page = 1, pageSize = 50, productId = null } = {}) {
  const { all, get } = makeQ(db, runId);
  const filter = productId ? `AND EXISTS (SELECT 1 FROM transaction_lines l WHERE l.run_id=t.run_id AND l.txn_id=t.txn_id AND l.product_id=@pid)` : '';
  const total = get(`SELECT COUNT(*) n FROM transactions t WHERE run_id=@r AND day=@d ${filter}`, { d: day, pid: productId }).n;
  const rows = all(`SELECT t.*, c.mission FROM transactions t JOIN customers c ON c.run_id=t.run_id AND c.customer_id=t.customer_id
    WHERE t.run_id=@r AND t.day=@d ${filter} ORDER BY t.txn_id LIMIT @lim OFFSET @off`, { d: day, pid: productId, lim: pageSize, off: (page - 1) * pageSize });
  return { total, page, pageSize, rows };
}

export function transactionDetail(db, runId, txnId) {
  const { all, get } = makeQ(db, runId);
  const txn = get(`SELECT t.*, c.mission, c.arrival_min, c.intended_lines FROM transactions t JOIN customers c ON c.run_id=t.run_id AND c.customer_id=t.customer_id
    WHERE t.run_id=@r AND t.txn_id=@t`, { t: txnId });
  if (!txn) return null;
  const lines = all(`SELECT l.*, rp.name FROM transaction_lines l JOIN run_products rp ON rp.run_id=l.run_id AND rp.product_id=l.product_id
    WHERE l.run_id=@r AND l.txn_id=@t ORDER BY line_no`, { t: txnId });
  const movements = all(`SELECT m.*, b.received_day, b.expiry_day, b.source FROM inventory_movements m JOIN batches b ON b.run_id=m.run_id AND b.batch_id=m.batch_id
    WHERE m.run_id=@r AND m.ref_type='TXN' AND m.ref_id=@t ORDER BY movement_id`, { t: txnId });
  const cash = get(`SELECT * FROM cash_ledger WHERE run_id=@r AND type='SALE' AND ref_id=@t`, { t: txnId });
  const lost = all(`SELECT ls.*, rp.name FROM lost_sales ls JOIN run_products rp ON rp.run_id=ls.run_id AND rp.product_id=ls.product_id
    WHERE ls.run_id=@r AND ls.customer_id=@c`, { c: txn.customer_id });
  return { txn, lines, movements, cash, lost };
}

// Product trace: every day's stock movement, orders, events and batches for one product.
export function productTrace(db, runId, productId) {
  const { all, get } = makeQ(db, runId);
  const p = { p: productId };
  const product = get(`SELECT * FROM run_products WHERE run_id=@r AND product_id=@p`, p);
  if (!product) return null;
  const days = all(`SELECT d.*, (SELECT ROUND(SUM(l.line_total),2) FROM transaction_lines l JOIN transactions t USING(run_id,txn_id) WHERE t.run_id=d.run_id AND t.day=d.day AND l.product_id=d.product_id) revenue,
      (SELECT SUM(qty) FROM replenishment_orders o WHERE o.run_id=d.run_id AND o.product_id=d.product_id AND o.day_placed=d.day) ordered_qty
    FROM daily_stock d WHERE d.run_id=@r AND d.product_id=@p ORDER BY d.day`, p);
  const orders = all(`SELECT * FROM replenishment_orders WHERE run_id=@r AND product_id=@p ORDER BY order_id`, p);
  const events = all(`SELECT * FROM brain_events WHERE run_id=@r AND product_id=@p ORDER BY day, time_min, event_id`, p);
  const batches = all(`SELECT b.*, COALESCE(-SUM(CASE WHEN m.type='SALE' THEN m.qty END),0) sold, COALESCE(-SUM(CASE WHEN m.type='EXPIRY' THEN m.qty END),0) expired,
      SUM(m.qty) remaining FROM batches b LEFT JOIN inventory_movements m ON m.run_id=b.run_id AND m.batch_id=b.batch_id
    WHERE b.run_id=@r AND b.product_id=@p GROUP BY b.batch_id ORDER BY b.batch_id`, p);
  const totals = get(`SELECT (SELECT SUM(qty) FROM transaction_lines WHERE run_id=@r AND product_id=@p) units,
      (SELECT ROUND(SUM(line_total),2) FROM transaction_lines WHERE run_id=@r AND product_id=@p) revenue,
      (SELECT SUM(qty) FROM lost_sales WHERE run_id=@r AND product_id=@p) lost,
      (SELECT COUNT(*) FROM transaction_lines WHERE run_id=@r AND substituted_for=@p) substituted_away`, p);
  return { product, totals, days, orders, events, batches };
}

export function brainLog(db, runId, { type = null, productId = null, day = null, page = 1, pageSize = 100 } = {}) {
  const { all, get } = makeQ(db, runId);
  const where = ['b.run_id=@r'];
  if (type) where.push('b.event_type=@type');
  if (productId) where.push('b.product_id=@pid');
  if (day) where.push('b.day=@day');
  const w = where.join(' AND ');
  const params = { type, pid: productId, day, lim: pageSize, off: (page - 1) * pageSize };
  const total = get(`SELECT COUNT(*) n FROM brain_events b WHERE ${w}`, params).n;
  const rows = all(`SELECT b.*, rp.name FROM brain_events b LEFT JOIN run_products rp ON rp.run_id=b.run_id AND rp.product_id=b.product_id
    WHERE ${w} ORDER BY b.day, b.time_min, b.event_id LIMIT @lim OFFSET @off`, params);
  return { total, page, pageSize, rows };
}
