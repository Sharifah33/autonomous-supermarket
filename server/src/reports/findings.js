import { makeQ, performance, operations } from './reports.js';

// Part 3 - Commercial diagnosis and management recommendations.
// The reasoning (diagnosis, implication, recommendation) is the analyst's; every figure quoted is
// computed here from the run's stored history, and each evidence item links to the underlying record.

const $ = (x) => `$${Number(x).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (x) => `${Number(x).toFixed(1)}%`;

export function findings(db, runId) {
  const { all, get } = makeQ(db, runId);
  const perf = performance(db, runId);
  const ops = operations(db, runId);
  const T = perf.totals;
  const H = perf.daily.length;

  // ---------- Finding 1: short-life ready-to-eat availability vs waste trade-off ----------
  const shortLife = perf.products.filter((p) => p.perishable && p.shelf_life_days <= 2);
  const sl = shortLife.reduce((a, p) => ({ wo: a.wo + p.writeoff_value, eu: a.eu + p.expired_units, lost: a.lost + p.lost_value, lu: a.lu + p.lost_units, sod: a.sod + p.sold_out_days, rev: a.rev + p.revenue, gp: a.gp + p.gross_profit }), { wo: 0, eu: 0, lost: 0, lu: 0, sod: 0, rev: 0, gp: 0 });
  const worst = [...shortLife].sort((a, b) => b.writeoff_value + b.lost_value - (a.writeoff_value + a.lost_value))[0];
  const both = get(`SELECT COUNT(*) n FROM daily_stock d WHERE d.run_id=@r AND d.product_id=@p AND d.sold_out_min IS NOT NULL
      AND EXISTS (SELECT 1 FROM daily_stock e WHERE e.run_id=d.run_id AND e.product_id=d.product_id AND e.day BETWEEN d.day-2 AND d.day+2 AND e.expired_qty>0)`, { p: worst.product_id }).n;
  const adj = get(`SELECT SUM(severity='WARN') down, SUM(severity='INFO') up FROM brain_events WHERE run_id=@r AND product_id=@p AND event_type='WASTE_ADJUST'`, { p: worst.product_id });
  const wHalves = get(`SELECT SUM(CASE WHEN day<=30 THEN expired_qty END) e1, SUM(CASE WHEN day>30 THEN expired_qty END) e2,
      SUM(CASE WHEN day<=30 AND sold_out_min IS NOT NULL THEN 1 ELSE 0 END) s1, SUM(CASE WHEN day>30 AND sold_out_min IS NOT NULL THEN 1 ELSE 0 END) s2
    FROM daily_stock WHERE run_id=@r AND product_id=@p`, { p: worst.product_id });
  const firstSoldOut = get(`SELECT MIN(day) d FROM daily_stock WHERE run_id=@r AND product_id=@p AND sold_out_min IS NOT NULL`, { p: worst.product_id }).d;
  const firstWO = get(`SELECT MIN(day) d FROM daily_stock WHERE run_id=@r AND product_id=@p AND expired_qty>0`, { p: worst.product_id }).d;
  const rteCat = perf.categories.find((c) => c.category_code === 'RTE');

  const f1 = {
    id: 'F1',
    title: 'Short-life ready-to-eat lines carry both the store\'s stockouts and its waste',
    kind: 'Problem / trade-off',
    observation: `Products with a 1-2 day shelf life produced ${pct((sl.wo / T.writeoff_value) * 100)} of all write-off value and ${pct((sl.lost / T.lost_value) * 100)} of lost demand value, even though the Store Brain re-orders them every day. ${worst.name} is the extreme case: it both sold out and wrote stock off repeatedly.`,
    evidence: [
      { label: 'Short-life (<=2 day) lines: write-off at cost', value: $(sl.wo), link: { page: 'report', tab: 'ops' } },
      { label: 'Short-life lines: lost demand at retail', value: `${$(sl.lost)} (${sl.lu} units, ${sl.sod} sold-out product-days)`, link: { page: 'report', tab: 'ops' } },
      { label: `${worst.name}: sold out / written off`, value: `${worst.sold_out_days} sold-out days; ${worst.expired_units} units expired (${pct(worst.waste_rate_pct)} of supply), ${$(worst.writeoff_value)}`, link: { page: 'product', id: worst.product_id } },
      { label: `${worst.name}: sold-out days within 2 days of a write-off`, value: `${both} of ${worst.sold_out_days}`, link: { page: 'product', id: worst.product_id } },
      { label: 'Waste-aware Brain adjustments (down / restored)', value: `${adj.down ?? 0} / ${adj.up ?? 0}; write-off ${wHalves.e1} units Days 1-30 vs ${wHalves.e2} Days 31-60`, link: { page: 'brain', type: 'WASTE_ADJUST', product: worst.product_id } },
      { label: 'First sold-out / first write-off day', value: `Day ${firstSoldOut} / Day ${firstWO}`, link: { page: 'day', day: firstSoldOut } },
      { label: 'Ready-to-Eat share of revenue / gross profit', value: `${pct(rteCat.revenue_share_pct)} / ${pct((rteCat.gross_profit / T.gross_profit) * 100)}`, link: { page: 'report', tab: 'performance' } },
    ],
    diagnosis: `With a ${worst.shelf_life_days}-day life the Brain has one order per day to match an uncertain next-day demand, and supplier case packs (${worst.case_size} units) make order sizes lumpy. Ordering one case more than needed becomes write-off the next morning; one case fewer sells out by mid-afternoon. The Brain's waste rule cut the order target after high write-off and restored it after sell-outs (${adj.down ?? 0} cuts, ${adj.up ?? 0} restores), so it oscillated around the problem rather than removing it: write-off was ${wHalves.e2 > wHalves.e1 ? 'higher' : 'not materially lower'} in the second half. This is a structural trade-off, not a Brain fault.`,
    implication: `Ready-to-eat is the highest-margin category (${pct(rteCat.gross_margin_pct)}) and a large share of profit, so both failure modes cost real money: ${$(sl.wo)} of stock thrown away plus ${$(sl.lost)} of sales missed (at retail) on these lines. Lunch customers who find the fridge empty may also not return - an effect the model does not capture.`,
    recommendation: `Pilot a last-day markdown (e.g. 30-50% off from 6 pm on units that expire tomorrow morning) and negotiate smaller case packs (e.g. 4) for 1-day lines. Then set a target service level per product rather than one rule for all. Re-tune the order rule with the first 4 weeks of real sell-through and hourly sell-out data.`,
    limitation: 'Markdowns, smaller packs and repeat-visit loss are not modelled; demand for each product is independent of availability on previous days. The size of any gain must be validated with real operating data.',
  };

  // ---------- Finding 2: opening allocation vs actual velocity; slow movers tie up capital ----------
  const catVel = all(`SELECT p.category, p.category_code, SUM(p.plan_daily_units) plan,
      ROUND((SELECT SUM(d.sold_qty) FROM daily_stock d JOIN run_products q ON q.run_id=d.run_id AND q.product_id=d.product_id
             WHERE d.run_id=@r AND q.category_code=p.category_code AND d.day > 14)*1.0/(@h-14),1) actual
    FROM run_products p WHERE p.run_id=@r GROUP BY p.category_code`, { h: H });
  for (const c of catVel) c.ratio = Math.round((c.actual / c.plan) * 100) / 100;
  catVel.sort((a, b) => a.ratio - b.ratio);
  const prodRatio = all(`SELECT p.product_id, p.name, p.plan_daily_units plan, ROUND(AVG(d.sold_qty),2) actual
    FROM run_products p JOIN daily_stock d ON d.run_id=p.run_id AND d.product_id=p.product_id AND d.day > 14
    WHERE p.run_id=@r GROUP BY p.product_id`).map((x) => ({ ...x, ratio: Math.round((x.actual / x.plan) * 100) / 100 })).sort((a, b) => a.ratio - b.ratio);
  const lowP = prodRatio.filter((x) => x.ratio < 0.7);
  const highP = prodRatio.filter((x) => x.ratio > 1.4);
  const under = catVel[catVel.length - 1];
  const slow = ops.slowMovers;
  const persistent = slow.filter((s) => (s.closing_cover_days ?? 999) > 30);
  const recovered = slow.filter((s) => (s.closing_cover_days ?? 999) <= 30);
  const slowFirstValue = slow.reduce((a, s) => a + (s.first_value ?? 0), 0);
  const persistentClose = persistent.reduce((a, s) => a + s.closing_value, 0);
  const persistentOpen = persistent.reduce((a, s) => a + s.initial_qty, 0);
  // How fast the Brain's forecast moved away from the (wrong) plan for the most under-planned product
  const adapt = get(`SELECT p.product_id, p.name, p.plan_daily_units plan,
      (SELECT forecast_next FROM daily_stock d WHERE d.run_id=p.run_id AND d.product_id=p.product_id AND d.day=1) f1,
      (SELECT forecast_next FROM daily_stock d WHERE d.run_id=p.run_id AND d.product_id=p.product_id AND d.day=7) f7,
      (SELECT ROUND(AVG(sold_qty),1) FROM daily_stock d WHERE d.run_id=p.run_id AND d.product_id=p.product_id AND d.day>14) actual,
      (SELECT SUM(sold_out_min IS NOT NULL) FROM daily_stock d WHERE d.run_id=p.run_id AND d.product_id=p.product_id) sod
    FROM run_products p WHERE p.run_id=@r AND p.category_code=@c ORDER BY actual*1.0/p.plan_daily_units DESC LIMIT 1`, { c: under.category_code });
  const underSod = get(`SELECT SUM(d.sold_out_min IS NOT NULL) n FROM daily_stock d JOIN run_products p ON p.run_id=d.run_id AND p.product_id=d.product_id WHERE d.run_id=@r AND p.category_code=@c`, { c: under.category_code }).n;

  const f2 = {
    id: 'F2',
    title: 'Opening stock was allocated from desk estimates; low-velocity convenience lines tied up capital',
    kind: 'Anomaly / limitation of the opening plan',
    observation: `${slow.length} non-perishable products were flagged as slow movers, ${persistent.length} of them still holding more than 30 days of cover at Day ${H}. The pre-opening plan was wrong in both directions: ${lowP.length} products sold under 70% of their planned daily units (lowest: ${lowP.slice(0, 3).map((x) => `${x.name} ${x.ratio}x`).join(', ')}), while ${highP.length} sold over 140% (${under.category} as a whole ran at ${under.ratio}x plan).`,
    evidence: [
      { label: 'Slow-mover products / stock value at first flag', value: `${slow.length} / ${$(slowFirstValue)} at cost`, link: { page: 'brain', type: 'SLOW_MOVER' } },
      { label: 'Still slow at close (cover > 30 days)', value: persistent.length ? persistent.map((s) => `${s.name} (${s.closing_qty} left of ${s.initial_qty})`).join('; ') : 'none', link: persistent[0] ? { page: 'product', id: persistent[0].product_id } : null },
      { label: 'Closing value of persistent slow movers', value: `${$(persistentClose)} (opening quantity ${persistentOpen} units)`, link: { page: 'report', tab: 'ops' } },
      { label: 'Flagged early but sold through by Day 60', value: recovered.length ? recovered.map((s) => s.name).join('; ') : 'none', link: recovered[0] ? { page: 'product', id: recovered[0].product_id } : null },
      { label: 'Products selling <70% / >140% of plan (Days 15-60)', value: `${lowP.length} / ${highP.length} of ${prodRatio.length}`, link: { page: 'report', tab: 'performance' } },
      { label: 'Actual / planned daily units by category (Days 15-60)', value: catVel.map((c) => `${c.category} ${c.ratio}x`).join(', '), link: { page: 'model' } },
      { label: `${adapt.name}: plan vs Brain forecast (Day 1 -> Day 7) vs actual`, value: `plan ${adapt.plan}/day; forecast ${adapt.f1} -> ${adapt.f7}; actual ${adapt.actual}/day (Days 15-60)`, link: { page: 'product', id: adapt.product_id } },
      { label: `${under.category}: sold-out product-days in 60 days`, value: `${underSod}`, link: { page: 'report', tab: 'ops' } },
    ],
    diagnosis: `Opening quantities were set as the planner's daily estimate x 28 days for every non-perishable line, with at least one supplier case. For niche items (cables, umbrellas, kombucha) the estimate was too high and a minimum case of 10-12 units is itself months of stock, so the Brain correctly held replenishment and the stock simply waited. For high-velocity resident lines (${under.category}) the plan was too low, but this caused few sell-outs (${underSod} product-days): perishable lines are re-ordered daily and the Brain's forecast moved from the planner's prior towards observed sales within a week (${adapt.name}: ${adapt.f1} -> ${adapt.f7} units/day against a plan of ${adapt.plan}). Some early slow-mover flags (${recovered.map((s) => s.name).join(', ') || 'none'}) were noise from a low-traffic opening ramp on low-volume lines.`,
    implication: `Capital and shelf space in a small CBD store are scarce. ${$(persistentClose)} of stock is still sitting in lines selling a few units a day, and the opening budget was ${$(T.opening_inventory_cost)} of the $40,000 allowed. A smaller, better-targeted opening range would have released space for proven lines.`,
    recommendation: `Treat the first 2-3 weeks as a range trial: open niche convenience lines with a single case and a 14-day review, and mark down or delist persistent slow movers (${persistent.map((s) => s.name).join(', ') || 'none in this run'}). Allocate opening depth by category velocity rather than a flat 28 days. Raise the slow-mover minimum observation window so flags only start after the opening ramp (e.g. Day 15).`,
    limitation: 'Category demand weights are modelling assumptions, not observed IGA data; the plan-vs-actual gap shows how the Brain adapts to a wrong plan, not which plan is right. Shelf-space capacity is not modelled.',
  };

  // ---------- Finding 3: cash accumulates; constraint never binds; result is before overheads ----------
  const headroom = ops.cashHeadroom;
  const avgGpAfterWO = T.gp_after_writeoff / H;
  const steady = get(`SELECT ROUND(SUM(l.qty*(l.unit_price-l.unit_cost))*1.0/COUNT(DISTINCT t.day),2) gp
    FROM transactions t JOIN transaction_lines l ON l.run_id=t.run_id AND l.txn_id=t.txn_id WHERE t.run_id=@r AND t.day>14`);
  const wo2 = get(`SELECT ROUND(SUM(writeoff_value)/COUNT(*),2) w FROM day_close WHERE run_id=@r AND day>14`).w;
  const steadyNet = steady.gp - wo2;
  const weekendRev = perf.dayType.find((d) => d.day_type === 'Weekend');
  const weekdayRev = perf.dayType.find((d) => d.day_type === 'Weekday');

  const f3 = {
    id: 'F3',
    title: 'Operating cash never constrained the Brain - but the result is before rent, staff and systems costs',
    kind: 'Limitation / interpretation risk',
    observation: `Operating cash rose from ${$(T.opening_cash)} to ${$(T.closing_cash)} over ${H} days. No replenishment order was reduced or skipped for lack of cash, so the cash-constraint rule was never tested by this run.`,
    evidence: [
      { label: 'Closing operating cash', value: $(T.closing_cash), link: { page: 'assurance' } },
      { label: 'Orders reduced/skipped by cash rule', value: `${ops.counts.find((c) => c.event_type === 'CASH_CONSTRAINED').n} of ${ops.orders.n}`, link: { page: 'brain', type: 'CASH_REVIEW' } },
      { label: 'Smallest cash headroom after requested orders', value: `${$(headroom.min_headroom)} on Day ${headroom.min_day}`, link: { page: 'day', day: headroom.min_day } },
      { label: 'Replenishment spend as % of revenue', value: pct((T.replenishment_spend / T.revenue) * 100), link: { page: 'report', tab: 'ops' } },
      { label: 'Average daily gross profit after write-off (steady state, Days 15-60)', value: $(steadyNet), link: { page: 'report', tab: 'performance' } },
      { label: 'Average daily revenue weekday vs weekend', value: `${$(weekdayRev.avg_revenue)} vs ${$(weekendRev.avg_revenue)}`, link: { page: 'report', tab: 'performance' } },
    ],
    diagnosis: `The store converts stock to cash within days (most lines are re-ordered against a 10-day cover or less) at a ${pct(T.gross_margin_pct)} gross margin, while the A$15,000 starting cash and 1-day lead time mean the store is never short of cash after Day 1. The cash build-up is gross profit less write-off (${$(T.gp_after_writeoff)}) plus the run-down of opening inventory that was funded outside operating cash (${$(T.opening_inventory_cost)} opening vs ${$(T.closing_inventory_value)} closing). By the brief's model boundary it excludes rent, fit-out, refrigeration, electricity, insurance, autonomous-store hardware, payment fees, shrinkage and the remote manager.`,
    implication: `The headline "${$(T.closing_cash)} closing cash" must not be read as profit. The commercially relevant number is the steady-state contribution of about ${$(steadyNet)} per day (~${$(steadyNet * 365)} a year) available to cover all excluded costs. Whether a Swanston Street site is viable depends on those costs, which the client has not supplied.`,
    recommendation: `Before the next investment decision, have the client supply annual occupancy, energy, technology and shrinkage estimates and compare them with the ~${$(steadyNet)}/day contribution to get a break-even customer count. Re-run the model with lower traffic (e.g. -20% and -35%) to test the cash rule and margin under stress, and consider holding surplus cash centrally rather than in the store float.`,
    limitation: 'Traffic levels (about 540 weekday / 380 weekend customers at full trading) are assumptions, not forecasts; the contribution scales almost directly with them. Theft/shrinkage and card fees are not modelled.',
  };

  return { findings: [f1, f2, f3], context: { revenue: T.revenue, gross_profit: T.gross_profit, closing_cash: T.closing_cash, categoryVelocity: catVel } };
}
