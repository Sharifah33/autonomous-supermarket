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

**Tools.** I built this project together with Claude (Anthropic), used as a coding and analysis assistant in a conversational session.

**How we worked together.** I set the direction from the assignment brief and made the decisions; Claude drafted and implemented. Claude and I worked on:
- drafting the product catalogue and the customer/demand model (shopping missions, traffic, weekday/weekend patterns);
- writing the simulation engine, the Store Brain rules and the SQLite schema with append-only triggers;
- writing the SQL for the reports, findings and Commercial Assurance checks;
- building the React interface and drafting this README.

I ran and tested every version on my own Windows laptop and checked the results in the browser. When something failed or looked wrong, I reported it, and we corrected it together.

**Examples where I reviewed, questioned or changed AI-generated work**

- **Installation failure and the database library.** Claude's first version used `better-sqlite3`. When I ran `npm install` on my laptop, it failed because the package needed C++ build tools. Claude proposed switching to `sql.js`. Before accepting, I questioned whether that still met the brief's SQLite requirement. I confirmed that `sql.js` is the SQLite engine compiled to WebAssembly and that `supermarket.db` is still a standard SQLite file. After the change, the clean install worked, which also means the marker should not hit the same error.
- **Run time against the brief.** On my laptop, a new 60-day run took 9.3 seconds. I checked this against the brief, which says a run "must finish in a few seconds", and asked whether a fix was needed. I decided to have it optimised: we changed how rows are written to the database, without changing the model. I re-tested: runs now take about 4.6 seconds on my laptop, and the results of RUN-0001 are identical, with all 23 assurance checks still passing.
- **Checking that the Submitted Run is typical.** I ran three extra verification runs with random seeds and compared them with RUN-0001. Revenue stayed within about 1.5% across all of them, so I kept RUN-0001 as the Submitted Run rather than choosing a "lucky" one.
- **Corrections found while checking the model during development.** Claude checked its output during the build and corrected several issues, which I then reviewed in the code and the report:
  - The first unit costs gave an implausible 53% gross margin. Costs were reset by category, giving 43.8% overall.
  - Early category weights implied about 5 umbrellas a day in a small CBD store. These were rebalanced.
  - The first opening-stock rule used only about $9.5k of the $40k budget. It was raised to 28 days of cover.
  - A NULL value caused a false FAIL in the inventory reconciliation. The query was fixed, and the data itself was correct.
  - A query error showed category sales at 0.02× plan. It was rewritten and checked.

**What I remained responsible for.** I am responsible for the submitted system and every claim in it:
- the choice of Submitted Run;
- the model's assumptions, which I reviewed on the Model Declaration page;
- the three findings and recommendations in Part 3, which I reviewed and accept as my own;
- confirming that the app installs and runs from this README, and that the assurance checks pass.

I understand how the Store Brain makes its decisions and can trace any reported figure back to the stored records, as shown in the video. Some product prices and demand weights are modelling assumptions rather than real data; this is listed under Known limitations.

## 6. Known limitations

- Demand parameters (traffic, missions, weights) are assumptions, not calibrated data. Results show behaviour, not a forecast.
- There are no markdowns, promotions or price elasticity. Stockouts do not reduce future visits.
- The supplier always delivers in full on time. There is no shelf-capacity limit, shrinkage or card fees.
- The simulated calendar has no public holidays or weather events.
- Costs outside the model boundary (rent, energy, hardware, staff) are excluded, so closing cash is not profit (see Finding F3).
- Part 3 findings are written for the Submitted Run. Their figures are recalculated for any run, but the narrative may fit other runs less well.
- The Google Fonts stylesheet needs internet access; without it the app falls back to system fonts.
- The database is held in memory while the server runs and written back to `supermarket.db` after each committed write, so run only one server process against the file at a time.
