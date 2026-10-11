// All report figures are computed on request from the run's stored history tables
// (transactions, transaction_lines, inventory_movements, cash_ledger, replenishment_orders, brain_events).
// Nothing in a report is typed in by hand.

const r2 = (x) => Math.round((x ?? 0) * 100) / 100;

export function makeQ(db, runId) {
  const timed = (kind) => (sql, p = {}) => {
    const t = Date.now();
    const out = db.prepare(sql)[kind]({ r: runId, ...p });
    if (process.env.SQL_TIMING && Date.now() - t > 50) console.log(`${Date.now() - t}ms`, sql.replace(/\s+/g, ' ').slice(0, 110));
    return out;
  };
  const all = timed('all');
  const get = timed('get');
  return { all, get };
}

export function runMeta(db, runId) {
  const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId);
  if (!run) return null;
  const submitted = db.prepare('SELECT run_id FROM submitted_run WHERE id = 1').get();
  return { ...run, config: JSON.parse(run.config_json), config_json: undefined, is_submitted: submitted?.run_id === runId };
}

// ---------------- Part 1: Business performance ----------------
export function performance(db, runId) {
  const { all, get } = makeQ(db, runId);
  const t = get(`
    SELECT
      (SELECT COUNT(*) FROM customers WHERE run_id=@r) AS customers,
      (SELECT COUNT(*) FROM customers WHERE run_id=@r AND outcome='NO_PURCHASE_STOCKOUT') AS walkouts,
      (SELECT COUNT(*) FROM transactions WHERE run_id=@r) AS transactions,
      (SELECT SUM(qty) FROM transaction_lines WHERE run_id=@r) AS units,
      (SELECT COUNT(*) FROM transaction_lines WHERE run_id=@r) AS lines,
      (SELECT SUM(total) FROM transactions WHERE run_id=@r) AS revenue,
      (SELECT SUM(qty*unit_cost) FROM transaction_lines WHERE run_id=@r) AS cogs,
      (SELECT -SUM(qty*unit_cost) FROM inventory_movements WHERE run_id=@r AND type='EXPIRY') AS writeoff_value,
      (SELECT -SUM(qty) FROM inventory_movements WHERE run_id=@r AND type='EXPIRY') AS writeoff_units,
      (SELECT balance_after FROM cash_ledger WHERE run_id=@r ORDER BY entry_id DESC LIMIT 1) AS closing_cash,
      (SELECT SUM(qty*unit_cost) FROM inventory_movements WHERE run_id=@r) AS closing_inventory_value,
      (SELECT SUM(qty) FROM inventory_movements WHERE run_id=@r) AS closing_inventory_units,
      (SELECT -SUM(amount) FROM cash_ledger WHERE run_id=@r AND type='REPLENISHMENT') AS replenishment_spend,
      (SELECT SUM(qty) FROM lost_sales WHERE run_id=@r) AS lost_units,
      (SELECT SUM(qty*unit_price) FROM lost_sales WHERE run_id=@r) AS lost_value,
      (SELECT COUNT(*) FROM transaction_lines WHERE run_id=@r AND substituted_for IS NOT NULL) AS substitutions,
      (SELECT COUNT(*) FROM sim_days WHERE run_id=@r) AS days`);
  const run = runMeta(db, runId);
  const totals = {
    ...t,
    revenue: r2(t.revenue), cogs: r2(t.cogs), gross_profit: r2(t.revenue - t.cogs),
    gross_margin_pct: r2(((t.revenue - t.cogs) / t.revenue) * 100),
    writeoff_value: r2(t.writeoff_value), closing_cash: r2(t.closing_cash), closing_inventory_value: r2(t.closing_inventory_value),
    replenishment_spend: r2(t.replenishment_spend), lost_value: r2(t.lost_value),
    opening_cash: run.opening_cash, opening_inventory_cost: run.opening_inventory_cost,
    gp_after_writeoff: r2(t.revenue - t.cogs - t.writeoff_value),
  };

  const daily = all(`
    SELECT d.day, d.weekday, d.is_weekend, d.ramp_factor, COALESCE(c.n,0) AS customers,
      COALESCE(t.n,0) AS transactions, COALESCE(t.units,0) AS units, ROUND(COALESCE(t.revenue,0),2) AS revenue,
      ROUND(COALESCE(g.gp,0),2) AS gross_profit
    FROM sim_days d
    LEFT JOIN (SELECT day, COUNT(*) n FROM customers WHERE run_id=@r GROUP BY day) c ON c.day=d.day
    LEFT JOIN (SELECT day, COUNT(*) n, SUM(units) units, SUM(total) revenue FROM transactions WHERE run_id=@r GROUP BY day) t ON t.day=d.day
    LEFT JOIN (SELECT tt.day, SUM(l.qty*(l.unit_price-l.unit_cost)) gp FROM transactions tt JOIN transaction_lines l ON l.run_id=tt.run_id AND l.txn_id=tt.txn_id
               WHERE tt.run_id=@r GROUP BY tt.day) g ON g.day=d.day
    WHERE d.run_id=@r ORDER BY d.day`);

  const dayType = all(`
    SELECT CASE WHEN d.is_weekend=1 THEN 'Weekend' ELSE 'Weekday' END AS day_type, COUNT(*) AS days,
      ROUND(AVG(x.customers),1) AS avg_customers, ROUND(AVG(x.revenue),2) AS avg_revenue,
      ROUND(SUM(x.units)*1.0/SUM(x.txns),2) AS avg_basket_units, ROUND(SUM(x.revenue)/SUM(x.txns),2) AS avg_transaction_value
    FROM sim_days d JOIN (
      SELECT day, (SELECT COUNT(*) FROM customers c WHERE c.run_id=@r AND c.day=t.day) AS customers,
        COUNT(*) AS txns, SUM(units) AS units, SUM(total) AS revenue
      FROM transactions t WHERE run_id=@r GROUP BY day) x ON x.day=d.day
    WHERE d.run_id=@r GROUP BY 1 ORDER BY 1`);
  const dayTypeSteady = all(`
    SELECT CASE WHEN d.is_weekend=1 THEN 'Weekend' ELSE 'Weekday' END AS day_type,
      ROUND(AVG((SELECT COUNT(*) FROM customers c WHERE c.run_id=d.run_id AND c.day=d.day)),1) AS avg_customers
    FROM sim_days d WHERE d.run_id=@r AND d.day > 14 GROUP BY 1 ORDER BY 1`);

  const missions = all(`
    SELECT c.mission, COUNT(*) AS customers,
      SUM(CASE WHEN d.is_weekend=0 THEN 1 ELSE 0 END) AS weekday_customers,
      SUM(CASE WHEN d.is_weekend=1 THEN 1 ELSE 0 END) AS weekend_customers,
      ROUND(AVG(t.units),2) AS avg_units, ROUND(AVG(t.total),2) AS avg_value, ROUND(SUM(t.total),2) AS revenue
    FROM customers c JOIN sim_days d ON d.run_id=c.run_id AND d.day=c.day
    LEFT JOIN transactions t ON t.run_id=c.run_id AND t.customer_id=c.customer_id
    WHERE c.run_id=@r GROUP BY c.mission ORDER BY revenue DESC`);

  const hourly = all(`
    SELECT c.arrival_min/60 AS hour,
      ROUND(SUM(CASE WHEN d.is_weekend=0 THEN 1 ELSE 0 END)*1.0/(SELECT COUNT(*) FROM sim_days WHERE run_id=@r AND is_weekend=0),1) AS weekday_avg,
      ROUND(SUM(CASE WHEN d.is_weekend=1 THEN 1 ELSE 0 END)*1.0/(SELECT COUNT(*) FROM sim_days WHERE run_id=@r AND is_weekend=1),1) AS weekend_avg
    FROM customers c JOIN sim_days d ON d.run_id=c.run_id AND d.day=c.day
    WHERE c.run_id=@r GROUP BY hour ORDER BY hour`);

  const categories = all(`
    SELECT p.category, p.category_code, COUNT(DISTINCT p.product_id) AS products,
      COALESCE(s.units,0) AS units, ROUND(COALESCE(s.revenue,0),2) AS revenue, ROUND(COALESCE(s.cogs,0),2) AS cogs,
      ROUND(COALESCE(s.revenue,0)-COALESCE(s.cogs,0),2) AS gross_profit,
      ROUND(COALESCE(w.wo,0),2) AS writeoff_value, COALESCE(w.wu,0) AS writeoff_units
    FROM run_products p
    LEFT JOIN (SELECT pp.category_code cc, SUM(l.qty) units, SUM(l.line_total) revenue, SUM(l.qty*l.unit_cost) cogs
               FROM transaction_lines l JOIN run_products pp ON pp.run_id=l.run_id AND pp.product_id=l.product_id
               WHERE l.run_id=@r GROUP BY pp.category_code) s ON s.cc=p.category_code
    LEFT JOIN (SELECT pp.category_code cc, -SUM(m.qty*m.unit_cost) wo, -SUM(m.qty) wu FROM inventory_movements m
               JOIN run_products pp ON pp.run_id=m.run_id AND pp.product_id=m.product_id
               WHERE m.run_id=@r AND m.type='EXPIRY' GROUP BY pp.category_code) w ON w.cc=p.category_code
    WHERE p.run_id=@r GROUP BY p.category_code ORDER BY revenue DESC`);
  for (const c of categories) {
    c.gross_margin_pct = c.revenue ? r2((c.gross_profit / c.revenue) * 100) : 0;
    c.revenue_share_pct = r2((c.revenue / totals.revenue) * 100);
    c.gp_after_writeoff = r2(c.gross_profit - c.writeoff_value);
  }

  const products = productTable(db, runId);
  const byRevenue = [...products].sort((a, b) => b.revenue - a.revenue);
  const weak = [...products].sort((a, b) => a.units_last14_per_day * a.unit_price - b.units_last14_per_day * b.unit_price).slice(0, 10);

  const ramp = get(`SELECT
      ROUND(AVG(CASE WHEN day<=14 THEN n END),1) AS first14, ROUND(AVG(CASE WHEN day>14 THEN n END),1) AS after14
    FROM (SELECT day, COUNT(*) n FROM customers WHERE run_id=@r GROUP BY day)`);

  return {
    totals: {
      ...totals,
      avg_customers_per_day: r2(t.customers / t.days),
      avg_basket_units: r2(t.units / t.transactions),
      avg_basket_lines: r2(t.lines / t.transactions),
      avg_transaction_value: r2(t.revenue / t.transactions),
    },
    daily, dayType, dayTypeSteady, missions, hourly, categories, ramp,
    topProducts: byRevenue.slice(0, 10),
    weakProducts: weak,
    products,
  };
}

export function productTable(db, runId) {
  const { all } = makeQ(db, runId);
  const rows = all(`
    SELECT p.product_id, p.name, p.category, p.category_code, p.unit_cost, p.unit_price, p.perishable, p.shelf_life_days,
      p.case_size, p.initial_qty, p.plan_daily_units,
      COALESCE(s.units,0) AS units, ROUND(COALESCE(s.revenue,0),2) AS revenue, ROUND(COALESCE(s.gp,0),2) AS gross_profit,
      COALESCE(ds.expired,0) AS expired_units, ROUND(COALESCE(ds.expired,0)*p.unit_cost,2) AS writeoff_value,
      COALESCE(ls.lost,0) AS lost_units, ROUND(COALESCE(ls.lost,0)*p.unit_price,2) AS lost_value,
      COALESCE(ds.sold_out_days,0) AS sold_out_days,
      COALESCE(ds.l14,0) AS units_last14,
      COALESCE(o.ordered,0) AS ordered_units, ROUND(COALESCE(o.spend,0),2) AS replenishment_spend, COALESCE(o.n,0) AS orders,
      COALESCE(m.closing,0) AS closing_qty, ROUND(COALESCE(m.closing_value,0),2) AS closing_value,
      COALESCE(e.slow,0) AS slow_mover_flags
    FROM run_products p
    LEFT JOIN (SELECT product_id, SUM(qty) units, SUM(line_total) revenue, SUM(qty*(unit_price-unit_cost)) gp FROM transaction_lines WHERE run_id=@r GROUP BY product_id) s USING(product_id)
    LEFT JOIN (SELECT product_id, SUM(qty) lost FROM lost_sales WHERE run_id=@r GROUP BY product_id) ls USING(product_id)
    LEFT JOIN (SELECT product_id, SUM(expired_qty) expired, SUM(sold_out_min IS NOT NULL) sold_out_days,
                 SUM(CASE WHEN day > (SELECT horizon_days FROM runs WHERE run_id=@r) - 14 THEN sold_qty ELSE 0 END) l14
               FROM daily_stock WHERE run_id=@r GROUP BY product_id) ds USING(product_id)
    LEFT JOIN (SELECT product_id, SUM(qty) ordered, SUM(total_cost) spend, COUNT(*) n FROM replenishment_orders WHERE run_id=@r GROUP BY product_id) o USING(product_id)
    LEFT JOIN (SELECT product_id, SUM(qty) closing, SUM(qty*unit_cost) closing_value FROM inventory_movements WHERE run_id=@r GROUP BY product_id) m USING(product_id)
    LEFT JOIN (SELECT product_id, COUNT(*) slow FROM brain_events WHERE run_id=@r AND event_type='SLOW_MOVER' GROUP BY product_id) e USING(product_id)
    WHERE p.run_id=@r ORDER BY p.product_id`);
  for (const p of rows) {
    p.units_last14_per_day = r2(p.units_last14 / 14);
    p.closing_cover_days = p.units_last14_per_day > 0 ? r2(p.closing_qty / p.units_last14_per_day) : null;
    p.gross_margin_pct = p.revenue ? r2((p.gross_profit / p.revenue) * 100) : 0;
    p.waste_rate_pct = p.units + p.expired_units ? r2((p.expired_units / (p.units + p.expired_units)) * 100) : 0;
  }
  return rows;
}

// ---------------- Part 2: Inventory health & Store Brain operations ----------------
export function operations(db, runId) {
  const { all, get } = makeQ(db, runId);
  const products = productTable(db, runId);
  const eventCounts = all(`SELECT event_type, severity, COUNT(*) AS n, COUNT(DISTINCT product_id) AS products, COUNT(DISTINCT day) AS days FROM brain_events WHERE run_id=@r GROUP BY event_type ORDER BY n DESC`);
  const REQUIRED = ['SOLD_OUT', 'SOLD_OUT_RESPONSE', 'LOW_STOCK', 'EXPIRY_WRITE_OFF', 'EXPIRY_WARNING', 'SLOW_MOVER', 'WASTE_ADJUST', 'CASH_CONSTRAINED', 'CASH_REVIEW', 'END_OF_HORIZON'];
  const counts = Object.fromEntries(REQUIRED.map((k) => [k, { event_type: k, n: 0, products: 0, days: 0 }]));
  for (const e of eventCounts) counts[e.event_type] = e;

  const orders = get(`SELECT COUNT(*) n, SUM(qty) units, ROUND(SUM(total_cost),2) spend, SUM(cash_constrained) constrained,
      ROUND(MIN(cash_before),2) min_cash_before, COUNT(DISTINCT day_placed) days
    FROM replenishment_orders WHERE run_id=@r`);
  const ordersByReason = all(`SELECT reason, COUNT(*) n, SUM(qty) units, ROUND(SUM(total_cost),2) spend FROM replenishment_orders WHERE run_id=@r GROUP BY reason ORDER BY spend DESC`);
  const ordersByCategory = all(`SELECT p.category, COUNT(*) n, SUM(o.qty) units, ROUND(SUM(o.total_cost),2) spend
    FROM replenishment_orders o JOIN run_products p ON p.run_id=o.run_id AND p.product_id=o.product_id
    WHERE o.run_id=@r GROUP BY p.category ORDER BY spend DESC`);
  const cashDaily = all(`SELECT c.day, c.opening_cash, c.closing_cash, c.revenue, c.replenishment_spend,
      (SELECT json_extract(metrics_json,'$.requested') FROM brain_events b WHERE b.run_id=c.run_id AND b.day=c.day AND b.event_type IN ('CASH_REVIEW','END_OF_HORIZON')) AS requested
    FROM day_close c WHERE c.run_id=@r ORDER BY c.day`);
  const cashHeadroom = get(`SELECT MIN(json_extract(metrics_json,'$.cash') - json_extract(metrics_json,'$.reserve') - json_extract(metrics_json,'$.requested')) AS min_headroom,
      (SELECT day FROM brain_events WHERE run_id=@r AND event_type='CASH_REVIEW' ORDER BY json_extract(metrics_json,'$.cash') - json_extract(metrics_json,'$.requested') LIMIT 1) AS min_day
    FROM brain_events WHERE run_id=@r AND event_type='CASH_REVIEW'`);

  const stockouts = products.filter((p) => p.sold_out_days > 0 || p.lost_units > 0).sort((a, b) => b.lost_value - a.lost_value);
  const writeoffs = products.filter((p) => p.expired_units > 0).sort((a, b) => b.writeoff_value - a.writeoff_value);
  const writeoffByCategory = all(`SELECT p.category, -SUM(m.qty) units, ROUND(-SUM(m.qty*m.unit_cost),2) value
    FROM inventory_movements m JOIN run_products p ON p.run_id=m.run_id AND p.product_id=m.product_id
    WHERE m.run_id=@r AND m.type='EXPIRY' GROUP BY p.category ORDER BY value DESC`);
  const slowMovers = all(`SELECT b.product_id, p.name, p.category, COUNT(*) flags, MIN(b.day) first_day, MAX(b.day) last_day,
      (SELECT metrics_json FROM brain_events x WHERE x.run_id=b.run_id AND x.product_id=b.product_id AND x.event_type='SLOW_MOVER' ORDER BY day LIMIT 1) first_metrics
    FROM brain_events b JOIN run_products p ON p.run_id=b.run_id AND p.product_id=b.product_id
    WHERE b.run_id=@r AND b.event_type='SLOW_MOVER' GROUP BY b.product_id ORDER BY flags DESC, first_day`);
  const byPid = Object.fromEntries(products.map((p) => [p.product_id, p]));
  for (const s of slowMovers) {
    const m = JSON.parse(s.first_metrics);
    Object.assign(s, { first_on_hand: m.onHand, first_cover_days: m.coverDays, first_value: m.stockValue, closing_qty: byPid[s.product_id].closing_qty, closing_value: byPid[s.product_id].closing_value, closing_cover_days: byPid[s.product_id].closing_cover_days, initial_qty: byPid[s.product_id].initial_qty, units: byPid[s.product_id].units });
    delete s.first_metrics;
  }
  const lowStockByCategory = all(`SELECT p.category, COUNT(*) n FROM brain_events b JOIN run_products p ON p.run_id=b.run_id AND p.product_id=b.product_id
    WHERE b.run_id=@r AND b.event_type='LOW_STOCK' GROUP BY p.category ORDER BY n DESC`);
  const wasteAdjust = all(`SELECT b.day, b.product_id, p.name, b.severity, b.condition, b.action FROM brain_events b JOIN run_products p ON p.run_id=b.run_id AND p.product_id=b.product_id
    WHERE b.run_id=@r AND b.event_type='WASTE_ADJUST' ORDER BY b.day`);
  const closingInventory = all(`SELECT p.category, SUM(p.initial_qty) opening_units, ROUND(SUM(p.initial_qty*p.unit_cost),2) opening_value,
      COALESCE(SUM(m.closing),0) closing_units, ROUND(COALESCE(SUM(m.closing_value),0),2) closing_value
    FROM run_products p LEFT JOIN (SELECT product_id, SUM(qty) closing, SUM(qty*unit_cost) closing_value FROM inventory_movements WHERE run_id=@r GROUP BY product_id) m USING(product_id)
    WHERE p.run_id=@r GROUP BY p.category ORDER BY closing_value DESC`);
  const dailyOps = all(`SELECT day,
      SUM(event_type='SOLD_OUT') sold_out, SUM(event_type='LOW_STOCK') low_stock, SUM(event_type='EXPIRY_WRITE_OFF') expiry,
      SUM(event_type='SLOW_MOVER') slow FROM brain_events WHERE run_id=@r GROUP BY day ORDER BY day`);
  const spendByDay = all(`SELECT day_placed AS day, ROUND(SUM(total_cost),2) spend, SUM(qty) units FROM replenishment_orders WHERE run_id=@r GROUP BY day_placed ORDER BY day_placed`);
  const endState = all(`SELECT b.product_id, p.name, b.event_type, b.condition, b.action FROM brain_events b JOIN run_products p ON p.run_id=b.run_id AND p.product_id=b.product_id
    WHERE b.run_id=@r AND b.day=(SELECT horizon_days FROM runs WHERE run_id=@r) AND b.phase='CLOSE' AND b.product_id IS NOT NULL ORDER BY b.event_type, b.product_id`);

  // Material cases: detected condition -> action -> recorded outcome
  const material = [];
  for (const p of stockouts.slice(0, 4)) {
    const resp = get(`SELECT COUNT(*) n, MIN(day) first FROM brain_events WHERE run_id=@r AND product_id=@p AND event_type='SOLD_OUT_RESPONSE'`, { p: p.product_id });
    const halves = get(`SELECT SUM(CASE WHEN day<=30 AND sold_out_min IS NOT NULL THEN 1 ELSE 0 END) h1, SUM(CASE WHEN day>30 AND sold_out_min IS NOT NULL THEN 1 ELSE 0 END) h2,
        SUM(CASE WHEN day<=30 THEN lost_units ELSE 0 END) l1, SUM(CASE WHEN day>30 THEN lost_units ELSE 0 END) l2 FROM daily_stock WHERE run_id=@r AND product_id=@p`, { p: p.product_id });
    material.push({ kind: 'Stockout', product_id: p.product_id, name: p.name, first_day: resp.first,
      condition: `Sold out on ${p.sold_out_days} days; ${p.lost_units} units of demand lost ($${p.lost_value.toFixed(2)} at retail)`,
      action: `${resp.n} priority sold-out responses (replenishment ordered at close for next-morning delivery)`,
      outcome: `Sold-out days: ${halves.h1} in Days 1-30 vs ${halves.h2} in Days 31-60; lost units ${halves.l1} vs ${halves.l2}` });
  }
  for (const p of writeoffs.slice(0, 3)) {
    const adj = get(`SELECT COUNT(*) n FROM brain_events WHERE run_id=@r AND product_id=@p AND event_type='WASTE_ADJUST'`, { p: p.product_id });
    const halves = get(`SELECT SUM(CASE WHEN day<=30 THEN expired_qty ELSE 0 END) e1, SUM(CASE WHEN day>30 THEN expired_qty ELSE 0 END) e2,
        SUM(CASE WHEN day<=30 THEN sold_qty ELSE 0 END) s1, SUM(CASE WHEN day>30 THEN sold_qty ELSE 0 END) s2 FROM daily_stock WHERE run_id=@r AND product_id=@p`, { p: p.product_id });
    material.push({ kind: 'Expiry write-off', product_id: p.product_id, name: p.name,
      condition: `${p.expired_units} units expired (${p.waste_rate_pct}% of units sold+expired), $${p.writeoff_value.toFixed(2)} at cost`,
      action: `Expired units removed before opening each day; ${adj.n} waste-aware order-target adjustments`,
      outcome: `Write-off ${halves.e1} units (Days 1-30) vs ${halves.e2} (Days 31-60) while sales were ${halves.s1} vs ${halves.s2}` });
  }
  for (const s of slowMovers.slice(0, 3)) {
    material.push({ kind: 'Slow mover', product_id: s.product_id, name: s.name, first_day: s.first_day,
      condition: `First flagged Day ${s.first_day}: ${s.first_on_hand} units on hand = ${s.first_cover_days} days of cover ($${(s.first_value ?? 0).toFixed(2)} at cost)`,
      action: `Replenishment held; flagged ${s.flags} times for markdown / range review`,
      outcome: `Closing stock ${s.closing_qty} units ($${s.closing_value.toFixed(2)}); ${s.units} sold in 60 days from an opening quantity of ${s.initial_qty}` });
  }

  return {
    counts: Object.values(counts), orders, ordersByReason, ordersByCategory, cashDaily, cashHeadroom,
    stockouts, writeoffs, writeoffByCategory, slowMovers, lowStockByCategory, wasteAdjust, closingInventory,
    dailyOps, spendByDay, endState, material,
  };
}
