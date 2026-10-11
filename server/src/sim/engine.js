import { CATALOGUE } from '../model/catalogue.js';
import { DEFAULT_CONFIG } from '../model/config.js';
import { makeRng } from './rng.js';
import { closeReview, hhmm, isWeekendDay, weekdayOf } from './brain.js';

const cents = (x) => Math.round(x * 100);
const dollars = (c) => c / 100;

// Fixed times within the daily operating cycle (minutes after midnight)
const T_DELIVERY = 360; // 06:00 replenishment ordered yesterday arrives
const T_EXPIRY = 390; // 06:30 expired stock removed from sale
const T_WARN = 405; // 06:45 near-expiry review
const T_CLOSE = 1325; // 22:05 Store Brain close review & ordering

export function buildOpeningInventory(catalogue, cfg) {
  const oi = cfg.openingInventory;
  return catalogue.map((p) => {
    const cover = p.perishable ? Math.min(p.shelf_life_days, oi.perishableCoverDays) : oi.nonPerishableCoverDays;
    const cases = Math.max(oi.minCases, Math.ceil((p.plan_daily_units * cover) / p.case_size));
    return { ...p, initial_qty: cases * p.case_size };
  });
}

export function nextRunId(db) {
  const row = db.prepare('SELECT run_id FROM runs ORDER BY run_id DESC LIMIT 1').get();
  const n = row ? parseInt(row.run_id.slice(4), 10) + 1 : 1;
  return `RUN-${String(n).padStart(4, '0')}`;
}

function prepare(db) {
  const ins = (table, cols) =>
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`);
  return {
    run: ins('runs', ['run_id', 'label', 'status', 'seed', 'horizon_days', 'opening_cash', 'inventory_budget', 'opening_inventory_cost', 'model_version', 'config_json', 'created_at']),
    product: ins('run_products', ['run_id', 'product_id', 'name', 'category', 'category_code', 'unit_cost', 'unit_price', 'initial_qty', 'perishable', 'shelf_life_days', 'case_size', 'popularity', 'plan_daily_units']),
    day: ins('sim_days', ['run_id', 'day', 'weekday', 'is_weekend', 'ramp_factor', 'expected_customers']),
    customer: ins('customers', ['run_id', 'customer_id', 'day', 'arrival_min', 'mission', 'intended_lines', 'outcome']),
    txn: ins('transactions', ['run_id', 'txn_id', 'day', 'time_min', 'customer_id', 'line_count', 'units', 'total']),
    line: ins('transaction_lines', ['run_id', 'txn_id', 'line_no', 'product_id', 'qty', 'unit_price', 'unit_cost', 'line_total', 'substituted_for']),
    batch: ins('batches', ['run_id', 'batch_id', 'product_id', 'source', 'order_id', 'received_day', 'expiry_day', 'qty_received', 'unit_cost']),
    move: ins('inventory_movements', ['run_id', 'movement_id', 'day', 'time_min', 'product_id', 'batch_id', 'type', 'qty', 'unit_cost', 'ref_type', 'ref_id']),
    lost: ins('lost_sales', ['run_id', 'lost_id', 'day', 'time_min', 'customer_id', 'product_id', 'qty', 'unit_price', 'reason']),
    order: ins('replenishment_orders', ['run_id', 'order_id', 'day_placed', 'delivery_day', 'product_id', 'reason', 'requested_qty', 'qty', 'cases', 'unit_cost', 'total_cost', 'cash_before', 'cash_after', 'cash_constrained', 'forecast_daily', 'usable_stock', 'target_stock']),
    cash: ins('cash_ledger', ['run_id', 'entry_id', 'day', 'time_min', 'type', 'amount', 'balance_after', 'ref_id']),
    event: ins('brain_events', ['run_id', 'event_id', 'day', 'time_min', 'phase', 'product_id', 'event_type', 'severity', 'condition', 'action', 'metrics_json', 'order_id']),
    stock: ins('daily_stock', ['run_id', 'day', 'product_id', 'opening_qty', 'received_qty', 'expired_qty', 'sold_qty', 'closing_qty', 'closing_value', 'sold_out_min', 'lost_units', 'forecast_next']),
    close: ins('day_close', ['run_id', 'day', 'customers', 'transactions', 'units_sold', 'revenue', 'cogs', 'writeoff_value', 'replenishment_spend', 'opening_cash', 'closing_cash', 'closing_inventory_value']),
    complete: db.prepare("UPDATE runs SET status='COMPLETED', completed_at=@completed_at, runtime_ms=@runtime_ms WHERE run_id=@run_id"),
  };
}

export function runSimulation(db, { seed, label = null } = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  const runSeed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 2 ** 31);
  const products = buildOpeningInventory(CATALOGUE, cfg);
  const openingCostC = products.reduce((s, p) => s + p.initial_qty * cents(p.unit_cost), 0);
  if (openingCostC > cents(cfg.inventoryBudget)) {
    throw new Error(`Opening inventory ${dollars(openingCostC)} exceeds budget ${cfg.inventoryBudget}`);
  }
  const S = prepare(db);
  const runId = nextRunId(db);
  const t0 = Date.now();

  db.transaction(() => {
    S.run.run({
      run_id: runId, label, status: 'RUNNING', seed: runSeed, horizon_days: cfg.horizonDays,
      opening_cash: cfg.openingCash, inventory_budget: cfg.inventoryBudget, opening_inventory_cost: dollars(openingCostC),
      model_version: cfg.modelVersion, config_json: JSON.stringify(cfg), created_at: new Date().toISOString(),
    });
    for (const p of products) {
      S.product.run({
        run_id: runId, product_id: p.product_id, name: p.name, category: p.category, category_code: p.category_code,
        unit_cost: p.unit_cost, unit_price: p.unit_price, initial_qty: p.initial_qty, perishable: p.perishable ? 1 : 0,
        shelf_life_days: p.shelf_life_days, case_size: p.case_size, popularity: p.popularity, plan_daily_units: p.plan_daily_units,
      });
    }
    simulate(runId, cfg, products, makeRng(runSeed), S);
    S.complete.run({ run_id: runId, completed_at: new Date().toISOString(), runtime_ms: Date.now() - t0 });
  })();
  // Refresh SQLite's table statistics so report queries keep efficient plans as runs accumulate.
  db.exec('ANALYZE');
  db.save();
  return runId;
}

function simulate(runId, cfg, products, rng, S) {
  const H = cfg.horizonDays;
  const byId = Object.fromEntries(products.map((p) => [p.product_id, p]));
  const byCat = {};
  for (const p of products) (byCat[p.category_code] ||= []).push(p);
  const zeros = () => new Array(H + 2).fill(0);
  const hist = { sold: {}, soldOut: {}, expired: {}, received: {} };
  const stock = {};
  const brainState = { wasteFactor: {}, lastSlowFlag: {} };
  let lastForecast = {};
  for (const p of products) {
    const id = p.product_id;
    hist.sold[id] = zeros();
    hist.soldOut[id] = new Array(H + 2).fill(false);
    hist.expired[id] = zeros();
    hist.received[id] = zeros();
    stock[id] = [];
    brainState.wasteFactor[id] = 1;
    brainState.lastSlowFlag[id] = -999;
    lastForecast[id] = p.plan_daily_units;
  }
  const ids = { customer: 0, txn: 0, batch: 0, move: 0, lost: 0, order: 0, cash: 0, event: 0 };
  let cashC = cents(cfg.openingCash);
  let pending = []; // orders awaiting next-morning delivery

  const cashEntry = (day, time, type, amountC, refId = null) => {
    cashC += amountC;
    S.cash.run({ run_id: runId, entry_id: ++ids.cash, day, time_min: time, type, amount: dollars(amountC), balance_after: dollars(cashC), ref_id: refId });
  };
  const event = (day, time, phase, e) => {
    S.event.run({
      run_id: runId, event_id: ++ids.event, day, time_min: time, phase, product_id: e.product_id ?? null,
      event_type: e.event_type, severity: e.severity, condition: e.condition, action: e.action,
      metrics_json: e.metrics ? JSON.stringify(e.metrics) : null, order_id: e.order?.order_id ?? null,
    });
  };
  const addBatch = (day, p, qty, source, orderId) => {
    const b = { id: ++ids.batch, receivedDay: day, expiryDay: p.perishable ? day + p.shelf_life_days : null, remaining: qty, unitCost: p.unit_cost };
    S.batch.run({ run_id: runId, batch_id: b.id, product_id: p.product_id, source, order_id: orderId, received_day: day, expiry_day: b.expiryDay, qty_received: qty, unit_cost: p.unit_cost });
    S.move.run({ run_id: runId, movement_id: ++ids.move, day, time_min: T_DELIVERY, product_id: p.product_id, batch_id: b.id, type: source === 'OPENING' ? 'OPENING' : 'RECEIPT', qty, unit_cost: p.unit_cost, ref_type: orderId ? 'ORDER' : null, ref_id: orderId });
    stock[p.product_id].push(b);
    stock[p.product_id].sort((a, c) => (a.expiryDay ?? 1e9) - (c.expiryDay ?? 1e9) || a.receivedDay - c.receivedDay || a.id - c.id); // FEFO
    hist.received[p.product_id][day] += qty;
  };
  const available = (pid) => stock[pid].reduce((s, b) => s + b.remaining, 0);

  cashEntry(1, 0, 'OPENING', 0); // opening balance record (A$15,000 already in cashC)
  const missions = Object.entries(cfg.missions);

  for (let day = 1; day <= H; day++) {
    const weekday = weekdayOf(day);
    const weekend = isWeekendDay(day);
    const C = cfg.customers;
    const ramp = day <= C.rampDays ? C.rampStart + ((1 - C.rampStart) * (day - 1)) / (C.rampDays - 1) : 1;
    const expected = (weekend ? C.baseWeekend : C.baseWeekday) * C.dowFactor[weekday] * ramp;
    S.day.run({ run_id: runId, day, weekday, is_weekend: weekend ? 1 : 0, ramp_factor: Math.round(ramp * 1000) / 1000, expected_customers: Math.round(expected * 10) / 10 });

    const openingQty = Object.fromEntries(products.map((p) => [p.product_id, available(p.product_id)]));
    const openingCashC = cashC;
    const daySold = {};
    const dayLost = {};
    const soldOutMin = {};
    let writeoffC = 0;
    let revenueC = 0;
    let cogsC = 0;
    let unitsSold = 0;
    let txnCount = 0;

    // ---------- OPEN: receive stock ----------
    if (day === 1) {
      for (const p of products) addBatch(1, p, p.initial_qty, 'OPENING', null);
    } else {
      for (const o of pending) addBatch(day, byId[o.product_id], o.qty, 'REPLENISHMENT', o.order_id);
    }
    pending = [];

    // ---------- OPEN: remove expired stock ----------
    for (const p of products) {
      const pid = p.product_id;
      let units = 0;
      const recvDays = [];
      for (const b of stock[pid]) {
        if (b.expiryDay != null && b.expiryDay <= day && b.remaining > 0) {
          S.move.run({ run_id: runId, movement_id: ++ids.move, day, time_min: T_EXPIRY, product_id: pid, batch_id: b.id, type: 'EXPIRY', qty: -b.remaining, unit_cost: b.unitCost, ref_type: null, ref_id: null });
          units += b.remaining;
          recvDays.push(b.receivedDay);
          b.remaining = 0;
        }
      }
      stock[pid] = stock[pid].filter((b) => b.remaining > 0);
      if (units > 0) {
        hist.expired[pid][day] = units;
        const valC = units * cents(p.unit_cost);
        writeoffC += valC;
        event(day, T_EXPIRY, 'OPEN', {
          product_id: pid, event_type: 'EXPIRY_WRITE_OFF', severity: 'WARN',
          condition: `${units} units reached end of shelf life (${p.shelf_life_days}-day life; received Day ${[...new Set(recvDays)].join(', ')})`,
          action: `Removed from sale before opening and written off at cost $${dollars(valC).toFixed(2)}`,
          metrics: { units, value: dollars(valC), shelfLife: p.shelf_life_days },
        });
      }
    }

    // ---------- OPEN: near-expiry warning (last saleable day) ----------
    for (const p of products) {
      if (!p.perishable) continue;
      const pid = p.product_id;
      const atRisk = stock[pid].filter((b) => b.expiryDay === day + cfg.storeBrain.nearExpiryWarnDays).reduce((s, b) => s + b.remaining, 0);
      const fc = lastForecast[pid];
      if (atRisk > 0 && atRisk > 0.5 * fc && p.shelf_life_days > 1) {
        event(day, T_WARN, 'OPEN', {
          product_id: pid, event_type: 'EXPIRY_WARNING', severity: 'INFO',
          condition: `${atRisk} units on their last saleable day (expire before opening Day ${day + 1}); forecast ${fc.toFixed(1)}/day`,
          action: 'Flagged to remote manager; FEFO selling sells these units first; waste is fed back into ordering',
          metrics: { atRisk, forecast: Math.round(fc * 10) / 10 },
        });
      }
    }

    // ---------- TRADING: customers ----------
    const nCustomers = Math.max(0, Math.round(expected * Math.exp(C.dailyNoiseSigma * rng.normal())));
    const dt = weekend ? 'weekend' : 'weekday';
    const missionEntries = missions.map(([k, m]) => [k, m.mix[dt]]);
    const arrivals = [];
    for (let i = 0; i < nCustomers; i++) {
      const mission = rng.weighted(missionEntries);
      const m = cfg.missions[mission];
      const hour = Number(rng.weighted(Object.entries(m.hours).map(([h, w]) => [h, w])));
      arrivals.push({ mission, time: hour * 60 + rng.int(0, 59) });
    }
    arrivals.sort((a, b) => a.time - b.time);

    for (const a of arrivals) {
      const m = cfg.missions[a.mission];
      const customerId = ++ids.customer;
      const nLines = Math.min(m.lines.max, m.lines.min + rng.poisson(m.lines.mean - m.lines.min));
      const catEntries = Object.entries(m.categories);
      const chosen = new Set();
      const intents = [];
      for (let i = 0; i < nLines; i++) {
        let p = null;
        for (let tries = 0; tries < 4; tries++) {
          const cat = rng.weighted(catEntries);
          const cand = rng.weighted(byCat[cat].map((x) => [x, x.popularity]));
          if (!chosen.has(cand.product_id)) {
            p = cand;
            break;
          }
        }
        if (!p) continue;
        chosen.add(p.product_id);
        let qty = 1;
        if (p.multi_unit) qty = rng.int(...cfg.quantity.multiUnitRange);
        else {
          const tp = a.mission === 'STOCK_UP' ? cfg.quantity.twoUnitProb.STOCK_UP : cfg.quantity.twoUnitProb[p.category_code] ?? cfg.quantity.twoUnitProb.default;
          if (rng.next() < tp) qty = 2;
        }
        intents.push({ p, qty });
      }

      // fulfil the basket against available stock
      const basket = [];
      const inBasket = new Set();
      const recordLost = (p, qty, reason) => {
        S.lost.run({ run_id: runId, lost_id: ++ids.lost, day, time_min: a.time, customer_id: customerId, product_id: p.product_id, qty, unit_price: p.unit_price, reason });
        dayLost[p.product_id] = (dayLost[p.product_id] ?? 0) + qty;
      };
      for (const { p, qty } of intents) {
        const avail = available(p.product_id);
        if (avail >= qty) basket.push({ p, qty, sub: null });
        else if (avail > 0) {
          basket.push({ p, qty: avail, sub: null });
          recordLost(p, qty - avail, 'PARTIAL');
        } else {
          let sub = null;
          if (rng.next() < (cfg.substitution.acceptProb[p.category_code] ?? 0.3)) {
            const options = byCat[p.category_code].filter((x) => x.product_id !== p.product_id && !chosen.has(x.product_id) && !inBasket.has(x.product_id) && available(x.product_id) > 0);
            if (options.length) sub = rng.weighted(options.map((x) => [x, x.popularity]));
          }
          if (sub) basket.push({ p: sub, qty: Math.min(qty, available(sub.product_id)), sub: p.product_id });
          else recordLost(p, qty, 'SOLD_OUT');
        }
        inBasket.add(basket.at(-1)?.p.product_id);
      }

      if (basket.length === 0) {
        S.customer.run({ run_id: runId, customer_id: customerId, day, arrival_min: a.time, mission: a.mission, intended_lines: intents.length, outcome: 'NO_PURCHASE_STOCKOUT' });
        continue;
      }
      S.customer.run({ run_id: runId, customer_id: customerId, day, arrival_min: a.time, mission: a.mission, intended_lines: intents.length, outcome: 'PURCHASED' });
      const txnId = ++ids.txn;
      let totalC = 0;
      let units = 0;
      const lines = [];
      basket.forEach(({ p, qty, sub }, idx) => {
        const pid = p.product_id;
        // FEFO allocation across batches; one SALE movement per batch touched
        let need = qty;
        for (const b of stock[pid]) {
          if (need === 0) break;
          const take = Math.min(need, b.remaining);
          if (take === 0) continue;
          b.remaining -= take;
          need -= take;
          S.move.run({ run_id: runId, movement_id: ++ids.move, day, time_min: a.time, product_id: pid, batch_id: b.id, type: 'SALE', qty: -take, unit_cost: b.unitCost, ref_type: 'TXN', ref_id: txnId });
        }
        if (need !== 0) throw new Error(`Oversell guard tripped for ${pid} on day ${day}`);
        stock[pid] = stock[pid].filter((b) => b.remaining > 0);
        const lineC = qty * cents(p.unit_price);
        totalC += lineC;
        cogsC += qty * cents(p.unit_cost);
        units += qty;
        daySold[pid] = (daySold[pid] ?? 0) + qty;
        lines.push({ run_id: runId, txn_id: txnId, line_no: idx + 1, product_id: pid, qty, unit_price: p.unit_price, unit_cost: p.unit_cost, line_total: dollars(lineC), substituted_for: sub });
        if (available(pid) === 0 && soldOutMin[pid] == null) {
          soldOutMin[pid] = a.time;
          hist.soldOut[pid][day] = true;
          event(day, a.time, 'TRADING', {
            product_id: pid, event_type: 'SOLD_OUT', severity: 'CRITICAL',
            condition: `Stock reached zero at ${hhmm(a.time)} after ${daySold[pid]} units sold today`,
            action: 'Product marked unavailable for sale; customers offered same-category substitutes; queued for priority review at close',
            metrics: { soldToday: daySold[pid], time: hhmm(a.time) },
          });
        }
      });
      S.txn.run({ run_id: runId, txn_id: txnId, day, time_min: a.time, customer_id: customerId, line_count: lines.length, units, total: dollars(totalC) });
      for (const l of lines) S.line.run(l);
      cashEntry(day, a.time, 'SALE', totalC, txnId);
      revenueC += totalC;
      unitsSold += units;
      txnCount++;
    }
    for (const p of products) hist.sold[p.product_id][day] = daySold[p.product_id] ?? 0;

    // ---------- CLOSE: Store Brain review and replenishment ----------
    const lastDay = day === H;
    const review = closeReview({ day, cfg, products, stock, hist, brainState, cash: dollars(cashC), lastDay, soldOutMin });
    let spendC = 0;
    for (const o of review.orders) {
      const costC = cents(o.total_cost);
      if (costC > cashC) throw new Error('Cash guard tripped: order exceeds available cash');
      o.order_id = ++ids.order;
      const before = cashC;
      cashEntry(day, T_CLOSE, 'REPLENISHMENT', -costC, o.order_id);
      spendC += costC;
      S.order.run({ run_id: runId, order_id: o.order_id, day_placed: day, delivery_day: day + 1, ...o, cash_before: dollars(before), cash_after: dollars(cashC) });
      pending.push(o);
    }
    for (const e of review.events) event(day, T_CLOSE, 'CLOSE', e);
    lastForecast = review.forecasts;

    // ---------- CLOSE: books for the day (engine state, cross-checked by assurance) ----------
    let invValueC = 0;
    for (const p of products) {
      const pid = p.product_id;
      const closing = available(pid);
      const valC = stock[pid].reduce((s, b) => s + b.remaining * cents(b.unitCost), 0);
      invValueC += valC;
      S.stock.run({
        run_id: runId, day, product_id: pid, opening_qty: day === 1 ? 0 : openingQty[pid], received_qty: hist.received[pid][day],
        expired_qty: hist.expired[pid][day], sold_qty: hist.sold[pid][day], closing_qty: closing, closing_value: dollars(valC),
        sold_out_min: soldOutMin[pid] ?? null, lost_units: dayLost[pid] ?? 0, forecast_next: Math.round((review.forecasts[pid] ?? 0) * 10) / 10,
      });
    }
    S.close.run({
      run_id: runId, day, customers: nCustomers, transactions: txnCount, units_sold: unitsSold, revenue: dollars(revenueC), cogs: dollars(cogsC),
      writeoff_value: dollars(writeoffC), replenishment_spend: dollars(spendC), opening_cash: dollars(openingCashC), closing_cash: dollars(cashC),
      closing_inventory_value: dollars(invValueC),
    });
  }
}
