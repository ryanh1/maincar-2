# Doc 5b — Reporting, Dashboards & Profiles

*Split from the old doc 5, which grew too big. This doc owns **everything reporting**: the reporting home and report lifecycle, the activity report, the pipeline transition waterfall, the custom pivot builder, the cohort/decay report, the shipped templates, dashboards, user profile pages, computed/formula fields, and scheduled report delivery. Journey numbers are preserved from the old doc 5 so cross-references (doc 9 → 5.8 waterfall, doc 8 → 5.9a cohort) still resolve.*

Sibling docs: **[Doc 5](5-comms-email-and-calendar.md)** (email/calendar/mailboxes/recording) and **[Doc 5a](5a-crm-data-ops-and-hygiene.md)** (bulk, dedupe, trash, import, retention, audit).

**Benchmarks:** **Attio** (dashboards + report types), **Clari** (pipeline waterfall), **Salesforce/HubSpot** (standard report library), **Excel PivotTable** (the pivot builder), **Metabase** (cohort/funnel + scheduled subscriptions), **Lattice/Linear/Notion** (member profiles — Attio has none, so we look outside it).

**On "just enough BI" — I changed the line per your feedback.** My earlier doc said we would *not* build scheduled reports, extra chart types, drill-through, or cross-source blending. **You want all of those (and maybe more) — so this doc builds them.** The **one** thing we still avoid is a **bespoke formula language**: we use an existing open-source formula library instead (Journey 5.9e). So the new line is: *build a real, composable reporting tool; don't invent a query or formula language when a proven library exists.*

**Convention reminder.** Every UI journey states its **entry point** first. Every background job states **trigger → steps → pg-boss params**. Any AI/model choice names the model.

---

## New surfaces this doc adds

- **Reports** page in the navbar — the reporting home: a **Templates gallery**, a **My/Shared reports** list, and the **report builder** (Journeys 5.8–5.9b).
- **Dashboards** — named boards that hold report tiles and text blocks (Journey 5.9c).
- **Profiles** — a workspace-member profile page, optionally carrying a personal dashboard (Journey 5.9d).
- **Settings → Computed fields** — define a formula field once, reuse it across reports and tables (Journey 5.9e).

---

## Journey 5.8 — The reporting home and the report lifecycle

*As a rep or manager, I want one place to open, build, save, name, edit, share, and delete reports, so that I can measure the business without a BI tool.*

**This answers your "you never say how we access reporting, view templates, or CRUD reports" note.**

**Entry point.** The left navbar has a **Reports** item. Clicking it opens the reporting home, which has three areas:
1. **Templates gallery** (default tab) — a grid of the shipped report templates (Journey 5.9b), each a card with a title, a thumbnail of its chart shape, and a one-line description. This is how a user "views templates."
2. **Reports list** — two sub-tabs, **My reports** and **Shared with me**, each a table: name, kind (activity / transition / pivot / cohort), owner, last-edited, and row actions (**Open, Duplicate, Share, Rename, Delete**).
3. **+ New report** button — opens the builder on a blank pivot (Journey 5.9), or "Start from a template."

**Create → save → name (your "is the user prompted to name it?" note).** Yes.
1. He builds or opens a report; it runs live as he edits (nothing is saved yet — an **"Unsaved" chip** shows in the header).
2. Clicking **Save** opens a small dialog that **requires a name** (pre-filled with a sensible default like "Pipeline by Stage — Aug 2026," which he can accept or change) and optionally a folder. He can't save a nameless report.
3. After the first save, **Save** updates in place silently; **Save as** clones it under a new name.

**Edit.** Open any saved report → the builder loads its config → change fields/filters/chart → **Save** (or **Save as** to branch). Same builder for every report kind — templates are just pre-filled configs (Journey 5.9b).

**Delete.** From the reports list or the open report's ⋮ menu → **Delete** → confirm. A report on one or more dashboards warns "Used on 2 dashboards — deleting removes it there too." Deleting a report is undoable via the 30-day trash pattern (doc 5a), because a report config is cheap to keep.

**Share — every report is workspace-viewable by link (your call: promote ease of access).** We deliberately keep this **open, not gated by an access list.** The model:
1. **View = anyone in the workspace with the link.** Every saved report and dashboard has a stable in-app URL, and **any workspace member who has that link can open and view it** — no per-report grant, no "request access" wall. This is the ease-of-access you asked for: paste a report link into Slack or a doc and a teammate just sees it.
2. **Edit stays scoped.** By default only the **owner** can edit a report (change its config, rename, delete). The owner can add **specific editors** if they want co-owners. So sharing is frictionless for reading and controlled for changing.
3. **The one safety rail — row-level visibility on the underlying records.** The report *definition* and its aggregate view are open, but any **drill-through to individual records** (Journey 5.9) still shows only the records that viewer is allowed to see (doc 11). So open viewing promotes access to the *numbers and charts* without ever exposing a specific record a viewer couldn't otherwise open. (If an org ever needs stricter aggregate secrecy, that's a future per-report "restricted" flag — not the default.)
4. **Anonymous/public links** (outside the workspace) are still **not** in v1 — those are a separate feature with a security review. "Anyone with the link" means anyone *in the workspace*.

- **Benchmark (beat this):** Notion — "anyone in the workspace can view by link" sharing (the low-friction model we copy) — https://www.notion.so/help/sharing-and-permissions ; Attio — reports & dashboards — https://attio.com/help/reference/managing-your-data/dashboard-and-reports
- **Build docs:** internal — `Report.ownerId` + an optional `editors[]`; **no view-ACL needed** (view is workspace-scoped by link); drill-through defers to row-level visibility (doc 11).

## Journey 5.8a — Activity report (metrics × time grid)

*As a manager, I want a grid of key metrics by week, so that I can see activity and pipeline motion at a glance.*

**A grid of METRICS × TIME** — rows are metrics, columns are periods (weeks by default):

| | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Emails | | | | |
| Calls | | | | |
| Connected calls *(dispositions in a chosen set)* | | | | |
| Opportunities | | | | |
| Qualified opps *(moved **into** the stage this period)* | | | | |
| Closed-Won opps *(moved **into** the stage this period)* | | | | |

- **Two cell types, made explicit per row:** **event counts** (Emails, Calls — count rows whose timestamp is in the bucket) vs **stage-entry counts** (Qualified, Closed-Won — count opps whose **stage-change history** shows a transition *into* that stage in the bucket). Stage-entry needs the stage-change log (`StageChange`), not the opp's current stage.
- **How he builds it:** pick the date field for columns, a grain (week), a window (last 8 weeks), and check metrics from a predefined list. "Connected calls" and "Qualified" expose a small filter (disposition set / target stage). An optional **Total** column + a trend sparkline on the right.
- **Conversion rows:** between any two metric rows he can add a **conversion %** row (calls→connects, opps→won) — this is the same "% of another row" transform as the pivot (Journey 5.9).

- **Benchmark (beat this):** Attio — reports (stage-changed / current-state reports) — https://attio.com/help/reference/managing-your-data/dashboard-and-reports/reports
- **Build docs:** Apache ECharts (grid + sparkline) — https://echarts.apache.org/

## Journey 5.8b — Pipeline transition waterfall (and the snapshot pipeline)

*As a manager, I want a bridge from starting to ending pipeline over a period, so that I can see exactly what created, grew, slipped, or was lost.*

A **waterfall** (modeled on Clari's Waterfall) bridging **Starting pipeline** to **Ending pipeline** between two dates:

`Starting → + Created → + Expanded → − Slipped/Pushed → − Lost → = Ending`

Green bars add (new/grown deals), red bars subtract (value pulled out of the window, deals lost or pushed to a later close date); each segment **drills through** to its deals (Journey 5.9 drill-through). He saves it to a dashboard and pins it.

**The nightly point-in-time snapshot — algorithm, data flow, infrastructure, and the trade-off (your ask).**

*Why it exists.* A waterfall (and cohort, and forecast-accuracy) needs to compare the pipeline **as it was on date A** to **as it was on date B**. The live `Deal` table only knows *now* — once a deal moves from $10k to $50k, yesterday's $10k is gone. So we must **freeze a copy of every open deal each day**.

*The algorithm (job F4-snapshot).*
1. **Trigger:** nightly cron at ~2am in the **workspace timezone** (so "as of" dates line up with the user's calendar).
2. **Steps:** for each workspace, select every **open** deal and append one `PipelineSnapshot` row capturing `(dealId, stageId, amount, closeDate, snapshotAt=today)`. It is **append-only** — we never update or delete a snapshot; each night adds one row per open deal.
3. To render a waterfall for [A, B]: load the snapshot set at A and at B, **left-join by dealId**, and classify each deal — present at B but not A = **Created**; amount up = **Expanded**; amount down / closeDate pushed past the window = **Slipped**; stage = Lost = **Lost**; sum each bucket. This is a diff, computed at query time from two cheap snapshot reads.

*Infrastructure & why this design (the trade-off I chose).* The snapshot job runs on the **same pg-boss worker** (doc 12) as every other background job — no new infra. Snapshots live in **Postgres** (`PipelineSnapshot`), indexed by `(workspaceId, snapshotAt)`.
- **Options I weighed:** (a) **pure query-time** — reconstruct history from the `StageChange`/audit log on every report load; (b) **nightly snapshots** (chosen); (c) an external OLAP/warehouse (Snowflake/ClickHouse).
- **Why nightly snapshots:** (a) is correct but **slow and complex** — reconstructing "amount as of date X" from an event log on every page load is expensive and easy to get wrong. (c) is overkill for a solo build and adds a second datastore to operate. Nightly snapshots are **O(open deals × days)** — tiny (a few thousand rows/day), prunable (keep daily for a year, then monthly), and make the waterfall a **two-index-scan diff** instead of a log replay. The cost is **1-day granularity** (you can't diff two times on the same day) and a nightly job — both acceptable for pipeline reporting. This is the **same snapshot** doc 9 reuses for the deal board (weighted-forecast period deltas + the waterfall entry point), so we build it **once**.

- **Benchmark (beat this):** Clari — pipeline waterfall — https://www.clari.com/blog/new-from-clari-next-level-analytics-for-revenue-leaders/
- **Build docs:** Apache ECharts — waterfall via stacked bars — https://echarts.apache.org/en/option.html ; internal — `PipelineSnapshot` + F4.

## Journey 5.9 — Custom pivot builder + advanced metrics

*As a power user, I want to build any table or chart by dragging fields, so that I'm not limited to the shipped templates.*

**Benchmark: the Excel PivotTable wizard.** The builder has **four drop zones — Filters, Columns, Rows, Values** — and a **curated field list** he drags from (CRM dimensions like Owner, Stage, Source; measures like Opp count, Pipeline $). Nesting two fields in Rows gives grouped subtotals.

1. **Drag to build.** He drags fields into the zones; the grid fills live. **Build from scratch** by choosing a **base object** (Activities / Opportunities / Stage-changes / People / Companies / any custom object) → drag dimensions to Rows/Columns → measures to Values → filters → pick number or chart.
2. **"% of total," including a % row beneath *some* number rows and not others (your exact question).** Every Values field has a **"Show values as"** dropdown — **Raw / % of Row / % of Column / % of Grand Total / % of Parent Row** — a display transform (no re-query). To get a **percentage row beneath a specific number row but not others,** drag that **same measure into Values twice**: leave the first copy **Raw** and set the second copy to a **% variant**. The two render as a paired number-row + percent-row, and because you choose *per measure instance*, you can add the percent pairing to some measures and leave others as plain numbers. (Period-over-period % and vs-last-year % are two more "Show values as" options.)
3. **Number ⇄ chart toggle.** A segmented control flips any table to its natural chart (grid → grouped bar/line, waterfall → bridge, cohort → line). The chart type is auto-suggested from the shape (time on an axis → line; one dimension → bar) and **user-overridable** to any supported type — **bar, stacked bar, line, area, pie/donut, funnel, waterfall, scatter, single-value KPI, heatmap** (this is the broader chart set you asked for; ECharts covers all of them).
4. **Drill-through.** Clicking any cell, bar, or segment opens the **underlying records** in a slide-over table (the same fast grid as doc 4), so every number is traceable to its rows. (This is the "drill-anywhere" you want — scoped to the report's base object, not arbitrary cross-object OLAP.)
5. **Sales math, prebuilt as measures:** deal velocity, average days in stage, win rate by segment/source, revenue forecast (weighted by stage probability) — pick them from the measures list like any field.
6. He saves the view as a report (Journey 5.8) and can place it on a dashboard (5.9c).

- **Benchmark (beat this):** Excel — "Show Values As" (% of total) — https://support.microsoft.com/en-us/office/show-different-calculations-in-pivottable-value-fields-014d2777-baaf-480b-a32b-98431f48bfec ; Attio — reports — https://attio.com/help/reference/managing-your-data/dashboard-and-reports/reports
- **Build docs:** Apache ECharts — https://echarts.apache.org/ ; the pivot grid reuses the doc-4 fast grid (Glide) or AG Grid Community (MIT); aggregation is server-side.

## Journey 5.9a — Cohort / decay report

*As a manager, I want to group records by when a start event happened and track what % reach a target status over time, so that I can see conversion and decay, not just totals.*

**Group records by when a start event happened, then track what % reach a target status over time.** Example: of opportunities **created** in a given month, what % are **Closed-Won** at month t+1, t+2, t+3 → a decay/rise curve per cohort on a shared "months since start" x-axis.

**Building it — the four choices (your "we need to pick object type, the change field, the start status, the end status" note).** The cohort builder asks for exactly four inputs, in this order:
1. **Object type** — which object the cohort is over (Opportunities, People, custom object).
2. **The change field** — *which* status/stage field measures the movement (e.g. Deal `Stage`, or a custom `Lifecycle` field). This is the field whose transitions we read from the `StageChange` log, so the report works for **any** status field, not just deal stage.
3. **Start status** — the transition that **enters** the cohort and starts its clock (e.g. entered "Created," or entered "Stage X"). The cohort's grain (month/week) buckets records by when this happened.
4. **End status** — the **target** transition we measure reaching (e.g. entered "Closed-Won," or entered "Stage Y"). Each cell = % of the cohort that has reached the end status by t+n.

Plus a **max horizon** (t+3) and a **normalization base** (cohort size = 100%).

- **Table view** = a cohort triangle (rows = cohorts, columns = t+0…t+n, cells = %). **Chart view** = decay/rise lines (the number↔chart toggle from 5.9).
- Because it reads the `StageChange` log for a **chosen** field, it generalizes to any status field on any object — not hardcoded to pipeline.

- **Benchmark (beat this):** Metabase — funnel / cohort analysis — https://www.metabase.com/learn/grow-your-data-skills/business-analysis-methods/how-to-do-funnel-analysis
- **Build docs:** Apache ECharts — line series — https://echarts.apache.org/en/option.html ; internal — `StageChange` log.

## Journey 5.9b — Report templates that ship

*As a rep or manager, I want ready-made reports for the common questions, so that I don't build every report from scratch.*

Each template is a **preset over the engines above** (the metric×period grid 5.8a, the transition waterfall 5.8b, the pivot 5.9, or the cohort 5.9a). He opens one from the Templates gallery (Journey 5.8), sets the date grain, and it renders; he can then tweak it like any pivot and **Save as** his own.

1. **Sales-acquisition pipeline over time** — a metric×week grid: calls, emails, connects, opps created, opps qualified, opps closed-won, opps activated, with conversion rates between rows. *(Engine: 5.8a.)*
2. **Stage-movement report** — starting count → moved down a stage / moved up a stage (each expandable by which stage) → ending count, per week. *(Engine: 5.8b + `StageChange`.)*
3. **Cohortized close** — of opps created in stage X, % progressed to stage Y within t+1/t+2/t+3. *(Engine: 5.9a.)*
4. **Rep rankings** — a leaderboard of reps across weeks on a chosen metric. *(Needs multi-user; [LATER, doc 11].)*
5. **Segment report** — closed-won (or any metric) by account type/segment across weeks. *(Engine: 5.9 pivot grouped by segment.)*
6. **Forecast** — category-weighted expected value per quarter: Closed-Won + Qualified×p + Unqualified×p×(time-left factor) — the raw-vs-adjusted view. *(Engine: the forecast; operational version in [doc 9.7](9-deal-board-and-forecasting.md), reporting-page version here.)*
7. **Headcount** — starting reps → inactive → churned → new → ending, per quarter. *(Needs multi-user; [LATER, doc 11].)*

*These are presets, not new engines. A user's own saved pivots become new templates for their workspace.*

- **Benchmark (beat this):** Salesforce/HubSpot standard report library ; Clari waterfall (5.8b)
- **Build docs:** internal — each template is a seeded `Report` config.

## Journey 5.9c — Dashboards: assemble, title, annotate, arrange, refresh

*As a manager, I want to pin several reports onto one titled board with explanatory text, so that a stakeholder can read the story, not just the charts.*

**This is the new dashboard capability you asked for.** Attio's dashboards let you name a board and drag-arrange report tiles, but they **do not** support text/notes blocks and expose **no explicit refresh** — so we beat Attio on exactly those two.

**Entry point.** Navbar **Dashboards** → a list of the user's + shared dashboards → **+ New dashboard**, or from any open report click **Add to dashboard**.

1. **Create + title.** New dashboard opens blank with an editable **title** and an optional **description** line under it.
2. **Add report tiles.** Click **Add report** → pick a saved report (or build one inline) → it drops as a tile. A tile shows the report's chart/table live.
3. **Add text/content blocks (beats Attio).** Click **Add text** → a rich-text block (TipTap, same editor as notes) for headings, commentary, and interpretation — "Q3 summary: pipeline up 18%, driven by the enterprise segment." Text blocks and report tiles share one grid, so you can caption a chart, section the board, or write an exec summary above the numbers.
4. **Arrange.** Every tile and text block is **drag-to-move and drag-to-resize** on a snap grid; the layout saves per dashboard (`ReportWidget.layoutJson`).
5. **Refresh (beats Attio).** Tiles read precomputed rollups (F4) and show a **"as of HH:MM"** stamp. A **Refresh** button (whole board, or per tile) forces a recompute and restamps — so a user in a live review can pull the latest without reloading the app.
6. **Share.** Same open model as reports (Journey 5.8): **anyone in the workspace with the link can view** the dashboard; **edit** stays with the owner (+ any editors they add). Row-level visibility still applies to each tile's underlying records on drill-through.

- **Benchmark (beat this):** Attio — dashboards (named, drag-resize tiles, share permissions — we add text blocks + refresh) — https://attio.com/help/reference/managing-your-data/dashboard-and-reports/dashboards ; Notion (text + embed blocks on one canvas) for the annotate-the-numbers pattern
- **Build docs:** internal — `Dashboard` + `ReportWidget` (tiles and text blocks share the grid); TipTap for text blocks.

## Journey 5.9d — User profile pages and profile dashboards

*As anyone in the workspace, I want to open a teammate's profile to see who they are and their shared stats, so that I know the team and can find a rep's numbers.*

**This is greenfield — Attio has no member profiles at all** (its only member view is an admin sync-status panel). So the benchmark is **outside** Attio: **Lattice** (people profile: name, title, manager, reporting line), **Linear** (member profile with avatar/role/assigned work), and **Notion** person pages (a personal dashboard on a profile).

**Entry point.** Click any user's name or avatar anywhere in the app (on a record's Owner, in the audit log, in the team list) → their **profile page**. Also reachable from a **Team** directory (doc 11).

1. **Default profile header (visible to everyone in the workspace).** Shows **name, title, email, phone, manager, team, and time zone** — pulled from the user's account (doc 1) and the org structure (doc 11). The person themselves can edit their own title/photo/about; an admin can edit anyone's.
2. **"About me" content.** A rich-text section the user maintains (TipTap) — a short bio, focus areas, how to reach them — readable by anyone in the workspace.
3. **A personal dashboard on the profile.** The user can **save a dashboard to their profile** (Journey 5.9c → "Pin to my profile"), so their **shareable** stats live on their page — e.g. "my closed-won this quarter," "my activity trend." Only reports the viewer is allowed to see render (row-level visibility), so a profile dashboard never leaks another rep's private numbers.
4. **Privacy line.** The default header fields are workspace-visible by design (this is an internal directory, not a public page). Anything beyond the defaults is opt-in content the user or admin chooses to show. No profile is visible outside the workspace.

- **Benchmark (beat this):** Lattice — employee profiles / org chart — https://lattice.com/product/hris ; Linear — member profiles ; Notion — person pages (personal dashboard pattern)
- **Build docs:** internal — `UserProfile` extends `User` (doc 1) + reuses `Dashboard` (5.9c).

## Journey 5.9e — Computed fields and the formula engine (no custom language)

*As an admin, I want to define a computed field with a formula, so that reports and tables can show derived numbers (margin, days-open, weighted value) without me exporting to a spreadsheet.*

**You were right: we don't need a bespoke formula language — we use a proven library.** A "computed field" is a field whose value is a **formula over other fields**, evaluated when the record changes or at query time.

**Entry point.** **Settings → Computed fields → + New**, or, on any object, add a field of type **Formula**.

1. He names the field, picks the object it belongs to, and writes a formula in a **spreadsheet-familiar syntax** — `=(Amount - Cost) / Amount`, `=IF(Stage="Won", Amount, 0)`, `=DAYS(Now(), CreatedAt)` — referencing other fields by name. An autocomplete lists the object's fields and the available functions.
2. A **live preview** evaluates the formula against a sample record and flags errors (bad reference, type mismatch) before save.
3. The computed field then behaves like any field: it shows in tables, is a **measure/dimension in the pivot** (Journey 5.9), and recomputes when its inputs change.

**Library choice — `@formulajs/formulajs` (your call, and I agree it's the right permissive pick).** We use a **spreadsheet-formula library, not raw JavaScript** — business users know `SUM`/`IF`/`VLOOKUP`, and a formula library is **safe by construction** (no arbitrary code execution, unlike `eval`). We pick **[@formulajs/formulajs](https://github.com/formulajs/formulajs)** (MIT-licensed, ~400 Excel-compatible functions as plain JS) with a small **[jsep](https://github.com/EricSmekens/jsep)** parser to turn the user's formula string into an AST we evaluate against the record's fields. We considered HyperFormula (richer — a built-in dependency graph and auto-recalc) but its **GPLv3-or-commercial** license is a poor fit for a closed-source product, and we don't need its spreadsheet-cell model; formulajs + jsep gives us the same familiar function vocabulary with a clean MIT license. We do **not** expose raw JS; if we ever must, it goes in an **isolated-vm** sandbox, never `eval`/`vm2`.

**Recalculation (what jsep doesn't give us that we build).** Because formulajs is just functions (no dependency graph like HyperFormula), we recompute a formula field when any field it references changes: at save we parse the formula, record which fields it reads, and recompute on write of those inputs (through the doc-4 E1 write path) or at query time for report-only formulas. This keeps recalculation correct without a spreadsheet engine.

- **Benchmark (beat this):** Airtable — formula fields — https://support.airtable.com/docs/formula-field-reference ; Notion — formulas 2.0
- **Build docs:** **@formulajs/formulajs** (MIT — the pick) — https://github.com/formulajs/formulajs ; **jsep** (expression parser) — https://github.com/EricSmekens/jsep

## Journey 5.9f — Scheduled report delivery (subscriptions)

*As a manager, I want a report or dashboard emailed to me (or a Slack channel) on a schedule, so that I don't have to remember to open it.*

**This is one of the features my old doc cut and you want back.** A saved report or dashboard can be **subscribed to**:
1. **Entry point:** an open report/dashboard → **Subscribe / Schedule**.
2. He picks a **cadence** (daily / weekly on a chosen day / monthly), a **time** (in the workspace timezone), a **format** (inline summary + a link, or a CSV/PDF attachment), and **recipients** (himself, specific teammates, or a Slack channel via the doc-7b Slack connection).
3. **Sending is explicit to set up but then automatic** — consistent with the "sending is a deliberate action" rule (doc 5): the user opts in once; each run then fires without a click. He can pause/unsubscribe anytime.

- **Background job — `report-deliver`.** **Trigger:** pg-boss cron per subscription cadence. **Steps:** recompute the report (or read the fresh F4 rollup) → render summary + attachment → send via the email send path (doc 5) or Slack webhook → log delivery. **pg-boss:** `report-deliver` queue, `retryLimit: 3`, idempotent per (subscriptionId, runDate) so a retry never double-sends.
- **Benchmark (beat this):** Metabase — dashboard subscriptions — https://www.metabase.com/docs/latest/dashboards/subscriptions ; Salesforce — subscribe to reports — https://help.salesforce.com/s/articleView?id=sf.reports_subscribe.htm&type=5
- **Build docs:** internal — `ReportSubscription` + the doc-5 email send + doc-7b Slack.

---

## Background jobs (this doc)

- **F4 — Report precompute + pipeline snapshots.** **Trigger:** nightly cron (workspace timezone) + on-demand refresh (Journey 5.9c). **Steps:** (1) append one `PipelineSnapshot` per open deal (5.8b); (2) roll up daily activity/stage-entry counts into rollup tables for fast dashboards; (3) restamp "as of." **pg-boss:** `report-precompute` queue, daily cron + manual trigger, `retryLimit: 3`, idempotent per (workspaceId, day).
- **`report-deliver`** — scheduled report/dashboard delivery (Journey 5.9f).

**Monitoring.** These run on the shared pg-boss runner (doc 12): queue depth, failure rate, and dead-letter count per queue go to Axiom with the standard "failed jobs > N in 10 min" alert. Report-specific health: snapshot row-count per night vs expected open-deal count (a drop means the snapshot job missed a workspace); `report-deliver` failures surface to the subscription owner, not silently dropped.

## Technology choices (this doc)

Builds on the prior stack (React + Vite SPA + TS API, Postgres+Prisma, TipTap, pg-boss).

- **Reporting engine — precompute + query-time hybrid.** *Options:* live SQL on every load vs materialized rollups. **Pick: hybrid** — scheduled snapshots + rollups (F4) for stage history, transitions, velocity, and forecast; query-time for ad-hoc filters and drill-through. This requires the **nightly point-in-time pipeline snapshots** (Journey 5.8b) and the **stage-change history log** (`StageChange`, for stage-entry metrics and the cohort report).
- **Charting — Apache ECharts (Apache-2.0) primary, Recharts (MIT) for simple charts.** **Pick: ECharts** for the waterfall, cohort/decay, funnel, heatmap (native stacked-bar risers, big-dataset canvas perf) and **Recharts** for simple grid/line/bar. The pivot grid reuses the doc-4 fast grid (Glide) or AG Grid Community (MIT); aggregation is server-side.
- **Formula engine — a library, never a custom language or raw eval** (Journey 5.9e). **Pick: `@formulajs/formulajs` (MIT) behind a `jsep` parser** — ~400 Excel-compatible functions with a permissive license; we build lightweight dependency tracking (parse → record referenced fields → recompute on input change) since formulajs has no built-in recalc graph. We rejected HyperFormula on its **GPLv3-or-commercial** license. Raw/user JavaScript is out; if ever needed, sandbox with **isolated-vm** (not `eval`, not the deprecated `vm2`).
- **"The BI line — revised."** We **DO** build: templated reports, a 4-zone drag pivot, `% of total` transforms, number↔chart with a broad chart set, drill-through, dashboards with text blocks + refresh, scheduled delivery, and computed formula fields. We **DO NOT** build: **a bespoke formula/query language** (use a library) or a full **arbitrary-SQL, cross-source, drill-anywhere OLAP warehouse** — when someone truly needs raw SQL or cross-source joins, that's the export-to-BI / developer-platform SQL path (doc 8). Users **compose** over a curated, pre-modeled field list plus their own formula fields.

## Data model (Prisma) — additions in this doc

```prisma
model Report {                // NEW — a saved report (Journeys 5.8–5.9b)
  id          String  @id @default(cuid())
  workspaceId String
  name        String           // required at save (Journey 5.8)
  kind        String  // activity | transition | pivot | cohort
  configJson  Json    // base object, rows, columns, values, calc (raw/%-of-total), chart type, cohort settings
  ownerId     String
  editors     String[]         // extra userIds allowed to edit; VIEW is open to the whole workspace by link (Journey 5.8)
  folder      String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Dashboard {             // NEW — Journey 5.9c
  id          String  @id @default(cuid())
  workspaceId String
  title       String
  description String?
  ownerId     String
  editors     String[]         // extra editors; VIEW is open to the whole workspace by link (Journey 5.9c)
  pinnedToProfileUserId String?  // set when saved to a user's profile (5.9d)
  createdAt   DateTime @default(now())
}

model ReportWidget {          // NEW — a tile OR a text block on a dashboard (5.9c)
  id          String  @id @default(cuid())
  workspaceId String
  dashboardId String
  kind        String  // report | text
  reportId    String?         // set when kind=report
  textJson    Json?           // TipTap, when kind=text
  layoutJson  Json            // x/y/w/h on the snap grid
}

model PipelineSnapshot {       // NEW — nightly point-in-time pipeline (5.8b / F4)
  id          String   @id @default(cuid())
  workspaceId String
  dealId      String
  stageId     String
  amount      Float?
  closeDate   DateTime?
  snapshotAt  DateTime          // the "as of" date (doc 9 reuses this snapshot for weighted-forecast deltas + waterfall)
  @@index([workspaceId, snapshotAt])
}

model StageChange {            // NEW — stage-entry log (5.8a metrics + 5.9a cohort)
  id          String   @id @default(cuid())
  workspaceId String
  objectType  String   // deal | person | custom — cohort works on any status field
  recordId    String
  fieldKey    String   // WHICH status/stage field changed (5.9a "change field")
  fromValue   String?
  toValue     String
  changedAt   DateTime @default(now())
  @@index([workspaceId, objectType, fieldKey, toValue, changedAt])
}

model ComputedField {         // NEW — Journey 5.9e (formula field)
  id          String  @id @default(cuid())
  workspaceId String
  objectType  String
  name        String
  formula     String           // spreadsheet syntax, evaluated by the formula library
  createdAt   DateTime @default(now())
}

model ReportSubscription {    // NEW — Journey 5.9f (scheduled delivery)
  id          String  @id @default(cuid())
  workspaceId String
  reportId    String?          // report OR dashboard
  dashboardId String?
  cadence     String           // daily | weekly:MON | monthly:1
  atLocal     String           // "07:00" in workspace tz
  format      String           // summary | csv | pdf
  recipients  Json             // userIds / emails / slackChannel
  ownerId     String
  paused      Boolean @default(false)
}

model UserProfile {           // NEW — Journey 5.9d (extends User, doc 1)
  id          String  @id @default(cuid())
  workspaceId String
  userId      String  @unique
  title       String?
  aboutJson   Json?            // TipTap "about me"
  photoUrl    String?
  // name/email/phone/manager/team read from User + org structure (doc 11)
}
```

## Decisions for you (reporting)

**1. Formula library — DECIDED: `@formulajs/formulajs` (MIT) + `jsep`.** You chose formulajs. Permissive license, familiar Excel functions; we build the lightweight recalc tracking ourselves (Journey 5.9e). HyperFormula was rejected on its GPLv3-or-commercial license.

**2. Report visibility — DECIDED: workspace-wide view by link (ease of access).** You chose to promote easy access: **any workspace member with a report/dashboard link can view it** (Journey 5.8). Edit stays with the owner (+ explicit editors). Row-level record visibility still governs the underlying data on drill-through, so open viewing never leaks a record a viewer couldn't otherwise see. **Anonymous public (outside-the-workspace) links** remain a separate later feature with its own security review.
