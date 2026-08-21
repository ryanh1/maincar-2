# SPEC — Reporting Engine, Dashboards & Call Analytics

*This doc owns **everything reporting** for maincar-2: the Reports home and report
lifecycle, the drag-to-build pivot, the shipped report templates, the activity
metrics×time grid, drill-through to row-level records, the pipeline transition
waterfall, the cohort/decay report, dashboards, member profiles, computed/formula
fields, scheduled delivery, and **call/dialer analytics**. It is a composable BI
tool built over the CRM data layer — not a second warehouse.*

**Status:** spec / not started. **Schema is WIP** — see [§3 The schema contract](#3-the-schema-contract), which is the load-bearing section: it declares what reporting reads from the planned CRM schema, and flags every need that today's plan does **not** satisfy.

---

## 1. Lineage — where these requirements came from

The requirements were captured from the **maincar** predecessor project's journey docs (they were not in loadwire):

- **`maincar/docs/journeys/5b-reporting-and-dashboards.md`** — the reporting engine, pivot builder, templates, waterfall, cohort, dashboards, profiles, formula fields, scheduled delivery.
- **`maincar/docs/journeys/3b-dialer-analytics.md`** — aggregate call analytics (connect-rate by number/area/time-of-day), stated explicitly as *a subset of the main reporting, in the same place, on the same tools*.
- **`maincar/docs/journeys/6-call-intelligence.md` §6.5** — per-call conversation analytics (talk-ratio, monologue, interactivity, questions, competitor mentions).

Where those docs used maincar-v1 names (`workspaceId`, `Deal.amount`), this spec uses the **maincar-2 planned-schema names** (`orgId`, `Deal.amountMinor` + `currency`, `PipelineStage.winProbability`, `ActivityEntry`, `FieldHistory`). See [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md).

It reuses two things this repo already specs:
- **Drill-through target** = the fast grid + stacked peek drawer in [SPEC-CRM-GRID-AND-RECORD-VIEW.md](SPEC-CRM-GRID-AND-RECORD-VIEW.md) (`Company › Person › Deal › Call` drill without losing place).
- **Base objects + field lists** = the schema-as-data layer (`ObjectDef` / `AttributeDef`) from [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md), so the pivot's field picker works for standard **and** custom objects with no per-report code.

---

## 2. The BI line — what we build and what we don't

We **DO** build: a Reports home with templates + saved/shared reports, a 4-zone drag pivot, `% of total` display transforms, number↔chart with a broad chart set, **double-click drill-through** to the underlying rows, an activity metrics×time grid, call/dialer analytics, a pipeline waterfall, cohort/decay, dashboards with text blocks + refresh, computed formula fields, and scheduled delivery.

We **DO NOT** build: a **bespoke formula/query language** (we use a proven library, [§R10](#r10-computed--formula-fields-later)) or a full **arbitrary-SQL, cross-source, drill-anywhere OLAP warehouse**. Users **compose** over a curated, pre-modeled field list (the object's `AttributeDef`s) plus their own formula fields. Raw SQL / cross-source joins are a later developer-platform export path, not this engine.

**Benchmarks (beat these):** Attio (dashboards + report types), Clari (pipeline waterfall), Salesforce/HubSpot (standard report library), Excel PivotTable (the pivot builder + "Show Values As"), Metabase (cohort/funnel + scheduled subscriptions), Nooks (dialer connect-rate heatmap), Gong (per-call conversation analytics), Lattice/Linear/Notion (member profiles).

---

## 3. The schema contract

**This is what the user asked to see: reporting's data needs measured against the planned 26-model CRM schema, with the non-matches called out.** The CRM Data Schema project ([Linear](https://linear.app/maincar2/project/crm-data-schema-a370cba8a646)) explicitly lists reporting as **out of scope** — so reporting is a separate spec that must declare its own dependencies. Three buckets:

### 3A. Already provided — reporting reads these as-is

| Reporting need | Planned-schema source | Notes |
|---|---|---|
| Count activity events by period (calls, emails, SMS, meetings, notes) | **`ActivityEntry`** (`sourceType`, `occurredAt`, `orgId`, `companyId`/`dealId`/`personId`) | Denormalized feed; already indexed `(orgId, dealId, occurredAt)` etc. The activity report ([§R4](#r4-activity-metricstime-grid-v1)) counts these rows. |
| Group/aggregate deals (pipeline $, count, by owner/stage/segment) | **`Deal`** (`stageId`, `pipelineId`, `amountMinor`+`currency`, `closeDate`, `status`, `ownerUserId`, `companyId`, `customJson`) | Indexed on `stageId`, `ownerUserId`, `closeDate`. Powers pivots, segment reports, forecast. |
| Weighted forecast | **`PipelineStage.winProbability`** (0–100) + `.outcome` (open/won/lost) | Forecast measure = Σ `amountMinor × winProbability`. |
| Pivot field list per object (standard + custom) | **`ObjectDef` / `AttributeDef`** | The pivot's curated dimension/measure list = the object's `AttributeDef` rows. No hardcoding. |
| Drill-through to row-level records | **`ActivityEntry.sourceId`** + the grid/peek in [SPEC-CRM-GRID-AND-RECORD-VIEW.md](SPEC-CRM-GRID-AND-RECORD-VIEW.md) | Every cell traces back to its rows. |
| Row-level visibility on drill-through | `orgId` tenancy everywhere | Aggregates open by link; individual records still obey record visibility. |
| Connect-rate-by-number / area / time-of-day (basic) | **`Call`** (`direction`, `status`, `fromE164`, `startedAt`, `durationS`, `userId`) + **`PhoneNumber`** | Connect signal ≈ `status="completed"`; number = `fromE164`; area = derived; hour = `startedAt` in org tz. See mismatch **3B-4**. |

### 3B. Mismatches — needs the planned schema does NOT satisfy today

> These are the deltas to raise against the CRM Data Schema project (or to own inside this reporting spec). Ranked by impact.

**3B-1 — `FieldHistory` is indexed for "one record's history," not for stage-entry/cohort queries.** *(Blocks: [§R4](#r4-activity-metricstime-grid-v1) stage-entry rows, [§R7](#r7-cohortdecay-report-later) cohort.)*
`FieldHistory` **does** log stage changes (a change to `Deal.stageId` writes a row with `oldJson`/`newJson`), so the *data* exists. But its only index is `@@index([orgId, objectSlug, recordId, changedAt])` — tuned for "show this deal's history." Reporting asks the **inverse**: *"every deal that entered stage X between date A and B"* — a scan by `(orgId, objectSlug, attribute, newJson, changedAt)` across all records. **Fix:** add `@@index([orgId, objectSlug, attribute, changedAt])` to `FieldHistory` (a `newJson`-value predicate then filters the narrowed range). **Alternative:** a purpose-built `StageChange` projection table — heavier; `FieldHistory` already holds the truth, so prefer the index. Confirm `Deal.stageId` transitions actually write `FieldHistory` (spec §5.7 says field changes do; verify the write path covers `stageId`).

**3B-2 — No point-in-time pipeline snapshot.** *(Blocks: [§R6](#r6-pipeline-transition-waterfall-later) waterfall, forecast-accuracy, period-over-period deltas.)*
The live `Deal` table only knows *now* — once a deal moves $10k→$50k, yesterday's $10k is gone. The waterfall/cohort/forecast-accuracy reports must compare pipeline **as of date A** vs **as of date B**. **Fix (reporting-owned):** add a nightly append-only **`PipelineSnapshot`** ([§8](#8-data-model-prisma--reporting-owned)) freezing every open deal's `(stageId, amountMinor, closeDate)` per day. Net-new infra: one nightly job + one table. This is the single largest data dependency.

**3B-3 — `Call` has a technical outcome, not a business disposition, and there is no disposition CRUD at all.** *(Blocks: the maincar "Connected calls = dispositions in a chosen set" metric, best-time-to-call, meaningful connect-rate — and rep call logging generally.)*
`Call.status` is the Twilio lifecycle (`completed | busy | failed | no-answer | …`) — fine for a crude "connected = completed," but it can't express **rep-logged outcomes** (conversation / voicemail / gatekeeper / not-interested / callback). The activity report's *Connected calls* row and the dialer *best window* both assume a **disposition** with a configurable "counts as connected" set. Today there is **no disposition concept and no way to manage one**.

**What's actually needed (confirmed with Ryan):**
- **A `DispositionDef` model with full CRUD** — some **seeded defaults** shipped on org create, plus **user-supplied** ones. Managed in Settings.
- Each disposition carries a **`value`** (stable machine key) **and a `label`** (display text) — value ≠ label, so renaming the label never breaks history or filters.
- A **`color`**, an optional **`icon`**, and an optional **`category`** (e.g. `connected` vs `not_connected`, maybe more) — the category is what "counts as connected" reads, so connect-rate is defined once, not per-report.
- **Call notes logged to the call** — a rep's free-text note captured with the disposition. Reporting doesn't aggregate the text, but the call record and drill-through show it.

**The dial-vs-call distinction (an important modeling note, not a table split).** A single `Call` row holds two *provenances* of data:
- **Dial facts — from the dialer/Twilio:** `direction`, `status`, `durationS`, `fromE164`, `startedAt`. Always present. A dial may have **no disposition and no notes** (rep hung up, auto-dialed, abandoned).
- **Call facts — from the rep:** `dispositionId`, note text. Present only when the rep logs the call.

**We do NOT split this into two tables** — one `Call` row is the dial *and* its logged outcome. But the split in *provenance* matters: (a) reporting must count **every dial** even when undispositioned (an undispositioned dial is still a dial, and "% dispositioned" is itself a coaching metric); (b) the trust/`Provenance` layer already distinguishes system vs user writes, which lines up with dial-facts (`system`) vs call-facts (`user`).

**Fix:** add `DispositionDef` (CRUD, seeded + custom, value/label/color/icon/category) and `Call.dispositionId` + call-note text ([§8](#8-data-model-prisma--reporting-owned)). Connect-rate/"connected calls" read the disposition **category**; v1 may still fall back to `status="completed"` until dispositions land. This is the **dialer/call spec's** field to own — reporting only consumes it.

**3B-4 — No `numberId` FK from `Call` to `PhoneNumber`.** *(Affects: [§R5](#r5-calldialer-analytics-slices-v1) connect-rate-by-number joining spam-status/daily-cap columns.)*
Connect-rate-by-number can group by the `fromE164` **string** today, but the "spam status / daily cap" columns in the maincar table come from `PhoneNumber`. Matching `Call.fromE164` → `PhoneNumber.e164` works but is a string join. **Fix (small):** add `Call.numberId String?` referencing `PhoneNumber`, set at dial time. Low priority; string join is a workable v1.

**3B-5 — No per-call conversation metrics (talk-ratio, monologue, interactivity).** *(Blocks: only aggregate talk-ratio/coaching reports — NOT v1.)*
These come from a diarized transcript (maincar doc 6 / job G1) and are **not** in the planned schema or the current `Call` model (`transcript` is a plain string, no diarization). Reporting only needs them if we want *aggregate* conversation-quality reports. **Fix:** none for v1 — declare **`CallMetrics`** as an **upstream dependency** owned by a future call-intelligence spec; reporting consumes it if/when it exists.

**3B-6 — Tenancy/naming drift to correct on intake.** The maincar journeys say `workspaceId`; maincar-2 is `orgId`. Money is `amountMinor` (BigInt minor units) + `currency`, not a float `amount`. All reporting models and queries in this spec use the maincar-2 names.

### 3C. Net-new, reporting-owned tables (additive, no conflict)

`Report`, `Dashboard`, `ReportWidget`, `ComputedField`, `ReportSubscription`, `UserProfile`, `PipelineSnapshot`, `AnalyticsRollup`, `ReportRollup`. Full Prisma in [§8](#8-data-model-prisma--reporting-owned). None of these touch the CRM spine; they reference it by id.

---

## 4. Scope & capability map (capture-all, phased)

Everything is captured so nothing is lost, but the build is phased. Modules, dependency direction (`←` = "depends on"), and build order:

```
                 R0 reporting engine core (query/aggregate service + orgId scoping)
                   ↑            ↑            ↑             ↑
   ── v1 core ──   R1 home   R2 pivot    R4 activity   R5 call/dialer
                   ↑          + drill      grid          analytics
                   R3 templates (presets over R2/R4/R5)
                   ─────────────────────────────────────────────
   ── differentiators ── R12 My Pipeline ← R8 (or lite) · R14 sheets sync ← R0
   ── deferred ──  R13 mobile (much later; not a v1 DoD)
   ── later ──     R6 waterfall ← PipelineSnapshot (3B-2)
                   R7 cohort/decay ← FieldHistory index (3B-1)
                   R8 dashboards ← R1/R2
                   R9 profiles ← R8
                   R10 computed/formula fields ← R0
                   R11 scheduled delivery ← R1/R8 + email/Slack seams
```

| Phase | Modules | Gate to start |
|---|---|---|
| **v1 core** | R0, R1, R2, R3, R4, R5 | CRM spine + `ActivityEntry` + `Call` exist (they do). R5 wants disposition (3B-3) or accepts `status=completed`. Desktop web only. |
| **Differentiators** | R12 My Pipeline, R14 sheets sync | R12 rides R8 or a lite single-page version; slot near-term for rep love. |
| **Later** | R6, R7 | R6 needs `PipelineSnapshot` (3B-2); R7 needs the `FieldHistory` index (3B-1). |
| **Later** | R8, R9, R10, R11 | R11 needs the email send path + Slack connection seams. |
| **Deferred (much later)** | R13 mobile | Not a v1 requirement; desktop web is the v1 target. |

**Convention.** Every UI journey states its **entry point** first. Every background job states **trigger → steps → pg-boss params**. Any model choice names the model. Every module ships its own tests (unit for aggregation/compile logic; component for UI; a browser journey walk — a route is a string, click it) per [CLAUDE.md](../../CLAUDE.md).

---

## 5. v1 core modules

### R0 — Reporting engine core (the shared service)

*Not a UI. The server-side aggregation service every report renders through.*

- **Input:** a `ReportConfig` (base object, rows, columns, values, filters, calc transform, chart type). **Output:** a tidy result set (dimensions × measures) + a drill-through query for any cell.
- **Aggregation is server-side**, `orgId`-scoped, over a **curated field list** (the base object's `AttributeDef`s + computed fields). No client-side raw SQL.
- **Precompute + query-time hybrid:** query-time for ad-hoc filters and drill-through; precomputed **rollups** (`ReportRollup`, job F4) for the heavy time-series/stage-history paths. A cell drill-through always re-queries live rows so numbers are traceable.
- **Acceptance:** given a config over `Deal`, returns correct grouped sums/counts in one indexed query; an unknown field or cross-org id is rejected; a cell maps to a deterministic row query.

**Build docs:** aggregation in the API layer (Postgres + Prisma); result contract shared with the pivot UI.

### R1 — Reporting home & report lifecycle *(v1)*

*As a rep or manager, I want one place to open, build, save, name, edit, share, and delete reports, so I can measure the business without a BI tool.*

- **Entry point.** Left navbar **Reports** → three areas: **Templates gallery** (default), **Reports list** (sub-tabs *My reports* / *Shared with me*; columns: name, kind, owner, last-edited; row actions Open/Duplicate/Share/Rename/Delete), and **+ New report**.
- **Save requires a name.** Live-runs while editing (an **Unsaved** chip shows); **Save** opens a dialog that requires a name (pre-filled with a sensible default) + optional folder. No nameless saves. **Save as** clones.
- **Share = workspace-viewable by link; edit stays scoped.** Any org member with the link can **view** a saved report; **edit** is owner-only (+ explicit `editors[]`). Drill-through to individual records still obeys record visibility, so open viewing never leaks a record the viewer couldn't otherwise open. **No anonymous/public links in v1.**
- **Delete.** From the list or ⋮ → confirm; a report used on N dashboards warns first; undoable via the 30-day trash pattern.
- **Acceptance:** create → save-with-name → reopen renders identical; a second org member opens by link and views but cannot edit; delete warns when on a dashboard.

**Benchmark:** Notion "anyone in the workspace can view by link"; Attio reports & dashboards. **Build:** `Report.ownerId` + `editors[]`; no view-ACL (view is org-scoped by link).

### R2 — Pivot builder + advanced metrics + drill-through *(v1)*

*As a power user, I want to build any table or chart by dragging fields, so I'm not limited to templates.*

- **Four drop zones — Filters, Columns, Rows, Values** — over a **curated field list** dragged from the base object (`AttributeDef`s). Nesting two Row fields gives grouped subtotals.
- **Build from scratch:** pick a **base object** (People / Companies / Deals / Activities / any custom `ObjectDef`) → drag dimensions to Rows/Columns → measures to Values → filters → pick number or chart.
- **"Show values as"** per measure instance — **Raw / % of Row / % of Column / % of Grand Total / % of Parent Row / period-over-period / vs last year** (display transforms, no re-query). To get a **% row beneath *some* number rows only**, drag the same measure into Values twice: leave one **Raw**, set the other to a **%** variant.
- **Number ⇄ chart toggle.** Segmented control flips a table to its natural chart; type auto-suggested from shape, user-overridable to: **bar, stacked bar, line, area, pie/donut, funnel, waterfall, scatter, single-value KPI, heatmap**.
- **Drill-through (double-click anywhere).** Clicking any cell/bar/segment opens the **underlying records** in a slide-over grid — the same fast grid + stacked peek drawer as [SPEC-CRM-GRID-AND-RECORD-VIEW.md](SPEC-CRM-GRID-AND-RECORD-VIEW.md). Scoped to the report's base object.
- **Prebuilt sales measures:** deal velocity, avg days in stage, win rate by segment/source, weighted forecast (Σ `amountMinor × winProbability`) — picked from the measures list like any field.
- **Acceptance:** a grouped Deal pivot matches a hand-checked SQL sum; a doubled measure renders a paired number+percent row; drill-through on a bar opens exactly that bar's rows; the chart toggle preserves the query.

**Benchmark:** Excel "Show Values As"; Attio reports. **Build:** Apache ECharts; pivot grid reuses the doc-4 grid; aggregation server-side (R0).

### R3 — Report templates that ship *(v1)*

*As a rep or manager, I want ready-made reports for the common questions.*

Presets over the engines (R2/R4/R5), opened from the Templates gallery, tweakable then **Save as**:
1. **Sales-acquisition pipeline over time** — metric×week grid (R4): calls, emails, connects, opps created/qualified/won + conversion rates.
2. **Stage-movement report** — starting → moved down/up a stage → ending, per week (R4 + `FieldHistory`, needs 3B-1).
3. **Segment report** — closed-won (or any metric) by account type/segment across weeks (R2 grouped).
4. **Forecast** — category-weighted expected value per quarter (R2 weighted measure).
5. **Dialer group** — connect-rate by number/area/time-of-day (R5).
6. *(Later, needs multi-user)* **Rep rankings**, **Headcount**, **Cohortized close** (R7).

**Acceptance:** each template renders from a seeded `Report.configJson` with zero manual field-picking; "Save as" produces an independent editable copy. **Build:** each template = a seeded `Report` config.

### R4 — Activity metrics×time grid *(v1)*

*As a manager, I want a grid of key metrics by week, to see activity and pipeline motion at a glance.*

- **Rows = metrics, columns = periods (weeks default).** Two cell types made explicit per row: **event counts** (Emails, Calls — count `ActivityEntry` rows whose `occurredAt` is in the bucket) vs **stage-entry counts** (Qualified, Closed-Won — count deals whose `FieldHistory` shows a transition **into** that stage in the bucket; needs 3B-1).
- **Builder:** pick the date field for columns, a grain (week), a window (last 8 weeks), check metrics from a predefined list. "Connected calls" / "Qualified" expose a small filter (disposition set / target stage). Optional **Total** column + trend sparkline.
- **Conversion rows:** between any two metric rows, add a **conversion %** row (calls→connects, opps→won) — same "% of another row" transform as R2.
- **Acceptance:** event-count rows tie to `ActivityEntry` counts; stage-entry rows tie to `FieldHistory` into-stage transitions; a conversion row = ratio of its two source rows.

**Benchmark:** Attio reports (stage-changed / current-state). **Build:** ECharts grid + sparkline; `ActivityEntry` + `FieldHistory`.

### R5 — Call / dialer analytics slices *(v1)*

*As a rep or manager, I want connect rates by number, area code, and time of day, so I can protect number health and call when people pick up.*

Dialer analytics is **not a separate page** — it's a **report group inside Reports** (R1), rendered with the same engine + ECharts. General dials/connects/funnel are already R4; this module owns only the number-centric slices R4 doesn't model:

- **Connect rate by number** — one row per owned number (`fromE164`), sortable: Dials, Connects, Connect %, Spam status, Daily cap (spam/cap columns via `PhoneNumber`, 3B-4). "Connect" = disposition-in-set (3B-3) or `status="completed"` for v1.
- **Connect rate by time-of-day** — an ECharts **heatmap**, hour × day-of-week, bucketed in the **org timezone**; the darkest cell is the **best window**, which feeds a future *Best time to call* field.
- **Per-number health trend** — answer rate over time per number.
- **Scope:** solo (your own numbers) for now; per-rep/team roll-ups are a later **group-by** in the same pivot, not a new page.
- **Acceptance:** connect-rate-by-number matches a hand count off `Call`; the heatmap buckets by org tz (a DST week doesn't shift a call an hour); changing the "connected" definition re-computes both.

**Benchmark:** Nooks dialer analytics (the connect-rate heatmap — but inside our unified Reports area). **Build:** ECharts heatmap/bars; rollup job **D6** (below) into `AnalyticsRollup`; reuses R0.

---

## 6. Later modules

### R6 — Pipeline transition waterfall *(later)*
A Clari-style **waterfall** bridging `Starting → + Created → + Expanded → − Slipped/Pushed → − Lost → = Ending` between two dates. Each segment drills through to its deals. **Requires `PipelineSnapshot` (3B-2).** Render for [A,B] = load the snapshot set at A and at B, left-join by `dealId`, classify each deal (present at B not A = Created; amount up = Expanded; amount down / closeDate pushed = Slipped; stage outcome=lost = Lost), sum each bucket. **Build:** ECharts stacked-bar risers; `PipelineSnapshot` + job F4.

### R7 — Cohort / decay report *(later)*
Group records by when a **start** transition happened, then track what % reach an **end** transition over t+0…t+n → a decay/rise curve per cohort. Four inputs: **object type**, **the change field** (any status `AttributeDef`, read from `FieldHistory`), **start status**, **end status**, plus a max horizon and cohort-size normalization. Table = cohort triangle; chart = decay lines. **Requires the `FieldHistory` index (3B-1)**; generalizes to any status field on any object. **Benchmark:** Metabase funnel/cohort.

### R8 — Dashboards *(later)*
Navbar **Dashboards** → named boards holding **report tiles** and **rich-text blocks** (TipTap) on one drag/resize snap grid. **Beats Attio** on two things: text/annotation blocks, and an explicit **Refresh** (whole board or per tile) that recomputes and restamps "as of HH:MM". Same open share model as R1. **Build:** `Dashboard` + `ReportWidget` (tiles and text share the grid).

### R9 — Member profile pages *(later)*
Click any user's name/avatar → a **profile page**: header (name, title, email, phone, manager, team, tz), a rich-text "About me," and an optional **personal dashboard** pinned from R8 (only reports the viewer may see render). Greenfield — Attio has none; benchmark Lattice/Linear/Notion. **Build:** `UserProfile` extends `User`; reuses `Dashboard`.

### R10 — Computed / formula fields *(later)*
**Settings → Computed fields → + New**, or a field of type **Formula** on any object. Spreadsheet-familiar syntax (`=(Amount - Cost)/Amount`, `=IF(Stage="Won", Amount, 0)`, `=DAYS(Now(), CreatedAt)`) with autocomplete + live preview; then usable as a pivot dimension/measure. **No bespoke language and no raw `eval`:** **`@formulajs/formulajs` (MIT, ~400 Excel functions) behind a `jsep` parser.** We build lightweight recalc tracking (parse → record referenced fields → recompute on input change through the CRM write path, or at query time for report-only formulas). Rejected HyperFormula (GPLv3-or-commercial). Raw JS, if ever needed, goes in `isolated-vm`. **Benchmark:** Airtable/Notion formula fields.

### R11 — Scheduled report delivery *(later)*
An open report/dashboard → **Subscribe / Schedule**: cadence (daily / weekly-on-day / monthly), time (org tz), format (inline summary + link, or CSV/PDF), recipients (self / teammates / a Slack channel). Opt-in once, then automatic; pause/unsubscribe anytime. **Job `report-deliver`** (below). Needs the email send path + Slack connection seams. **Benchmark:** Metabase subscriptions; Salesforce subscribe-to-reports.

---

## 6a. Rep-loved differentiators (added from the benchmark research)

*The [benchmarks spec](SPEC-REPORTING-BENCHMARKS.md) found the highest rep-love-per-effort features the incumbents do badly. These are the ones that make reps choose us; slot them deliberately.*

### R12 — "My Pipeline" home *(near-term differentiator)*
*As a rep, I want a personal home that is **mine** — my deals, my activity, my progress to goal, and where I rank — without building anything.*

- **Entry point.** A default **My Pipeline** view (navbar or Reports home), rendered from a **seeded personal dashboard** with a per-viewer filter (`ownerUserId = me`) — the Attio "Current user" pattern, so one definition personalizes for every rep.
- **Contents:** my open pipeline by stage, my activity this week (calls/connects/emails vs my pace), my progress-to-goal, and a **leaderboard** tile (where I rank on a chosen metric) — visible competition is the #1 rep-love signal.
- **Timezone:** buckets in the **viewer's** zone ([architecture §6a](SPEC-REPORTING-ARCHITECTURE.md#6a-different-viewers-in-the-same-org-different-zones), mode 2) — "today" means the rep's today.
- **Leading-indicator framing** (Dorsey/Kazanjy): the default tiles are the causal activity metrics a rep controls, not just last quarter's revenue.
- **Build:** reuses R8 dashboard + R0 measures + a per-viewer filter; seeded, not hand-built. **Depends on:** R8 (or a lite single-page version that ships before full dashboards). **Benchmark:** Pipedrive per-rep dashboards, Attio "Current user."

### R13 — First-class mobile *(DEFERRED — much later)*
*As a field rep, I want to read my dashboards, drill into records, and refresh on my phone.*

**Deferred to a much later phase (Ryan's call).** v1 targets desktop web; we do **not** hold each module to a phone-width bar now. When R13 is picked up it's responsive web first (the app is React+Vite; native app out of scope): responsive breakpoints on each surface, a mobile drill-through grid layout, and pull-to-refresh — the things Salesforce mobile fails at. Until then, mobile is explicitly out of scope and not part of any module's Definition of Done. **Benchmark:** beat Salesforce mobile analytics limits.

### R14 — Live spreadsheet sync *(later differentiator)*
*As an analyst, I want the report's rows in Google Sheets/Excel, kept fresh, so "I export anyway" becomes "it's already synced."*

- Beyond one-shot CSV/XLSX export ([builder-UX §6](SPEC-REPORTING-BUILDER-UX.md#6-data-download--export)): a **live connection** that refreshes a report's rows into a Sheet on a schedule (or via a Sheets add-on / published CSV endpoint).
- Turns the universal "reps export to a spreadsheet" complaint into a feature instead of a leak.
- **Build:** a tokened, row-level-visibility-scoped export endpoint + a Sheets connector; async refresh via pg-boss. **Depends on:** R0 + the export path. **Benchmark:** beat Attio/Gong export limits.

---

## 7. Background jobs

- **F4 — Report precompute + pipeline snapshots.** **Trigger:** nightly cron in the **org timezone** + on-demand refresh (R8). **Steps:** (1) append one `PipelineSnapshot` per open deal (R6); (2) roll up daily activity / stage-entry counts into `ReportRollup` for fast dashboards; (3) restamp "as of." **pg-boss:** queue `report-precompute`, daily cron + manual trigger, `retryLimit: 3`, idempotent per `(orgId, day)`.
- **D6 — Dialer analytics rollup.** **Trigger:** pg-boss cron **hourly** + on-demand on a stale bucket. **Steps:** aggregate only the dialer-specific slices R4 doesn't model — connect rate by number / area / time-of-day — into `AnalyticsRollup`, bucketed in the org tz. **pg-boss:** queue `dialer-analytics-rollup`, `retryLimit: 2`, `singletonKey = orgId` so overlapping runs coalesce.
- **`report-deliver`** — scheduled delivery (R11). **pg-boss:** `retryLimit: 3`, idempotent per `(subscriptionId, runDate)` so a retry never double-sends.

**Monitoring.** Standard pg-boss queue depth / failure-rate / dead-letter alerts. Report-specific: nightly snapshot row-count vs expected open-deal count (a drop = a missed org); `report-deliver` failures surface to the subscription owner, never silently dropped.

---

## 8. Data model (Prisma) — reporting-owned

*All additive; all `orgId`-scoped. Names align to the maincar-2 schema (`orgId`, `amountMinor`, `PipelineStage`).*

```prisma
model Report {                 // R1–R3
  id         String  @id @default(cuid())
  orgId      String
  name       String            // required at save (R1)
  kind       String            // activity | transition | pivot | cohort | dialer
  configJson Json              // base object, rows, columns, values, calc, chart type, cohort/dialer settings
  ownerId    String
  editors    String[]          // extra editors; VIEW is org-wide by link (R1)
  folder     String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([orgId])
}

model Dashboard {              // R8
  id          String  @id @default(cuid())
  orgId       String
  title       String
  description String?
  ownerId     String
  editors     String[]
  pinnedToProfileUserId String? // set when saved to a profile (R9)
  createdAt   DateTime @default(now())
  @@index([orgId])
}

model ReportWidget {           // R8 — a tile OR a text block
  id          String  @id @default(cuid())
  orgId       String
  dashboardId String
  kind        String            // report | text
  reportId    String?           // when kind=report
  textJson    Json?             // TipTap, when kind=text
  layoutJson  Json              // x/y/w/h on the snap grid
  @@index([orgId, dashboardId])
}

model PipelineSnapshot {        // R6 / F4 — nightly point-in-time open pipeline (3B-2)
  id          String   @id @default(cuid())
  orgId       String
  dealId      String
  stageId     String
  amountMinor BigInt?
  currency    String   @default("USD")
  closeDate   DateTime?
  snapshotAt  DateTime          // the "as of" date, org-tz aligned
  @@index([orgId, snapshotAt])
}

model AnalyticsRollup {         // R5 / D6 — dialer-specific precompute only
  id        String   @id @default(cuid())
  orgId     String
  day       DateTime            // bucket (UTC day; displayed in org tz)
  hourOfDay Int?                // for the time-of-day heatmap
  numberE164 String?            // connect-rate-by-number (or numberId if 3B-4 lands)
  areaCode  String?
  dials     Int      @default(0)
  connects  Int      @default(0)
  @@unique([orgId, day, hourOfDay, numberE164, areaCode])
}

model ReportRollup {            // F4 — general activity / stage-entry daily rollups for fast dashboards
  id        String   @id @default(cuid())
  orgId     String
  day       DateTime
  metricKey String              // emails | calls | connects | opps_created | entered_stage:<stageId> | ...
  value     Int      @default(0)
  @@unique([orgId, day, metricKey])
}

model ComputedField {           // R10
  id         String  @id @default(cuid())
  orgId      String
  objectSlug String
  name       String
  formula    String             // spreadsheet syntax, evaluated by @formulajs/formulajs
  createdAt  DateTime @default(now())
  @@index([orgId, objectSlug])
}

model ReportSubscription {      // R11
  id          String  @id @default(cuid())
  orgId       String
  reportId    String?           // report OR dashboard
  dashboardId String?
  cadence     String            // daily | weekly:MON | monthly:1
  atLocal     String            // "07:00" in org tz
  format      String            // summary | csv | pdf
  recipients  Json              // userIds / emails / slackChannel
  ownerId     String
  paused      Boolean @default(false)
  @@index([orgId])
}

model UserProfile {             // R9 — extends User
  id         String  @id @default(cuid())
  orgId      String
  userId     String  @unique
  title      String?
  aboutJson  Json?              // TipTap "about me"
  photoUrl   String?
  // name/email/phone/manager/team read from User + org structure
}
```

### Required changes to CRM-schema-owned models (raise on that project)

```prisma
// FieldHistory — ADD for stage-entry + cohort reverse queries (3B-1)
//   @@index([orgId, objectSlug, attribute, changedAt])

// Call — ADD (3B-3 / 3B-4), all nullable:
//   dispositionId String?  // FK → DispositionDef; rep-logged outcome (may be null on an undispositioned dial)
//   noteText      String?  // rep's free-text note logged with the call (or reuse the Note model linked to the call)
//   numberId      String?  // FK → PhoneNumber, set at dial time (else group by fromE164 string)

// DispositionDef — NEW, CRUD, seeded + user-supplied (3B-3). Owned by the dialer/call spec.
model DispositionDef {
  id        String  @id @default(cuid())
  orgId     String
  value     String            // stable machine key, never renamed
  label     String            // display text, editable
  color     String  @default("#94a3b8")
  icon      String?           // optional lucide id
  category  String  @default("not_connected") // connected | not_connected | ... — "counts as connected" reads this
  isStandard Boolean @default(false) // seeded default vs user-created
  sortOrder Int     @default(0)
  isArchived Boolean @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([orgId, value])
  @@index([orgId])
}

// Upstream dependency (future call-intelligence spec, NOT reporting-owned): CallMetrics
//   (talkRatioJson, longestMonologueS, interactivity, questionCounts) per call — 3B-5, built LATER (confirmed).
```

---

## 9. Technology choices

- **Reporting engine — precompute + query-time hybrid** (R0). Rollups (`ReportRollup` / `PipelineSnapshot`, job F4) for stage history, transitions, velocity, forecast; query-time for ad-hoc filters and drill-through.
- **Charting — Apache ECharts (Apache-2.0), one library across the app.** Waterfall, cohort/decay, funnel, heatmap, plus simple bar/line/grid. *Not* two chart stacks. The pivot grid reuses the doc-4 fast grid; aggregation is server-side.
- **Formula engine — `@formulajs/formulajs` (MIT) behind `jsep`** (R10). ~400 Excel-compatible functions, permissive license; we build the recalc tracking. HyperFormula rejected on GPLv3-or-commercial. No raw `eval`; `isolated-vm` if ever needed.
- **Timezone — store UTC, bucket + display in the org timezone.** IANA zone so DST is handled, per-report override. Switching the display zone re-buckets on the fly.

---

## 10. Decisions (resolved)

1. **`Call` disposition (3B-3) — DECIDED.** The **dialer/call spec** owns a full `DispositionDef` CRUD (seeded + user-supplied; value/label/color/icon/category), plus `Call.dispositionId` + a call note. Reporting consumes the disposition **category** for "connected." v1 may fall back to `status="completed"` until dispositions land.
2. **Stage-entry source (3B-1) — DECIDED: index `FieldHistory`.** Add `@@index([orgId, objectSlug, attribute, changedAt])`; don't build a separate projection table (the data already lives in `FieldHistory`).
3. **`PipelineSnapshot` (3B-2) — DECIDED: reporting-owned, in this project.** Not raised on the CRM schema project.
4. **3B-5 per-call metrics — DEFERRED (confirmed).** Built later by a call-intelligence spec; reporting consumes `CallMetrics` if/when it exists.

---

## 11. Companion deep-dive specs

This doc is the map. The companion specs go deep on the parts that need their own research and design (each benchmarks real BI tools + open-source libraries):

- **[SPEC-REPORTING-ARCHITECTURE.md](SPEC-REPORTING-ARCHITECTURE.md)** — R0 internals: do we hit Postgres on every load or precompute? ORM vs generated SQL, materialized rollups, caching, the semantic layer, **per-viewer timezones**, and the **performance challenges, tradeoffs, and things we won't easily support**. *(Answers "how does it work" + "is there a faster way than hitting Postgres constantly," ELI5.)*
- **[SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md)** — R1–R4 experience: the report/pivot builder UX benchmarked against **Metabase, Excel PivotTable, and think-cell**; the **contextual "controls next to the thing" interaction model**; every parameter a user can change; the **% of total / MoM / YoY rows-beneath-rows** transforms; **drill-through**; **data download/export**; **won't-compute edge cases, chart-config errors, and empty states/guidance**.
- **[SPEC-REPORTING-CHARTING.md](SPEC-REPORTING-CHARTING.md)** — the charting/visualization layer: library choice deep-dive (ECharts vs alternatives), think-cell-quality chart features, per-chart parameters, and the number↔chart model.
- **[SPEC-REPORTING-BENCHMARKS.md](SPEC-REPORTING-BENCHMARKS.md)** — best-in-class CRM reporting, what reps actually love and hate (experts + community research), and the specific gaps we should beat.
- **[SPEC-REPORTING-TESTING.md](SPEC-REPORTING-TESTING.md)** — the testing strategy and guardrails across every module: correctness of aggregation, SQL-injection/tenant-isolation, timezone/DST, performance budgets, chart/config validation, and the Definition of Done per module.
- **[SPEC-REPORTING-SHARING-AND-PERMISSIONS.md](SPEC-REPORTING-SHARING-AND-PERMISSIONS.md)** — who can view/edit/share/export/subscribe, and how drill-through + export enforce row-level record visibility without leaking a record the viewer couldn't open.
- **[SPEC-REPORTING-FORMULA-ENGINE.md](SPEC-REPORTING-FORMULA-ENGINE.md)** — R10 computed/formula fields: `@formulajs/formulajs` + `jsep`, parsing, dependency tracking + recalc, type handling, error UX, and the no-`eval` security model.
- **[SPEC-REPORTING-DASHBOARDS.md](SPEC-REPORTING-DASHBOARDS.md)** — R8 boards: the layout engine, dashboard filters + cross-filtering, refresh/"as of", mobile reflow, performance, and the substrate for My Pipeline (R12).

---

## 12. Delivery size estimate

*Your question: how many issues/tickets to get reporting done?* A rough, honest breakdown (each ticket ≈ a shippable slice with its own tests, per [CLAUDE.md](../../CLAUDE.md)). Not a commitment — a scale check.

| Area | Tickets (approx) | Notes |
|---|---|---|
| **R0 engine core** | 6–9 | Registry, config→SQL compiler, allowlist safety, tenant scoping, drill-query builder, timezone resolver, result contract. The foundation — front-load it. |
| **R1 reports home + lifecycle** | 4–6 | Home, list, save/name/share, delete/trash. |
| **R2 pivot builder + drill** | 10–14 | Drop zones, field list, aggregations, Show-Values-As transforms, PoP toggle, selective summary rows, drill-through, contextual controls. The biggest single area. |
| **R3 templates** | 2–3 | Seeded configs + gallery. |
| **R4 activity grid** | 3–4 | Grid engine, stage-entry via FieldHistory, conversion rows. |
| **R5 call/dialer analytics** | 4–6 | Connect-rate slices, heatmap, D6 rollup, disposition dependency. |
| **Charting (R2/R4/R5 shared)** | 5–7 | ECharts integration, per-chart params, chart-config validation, export PNG/SVG. |
| **Export/download** | 3–4 | CSV/XLSX, async large-export job, formatted vs raw. |
| **R13 mobile** | +1 per UI module | Responsive/drill QA folded into each surface's DoD. |
| **Testing/guardrails harness** | 3–5 | Fixtures, aggregation-correctness suite, injection tests, perf budget checks. |
| **v1 core subtotal** | **≈ 45–65 tickets** | R0–R5 + charting + export + testing + mobile QA. |
| **Later (R6 waterfall, R7 cohort, R8 dashboards, R9 profiles, R10 formula fields, R11 delivery, R12 My Pipeline, R14 sheets sync)** | **≈ 35–55 tickets** | R10 (formula engine) and R8 (dashboard layout) are the heaviest. |
| **Grand total** | **≈ 80–120 tickets** | A large, multi-quarter feature — hence the phasing. |

**Read:** yes, it's big — that's why the spec captures-all-but-phases. v1 core (R0–R5) is a coherent, shippable ~45–65-ticket first release that already beats most CRMs on pivot ease + drill-through + call analytics.

## 13. Completeness review — what's thin or should break out

*Your question: what in this master spec is (a) incomplete or (b) deserves its own spec?* Assessment:

**(a) Was incomplete — now broken out into their own specs (done):**
- **Sharing / permissions / row-level visibility** → **[SPEC-REPORTING-SHARING-AND-PERMISSIONS.md](SPEC-REPORTING-SHARING-AND-PERMISSIONS.md)**.
- **R10 formula engine** → **[SPEC-REPORTING-FORMULA-ENGINE.md](SPEC-REPORTING-FORMULA-ENGINE.md)**.
- **R8 dashboards** → **[SPEC-REPORTING-DASHBOARDS.md](SPEC-REPORTING-DASHBOARDS.md)**.

**(b) Fine as sections here** (not worth breaking out): R3 templates, R4 activity grid, R5 dialer slices, R9 profiles, R12 My Pipeline, R14 sheets sync.

**Still owned elsewhere (not a reporting spec):** **Forecasting** — the weighted-forecast measure + the forecast template touch deal-board logic; belongs in a forecasting/deal-board spec, with reporting consuming it. Flag when that spec is written.
