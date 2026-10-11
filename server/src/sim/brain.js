// Autonomous Store Brain - rule-based.
// The Brain only observes recorded store state (stock by batch, sales, sell-out times, write-offs, cash).
// It never sees the demand model's parameters: its forecasts come from observed sales plus the
// planner's pre-opening estimate as a weak prior.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const weekdayOf = (day) => WEEKDAYS[(day - 1) % 7];
export const isWeekendDay = (day) => ['Sat', 'Sun'].includes(weekdayOf(day));
export const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const money = (x) => `$${x.toFixed(2)}`;
const r1 = (x) => Math.round(x * 10) / 10;

const PRIORITY = { SOLD_OUT: 0, LOW_STOCK: 1, PERISHABLE_DAILY: 2, REORDER_POINT: 3 };

// Category weekend/weekday sales ratio observed over the last 14 days (1.0 until both day types seen).
function categoryWeekendFactors(ctx) {
  const { day, products, hist } = ctx;
  const from = Math.max(1, day - 13);
  const agg = {};
  for (const p of products) {
    const a = (agg[p.category_code] ||= { wd: 0, we: 0 });
    for (let t = from; t <= day; t++) {
      if (isWeekendDay(t)) a.we += hist.sold[p.product_id][t];
      else a.wd += hist.sold[p.product_id][t];
    }
  }
  let nwd = 0;
  let nwe = 0;
  for (let t = from; t <= day; t++) (isWeekendDay(t) ? nwe++ : nwd++);
  const out = {};
  for (const [cat, a] of Object.entries(agg)) {
    out[cat] = nwd && nwe && a.wd > 0 ? Math.min(2.5, Math.max(0.3, a.we / nwe / (a.wd / nwd))) : 1;
  }
  return out;
}

export function makeForecaster(ctx) {
  const { day, cfg, hist } = ctx;
  const B = cfg.storeBrain;
  const wf = categoryWeekendFactors(ctx);
  return (p) => {
    const f = wf[p.category_code];
    const from = Math.max(1, day - B.forecastWindowDays + 1);
    let sum = 0;
    let n = 0;
    for (let t = from; t <= day; t++) {
      let s = hist.sold[p.product_id][t];
      if (hist.soldOut[p.product_id][t]) s *= B.censoredUplift; // sold-out day understates demand
      sum += isWeekendDay(t) ? s / f : s; // convert to weekday-equivalent units
      n++;
    }
    const rate = (sum + p.plan_daily_units * B.priorWeightDays) / (n + B.priorWeightDays);
    const forDay = (x) => rate * (isWeekendDay(x) ? f : 1);
    const cover = (days) => {
      let s = 0;
      for (let x = day + 1; x <= day + days; x++) s += forDay(x);
      return s;
    };
    return { rate, weekendFactor: f, tomorrow: forDay(day + 1), cover };
  };
}

// End-of-day review. Returns events and (cash-checked) orders; the engine records them and
// deducts order cost from operating cash at placement. Delivery is next morning.
export function closeReview(ctx) {
  const { day, cfg, products, stock, hist, brainState, cash, lastDay } = ctx;
  const B = cfg.storeBrain;
  const forecaster = makeForecaster(ctx);
  const events = [];
  const candidates = [];
  const forecasts = {};

  for (const p of products) {
    const pid = p.product_id;
    const fc = forecaster(p);
    forecasts[pid] = fc.tomorrow;
    const batches = stock[pid];
    const onHand = batches.reduce((s, b) => s + b.remaining, 0);
    // units still saleable tomorrow (perishable units expiring tomorrow morning do not count)
    const usable = batches.reduce((s, b) => s + (b.expiryDay == null || b.expiryDay > day + 1 ? b.remaining : 0), 0);
    const soldOutToday = hist.soldOut[pid][day];
    const metrics = { onHand, usable, forecastTomorrow: r1(fc.tomorrow), rateWeekdayEq: r1(fc.rate) };

    // ---- waste-aware adjustment (perishables) ----
    if (p.perishable) {
      const from = Math.max(1, day - B.waste.lookbackDays + 1);
      let ex = 0;
      let so = 0;
      let recentSellOut = false;
      for (let t = from; t <= day; t++) {
        ex += hist.expired[pid][t];
        so += hist.sold[pid][t];
        if (t > day - 3 && hist.soldOut[pid][t]) recentSellOut = true;
      }
      const wasteRate = ex + so > 0 ? ex / (ex + so) : 0;
      const old = brainState.wasteFactor[pid];
      if (!lastDay && wasteRate > B.waste.highWasteRate && !recentSellOut && old > B.waste.minFactor) {
        const nf = Math.max(B.waste.minFactor, old * B.waste.stepDown);
        brainState.wasteFactor[pid] = nf;
        events.push({
          product_id: pid, event_type: 'WASTE_ADJUST', severity: 'WARN',
          condition: `Write-off rate ${(wasteRate * 100).toFixed(0)}% of units over last ${day - from + 1} days (${ex} expired vs ${so} sold), no recent sell-out`,
          action: `Reduced perishable order-target factor ${old.toFixed(2)} -> ${nf.toFixed(2)}`,
          metrics: { ...metrics, wasteRate: r1(wasteRate * 100), expired7: ex, sold7: so, factorFrom: old, factorTo: nf },
        });
      } else if (!lastDay && soldOutToday && old < 1) {
        const nf = Math.min(1, old * B.waste.stepUp);
        brainState.wasteFactor[pid] = nf;
        events.push({
          product_id: pid, event_type: 'WASTE_ADJUST', severity: 'INFO',
          condition: `Sold out today while order target was reduced for waste (factor ${old.toFixed(2)})`,
          action: `Restored order-target factor ${old.toFixed(2)} -> ${nf.toFixed(2)} to protect availability`,
          metrics: { ...metrics, factorFrom: old, factorTo: nf },
        });
      }
    }

    // ---- slow-moving stock (non-perishables; perishable slow sales surface as write-off) ----
    if (!p.perishable && day >= B.slowMover.minDay && onHand > 0) {
      const from = Math.max(1, day - B.slowMover.lookbackDays + 1);
      let s = 0;
      for (let t = from; t <= day; t++) s += hist.sold[pid][t];
      const avg = s / (day - from + 1);
      const coverDays = onHand / Math.max(avg, 0.05);
      if (coverDays > B.slowMover.coverDaysThreshold && day - brainState.lastSlowFlag[pid] >= B.slowMover.refreshEveryDays) {
        brainState.lastSlowFlag[pid] = day;
        const value = onHand * p.unit_cost;
        events.push({
          product_id: pid, event_type: 'SLOW_MOVER', severity: 'WARN',
          condition: `${onHand} units on hand = ${coverDays > 999 ? '999+' : coverDays.toFixed(0)} days of cover at ${avg.toFixed(2)}/day (last ${day - from + 1} days); ${money(value)} at cost`,
          action: 'Replenishment held (stock far above reorder point); flagged to remote manager for markdown / range review',
          metrics: { ...metrics, avgDaily: r1(avg), coverDays: Math.round(Math.min(coverDays, 9999)), stockValue: Math.round(value * 100) / 100 },
        });
      }
    }

    // ---- replenishment need ----
    let reason = null;
    let target = 0;
    let low = false;
    if (!p.perishable) {
      const rop = fc.cover(B.nonPerishable.reorderPointDays);
      target = fc.cover(B.nonPerishable.orderUpToDays);
      low = usable <= fc.cover(B.nonPerishable.lowStockDays);
      if (usable <= rop) reason = soldOutToday || usable === 0 ? 'SOLD_OUT' : low ? 'LOW_STOCK' : 'REORDER_POINT';
    } else {
      const L = p.shelf_life_days;
      const coverDays = Math.min(B.perishable.maxCoverDays, Math.max(1, L - 1));
      target = Math.min(fc.cover(coverDays) * (1 + B.perishable.safetyFactor) * brainState.wasteFactor[pid], fc.cover(L));
      low = L > 1 && usable < fc.cover(B.perishable.lowStockDays);
      if (usable < target) reason = soldOutToday ? 'SOLD_OUT' : low ? 'LOW_STOCK' : 'PERISHABLE_DAILY';
    }
    metrics.target = r1(target);

    let cases = 0;
    if (reason) {
      const want = target - usable;
      cases = p.perishable ? Math.round(want / p.case_size) : Math.ceil(want / p.case_size);
      if (cases === 0 && (reason === 'SOLD_OUT' || reason === 'LOW_STOCK')) cases = 1;
    }
    const cand = { p, reason, cases, target, usable, onHand, forecast: fc.tomorrow, soldOutToday, low, metrics };
    if (soldOutToday || (low && usable > 0) || cases > 0) candidates.push(cand);
  }

  // ---- cash-constrained allocation ----
  candidates.sort(
    (a, b) =>
      (PRIORITY[a.reason] ?? 9) - (PRIORITY[b.reason] ?? 9) ||
      (b.p.unit_price - b.p.unit_cost) * b.forecast - (a.p.unit_price - a.p.unit_cost) * a.forecast,
  );
  let available = cash - B.cashReserve;
  const requestedTotal = candidates.reduce((s, c) => s + c.cases * c.p.case_size * c.p.unit_cost, 0);
  const orders = [];
  let constrainedCount = 0;
  for (const c of candidates) {
    c.order = null;
    c.constrained = false;
    if (lastDay || c.cases === 0) continue;
    const caseCost = c.p.case_size * c.p.unit_cost;
    let cases = c.cases;
    if (cases * caseCost > available + 1e-9) {
      cases = Math.max(0, Math.floor((available + 1e-9) / caseCost));
      c.constrained = true;
      constrainedCount++;
    }
    if (cases > 0) {
      const qty = cases * c.p.case_size;
      const cost = Math.round(qty * c.p.unit_cost * 100) / 100;
      available -= cost;
      c.order = {
        product_id: c.p.product_id, reason: c.reason ?? 'LOW_STOCK', requested_qty: c.cases * c.p.case_size, qty, cases,
        unit_cost: c.p.unit_cost, total_cost: cost, cash_constrained: c.constrained ? 1 : 0,
        forecast_daily: r1(c.forecast), usable_stock: c.usable, target_stock: r1(c.target),
      };
      orders.push(c.order);
    }
  }

  // ---- condition -> action events ----
  const orderText = (c) =>
    c.order
      ? `Ordered ${c.order.qty} units (${c.order.cases} x ${c.p.case_size}) for delivery before opening Day ${day + 1}${c.constrained ? ' - REDUCED by cash constraint' : ''}`
      : lastDay
        ? 'No order placed: simulation horizon ends after Day 60 (no Day 61); condition reported to manager'
        : c.constrained
          ? 'No order placed: insufficient operating cash above reserve'
          : 'No order needed: incoming need covered by usable stock';
  for (const c of candidates) {
    const pid = c.p.product_id;
    if (c.soldOutToday) {
      events.push({
        product_id: pid, event_type: 'SOLD_OUT_RESPONSE', severity: 'CRITICAL', order: c.order,
        condition: `Sold out during trading at ${hhmm(ctx.soldOutMin[pid])}; ${c.usable} usable units for tomorrow vs forecast ${c.forecast.toFixed(1)}`,
        action: orderText(c), metrics: c.metrics,
      });
    } else if (c.low && c.usable > 0) {
      events.push({
        product_id: pid, event_type: 'LOW_STOCK', severity: 'WARN', order: c.order,
        condition: `Usable stock ${c.usable} below ${c.p.perishable ? B.perishable.lowStockDays : B.nonPerishable.lowStockDays}-day cover (forecast ${c.forecast.toFixed(1)}/day)`,
        action: orderText(c), metrics: c.metrics,
      });
    }
    if (c.constrained) {
      events.push({
        product_id: pid, event_type: 'CASH_CONSTRAINED', severity: 'CRITICAL', order: c.order,
        condition: `Requested ${c.cases * c.p.case_size} units (${money(c.cases * c.p.case_size * c.p.unit_cost)}) exceeds cash available above reserve`,
        action: c.order ? `Reduced to ${c.order.qty} units` : 'Order skipped', metrics: c.metrics,
      });
    }
  }
  const spend = orders.reduce((s, o) => s + o.total_cost, 0);
  events.push({
    product_id: null, event_type: lastDay ? 'END_OF_HORIZON' : 'CASH_REVIEW', severity: constrainedCount ? 'CRITICAL' : 'INFO',
    condition: `Closing cash ${money(cash)}; reserve ${money(B.cashReserve)}; ${candidates.filter((c) => c.cases > 0).length} products needed replenishment worth ${money(requestedTotal)}`,
    action: lastDay
      ? 'No orders placed after close of Day 60 (no Day 61 in horizon); closing low-stock and sold-out conditions reported'
      : `Placed ${orders.length} orders totalling ${money(spend)}; ${constrainedCount} constrained by cash; cash after orders ${money(cash - spend)}`,
    metrics: { cash, reserve: B.cashReserve, requested: Math.round(requestedTotal * 100) / 100, spend: Math.round(spend * 100) / 100, orders: orders.length, constrained: constrainedCount },
  });

  return { events, orders, forecasts };
}
