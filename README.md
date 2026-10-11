# Autonomous Supermarket: Simulation, Store Brain and Commercial Assurance

CSE3CWA / CSE5006 Assignment 4. A full-stack prototype that builds a small IGA-style autonomous supermarket near Swanston Street / Melbourne Town Hall, operates it for 60 simulated days with a rule-based **Store Brain**, and reports the result to a remote manager with full traceability to the stored history.

**Submitted Run: `RUN-0001`** (seed 20261011), stored in `server/data/supermarket.db`.

| | |
|---|---|
| Frontend | React 18 + Vite 6, Recharts |
| Backend | Node.js (20 or 22 LTS) + Express 4 |
| Storage | SQLite via `sql.js` (SQLite compiled to WebAssembly) in a single file: `server/data/supermarket.db` |

## 1. Install and run (localhost)

Requirements: **Node.js 20 or 22 LTS** and npm 10 or later. No environment variables, database server or C++ build tools are needed. The SQLite engine (`sql.js`) is pure WebAssembly, so `npm install` works the same on Windows, macOS and Linux.

```bash
npm install        # installs root, server and client (npm workspaces)
npm run dev        # API on http://localhost:4000, web app on http://localhost:5173
```

Open **http://localhost:5173**. The app opens the Submitted Run's 60-Day Commercial Report.

Alternative single-port mode: `npm start` builds the React app and serves everything from http://localhost:4000.

Other commands (run from the project root):

| Command | What it does |
|---|---|
| `npm run verify` | Runs all Commercial Assurance checks on the Submitted Run in the terminal (exit code 0 = PASS) |
| `npm run new-run` | Creates an additional 60-day run with a random seed (`npm run new-run -- 123` for seed 123) |
| `npm run seed` | Only if the database file is missing: creates `RUN-0001` with seed 20261011 and designates it as the Submitted Run |

Optional: `PORT` (default 4000) and `DB_PATH` (default `server/data/supermarket.db`).

## 2. Where things are in the application

| Requirement | Where |
|---|---|
| Submitted Run and Run ID | Yellow run label in the sidebar; **Simulation runs** page |
| Model Declaration, setup, budget and product data | **Model Declaration** |
| 60-Day Commercial Report, Parts 1-4 | **60-Day Commercial Report** tabs: Part 1 Business performance, Part 2 Inventory & Store Brain, Part 3 Diagnosis & recommendations, Part 4 Commercial assurance |
| Daily Reports (Days 1-60) | **Daily Reports**: day selector, previous/next, and a 60-day strip |
| Commercial Assurance | **Commercial Assurance** (full reconciliation tables) |
| Traceability | Every day, product, event and evidence item links to the Daily Report, **Product trace**, **Store Brain log** or an individual transaction (lines, batches drawn, cash entry) |
| Create a new run | **Simulation runs** > Start new 60-day run (about 3-5 s) |

## 3. Architecture and data flow

```
server/src/model/catalogue.js   72 products (cost, price, shelf life, case size, popularity, planner estimate)
server/src/model/config.js      customer/demand model + Store Brain rules  -> frozen into runs.config_json
server/src/sim/engine.js        60-day loop: deliveries -> expiry -> customers & sales -> Brain close review
server/src/sim/brain.js         rule-based Store Brain (forecast, low stock, sold out, expiry, slow movers, cash)
server/src/db.js                SQLite schema + append-only guard triggers
server/src/sqlite.js            small synchronous wrapper over sql.js; writes the .db file atomically after each commit
                                (history tables are WITHOUT ROWID and statistics are refreshed with ANALYZE after each run)
server/src/reports/*.js         reports, findings, daily views and assurance, all computed by SQL from history
server/src/index.js             Express API (read-only except POST /api/runs = start a new run)
client/src                      React app (hash routes, e.g. #/RUN-0001/day/12)
```

The data is kept in three separate layers:

1. **Configuration (frozen per run).** `runs` holds the run ID, seed, opening cash, budget and the full `config_json`. `run_products` is the run's own copy of the product data.
2. **Recorded history (append-only).** `customers`, `transactions`, `transaction_lines`, `batches`, `inventory_movements` (OPENING / RECEIPT / SALE / EXPIRY, signed quantities), `lost_sales`, `replenishment_orders`, `cash_ledger`, `brain_events`, plus the engine's own end-of-day books (`daily_stock`, `day_close`).
3. **Derived reports.** Nothing is stored. Every report figure is recalculated from layer 2 when a page loads.

**Immutability.** A whole run is written inside one SQLite transaction. If anything fails, nothing is kept. Database triggers reject any UPDATE or DELETE on history tables, any insert into a run that is not RUNNING, any change to a run's configuration, and any change to the Submitted Run designation. The API exposes no edit or delete endpoints. The Assurance page performs a live tamper test to demonstrate this.

**Assurance** compares independent records. For example:
- the engine's daily stock books are checked against the movement log;
- daily revenue is checked against transactions and against cash receipts;
- order costs are checked against the ledger and the cash available at the time of each order;
- per-batch running balances are checked for negative stock;
- sale dates are checked against batch expiry for expired-product sales.

The full checks run in about 1 second.

## 4. Customer/demand model and Store Brain (summary)

The full assumptions are on the **Model Declaration** page.

- **Traffic.** About 540 visits on a full-trading weekday and 380 on a weekend day, with day-of-week factors. A new-store ramp runs from 70% on Day 1 to 100% by Day 14. Daily random variation uses a log-normal σ of 0.07.
- **Shopping missions.** Every customer has one of five missions, and each has its own weekday/weekend share, basket size, category weights and hourly arrival profile:
  - commuter grab-and-go;
  - lunch run;
  - snack and drink top-up;
  - dinner / top-up shop;
  - household stock-up.
- **Product choice.** A category is drawn first, then a product in proportion to its popularity weight. Quantity rules vary by category. Sold-out items may be substituted within the same category; otherwise the demand is recorded as lost.
- **Perishables.** Stock is held in batches with a receipt day and an expiry day, and sold first-expiring-first-out. Expired stock is removed at 06:30 before trading.
- **Store Brain forecast.** A 7-day sales forecast, blended with the planner's estimate. Sold-out days are scaled up because sales understate demand on those days. A category weekend factor adjusts the forecast for the next day type.
- **Store Brain ordering.**
  - Non-perishables: reorder point of 4 days, order up to 10 days.
  - Perishables: daily orders up to min(shelf life − 1, 3) days plus 15% safety stock, capped at what can sell before expiry, with a waste-feedback factor.
  - Cases are rounded.
- **Store Brain alerts and cash.** Low-stock, sold-out, near-expiry and slow-mover alerts are raised. Orders are ranked by priority and kept within cash above a A$1,000 reserve. The fixed 1-day lead time applies, and no orders are placed after Day 60.

Submitted Run headline: 29,064 customers, A$369,343 revenue, 43.8% gross margin, A$1,972 write-off, closing cash A$197,319 (before costs outside the model boundary), and opening inventory of A$35,147 against the A$40,000 budget. All 23 assurance checks PASS.

## 5. AI collaboration

> **To complete by the student.** The brief requires your own account of how you used AI and where you reviewed, changed or rejected its output. Replace this section with what you actually did, and keep only examples you have checked yourself.

**Tools.** Claude (Anthropic) was used to scaffold the project: catalogue drafting, the simulation engine, the Store Brain rules, SQL reports, the assurance checks, the React UI and this README.

**Issues found and corrected during development.** These are examples you can verify in the code and data before you cite them:

- **Cost calibration.** The first catalogue produced a 53% overall gross margin, which is implausible for a supermarket. Unit costs were reset by category, giving 43.8% overall: dairy and pantry around 32-35%, ready-to-eat around 47%.
- **Category weights.** The first category weights implied about 5 umbrellas and 15 toilet-paper packs sold per day in a small CBD store. Household and pantry weights were reduced and popularity was rebalanced.
- **Opening allocation.** The first opening-inventory rule used only about $9.5k of the $40k budget, which caused needless early stockouts. The non-perishable cover was raised to 28 days with a one-case minimum.
- **False assurance failure.** Products that were never re-ordered produced a NULL in the inventory reconciliation, so it reported a FAIL. The query was fixed with `COALESCE`; the data was correct all along.
- **Findings errors.** A Finding 2 query joined daily rows to the plan and inflated planned units 46-fold, showing category velocities of 0.02x. It was rewritten and checked by hand. One evidence item (sell-outs in the first week vs the last week) contradicted its own diagnosis and was replaced.

**What I remained responsible for.** [Your own statement: which assumptions you reviewed or changed, how you checked the figures, what you would defend in the video.]

## 6. Known limitations

- Demand parameters (traffic, missions, weights) are assumptions, not calibrated data. Results show behaviour, not a forecast.
- There are no markdowns, promotions or price elasticity. Stockouts do not reduce future visits.
- The supplier always delivers in full on time. There is no shelf-capacity limit, shrinkage or card fees.
- The simulated calendar has no public holidays or weather events.
- Costs outside the model boundary (rent, energy, hardware, staff) are excluded, so closing cash is not profit (see Finding F3).
- Part 3 findings are written for the Submitted Run. Their figures are recalculated for any run, but the narrative may fit other runs less well.
- The Google Fonts stylesheet needs internet access; without it the app falls back to system fonts.
- The database is held in memory while the server runs and written back to `supermarket.db` after each committed write, so run only one server process against the file at a time.
