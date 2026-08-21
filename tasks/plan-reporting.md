# Plan — Reporting Engine (vertical slices)

Plain-English build plan for the reporting feature specced in `docs/specs/SPEC-REPORTING-*.md`. Everything is sliced **vertically** — each project and each issue delivers one complete path (data → API → screen → test), not a horizontal layer like "all the backend first." Mobile (R13) is deferred.

## How the slicing works

- **A project = a shippable chunk of user value.** When a project is done, a rep can actually do something new.
- **An issue = the thinnest end-to-end slice of that value.** Each issue touches the data, the API, and the screen it needs, and ships with its own tests. No "build the whole engine" mega-issues.
- **Build order follows dependency, not layer.** The engine's first slice is "one number, correct, for my org" — then we widen it.

## The four projects (each a vertical slice of the whole feature)

| # | Project | What a user can do when it's done | Specs |
|---|---|---|---|
| **P1** | **Reporting v1 — Core Engine & Pivot Builder** | Build a pivot by dragging fields, chart it, drill to the real records, save/share it, export it. | ENGINE R0/R1/R2 · ARCHITECTURE · BUILDER-UX · CHARTING · SHARING · TESTING |
| **P2** | **Reporting v1 — Standard Reports, Activity & Call Analytics** | Open ready-made reports; see the weekly activity grid; see connect-rate by number/area/time-of-day. | ENGINE R3/R4/R5 · dialer disposition dependency |
| **P3** | **Reporting — Dashboards & My Pipeline** | Pin reports + notes onto a board; open a personal "My Pipeline" home. | ENGINE R8/R12 · DASHBOARDS |
| **P4** | **Reporting — History, Formulas & Delivery** | See a pipeline waterfall + cohort; add formula fields; get reports emailed/synced; see member profiles. | ENGINE R6/R7/R9/R10/R11/R14 · FORMULA-ENGINE |

**P1 and P2 are the v1 release** (~45–65 tickets in the spec estimate; the issues below are the shippable slices, breakable further during build). P3 and P4 are later phases. R13 mobile is deferred to a much-later phase, not in any project below.

---

## P1 — Reporting v1: Core Engine & Pivot Builder

*Goal: a rep builds a real pivot, charts it, drills to the rows behind any number, saves/shares/exports it — on desktop web.*

**Dependency order:** 1 → 2 → (3,4 in parallel) → 5 → 6 → 7 → 8 → 9 → 10; 11 and 14 run alongside; 12,13 fold in.

1. **Engine skeleton: one correct number.** Build the report-config shape, the field registry for Deals, and the config→SQL compiler for a single "group Deals by Stage, sum amount" query, scoped to the org. *Done when:* the API returns the right grouped sums for a seeded org, proven against a hand-checked total.
2. **Make the engine safe.** Add the allowlist (only registry fields/aggregations reach SQL) and always inject the org filter from the session. *Done when:* a hostile config (raw column, `;drop`, another org's id) is rejected, and a two-org test shows zero cross-org leakage.
3. **Reports home + save/open.** The Reports page: list my reports, save a report with a required name, reopen it, rename, delete (30-day trash). *Done when:* save → reopen renders the same report; you can't save a nameless one.
4. **Pivot builder — drop zones.** The builder screen: pick Deals, drag fields into Rows/Columns/Values, see the grid fill live, nest rows for subtotals + grand total. *Done when:* dragging Owner→Rows, Stage→Columns, Amount→Values shows a correct grouped pivot in under a minute.
5. **More measures.** Add count, average, distinct count, median, percentile as one-click measures. *Done when:* each matches a hand-checked value on the fixture.
6. **"Show values as" + period comparison.** Add % of row/column/grand/parent, running total, rank; the one-click MoM/YoY toggle (delta + % delta); and the "add a % / YoY summary row under only these rows" action. *Done when:* a % row appears under only the selected rows; a YoY column ties to a hand-checked prior-year value; divide-by-zero shows "—", never a broken number.
7. **Charts.** The number↔chart toggle; ECharts wired in (bar/line/area/pie/funnel/heatmap/scatter/KPI); per-chart controls that live **on** the element (click a bar/axis/label to edit it), not in a giant form. *Done when:* a table becomes a correct chart and back; a user changes a color/label/axis without opening the side panel.
8. **Stop bad charts.** Catch chart choices that won't render or mislead (pie with negatives, line on unordered categories, KPI on many rows) and auto-suggest the right one with a gentle warning. *Done when:* each bad case steers the user instead of erroring.
9. **Drill-through.** Double-click any cell/bar → a slide-over grid of the actual records behind it, with the filters shown as removable chips, reusing the CRM grid + peek drawer. *Done when:* the drilled rows re-add up to the number clicked; removing a chip widens the set live.
10. **Export.** Download the report as CSV/XLSX; big exports run as a background job that hands back a link; choose formatted vs raw; export just the drilled rows. *Done when:* a filtered report exports the on-screen rows; an over-cap export returns a job+link instead of hanging.
11. **Sharing + permissions.** View = anyone in the org with the link; edit = owner + named editors; drill-through/export run through a record-visibility check (a seam; today the org boundary). *Done when:* a second org member views by link but can't edit; the visibility seam is in the drill/export path.
12. **Empty states + guidance.** Every blank/zero moment (new report, no fields, no matching rows, not-yet-computable) shows the next action, not a blank screen or a raw error. *Done when:* each empty state from the spec renders its guidance.
13. **Time zones done right.** The compiler resolves a report's zone (pinned / viewer / subject) and buckets with it; never the server zone; a DST week doesn't shift a record. *Done when:* the same report buckets correctly for a New York vs London viewer, and a DST-week fixture passes.
14. **Test + guardrail harness.** Golden fixtures, the aggregation-truth suite, the drill-reconciles-to-the-cell property test, tenant-isolation tests, and a performance budget on a large fixture; runtime guardrails (query timeout, max-groups cap). *Done when:* `npm run verify` is green and a runaway pivot is capped, not run.

**Checkpoint A (end of P1):** a rep opens Reports, builds a Deals pivot, adds a % and a YoY, charts it, drills to the real deals, exports, saves, and shares a link — all correct, all tested.

---

## P2 — Reporting v1: Standard Reports, Activity & Call Analytics

*Goal: ready-made reports, the weekly activity grid, and real call analytics — reusing the P1 engine.*

**Depends on P1** (the engine + builder). Dialer disposition (issue 4) may be owned by the dialer/call spec — coordinate.

1. **Template gallery + seeded templates.** A gallery of ready-made reports (pipeline-by-stage, segment, forecast) that open, render, and can be "saved as" your own. *Done when:* each template renders with zero field-picking and "save as" makes an independent copy.
2. **Activity grid — event counts.** The metrics×week grid; event-count rows (calls, emails, meetings) from the activity feed. *Done when:* each row ties to a hand count of activity rows in the bucket.
3. **Activity grid — stage moves + conversions.** Stage-entry rows ("moved into Qualified this week") from the field-history log (add the index it needs), plus conversion-% rows between any two rows. *Done when:* stage-entry counts tie to seeded history; a conversion row equals the ratio of its two rows.
4. **Call dispositions (CRUD).** A managed list of call outcomes — seeded defaults + user-added — each with a value, label, color, optional icon, and a "connected vs not" category; attach a disposition + note to a call. *Done when:* a rep manages dispositions in settings and logs one on a call; "connected" reads the category. *(Coordinate with the dialer/call spec — this is its field to own.)*
5. **Connect-rate by number & area.** The dialer report group: connect rate per owned number and area code, with an hourly rollup job feeding it. *Done when:* the numbers match a hand count off the call log.
6. **Connect-rate heatmap (best time to call).** The hour×day heatmap, bucketed in the right time zone, highlighting the best window. *Done when:* the heatmap buckets correctly across a DST week and the best cell is right.

**Checkpoint B (end of P2 = v1 shippable):** shipped templates, the weekly activity grid, and call analytics all work on the same engine. This is the v1 reporting release.

---

## P3 — Dashboards & My Pipeline (later)

*Goal: assemble reports + notes onto boards; give each rep a personal home.*

**Depends on P1.**

1. **Dashboard + tiles.** Create a titled board; drag/resize report tiles on a grid that saves. *Done when:* a board with two report tiles saves and reloads its layout.
2. **Text blocks.** Add rich-text blocks (headings, commentary) on the same grid. *Done when:* a caption block sits between two charts and persists.
3. **Board filters + refresh.** One date/owner filter re-scopes every tile; a "current user" filter; a Refresh button that recomputes and restamps "as of". *Done when:* setting the date filter re-scopes all applicable tiles; refresh restamps.
4. **Cross-filter (fast-follow).** Clicking a bar on one tile filters the rest of the board. *Done when:* a click narrows the whole board and can be cleared.
5. **My Pipeline home.** A seeded personal dashboard (my open pipeline, my activity vs pace, progress-to-goal, a leaderboard tile) using the "current user" filter and the viewer's time zone. *Done when:* two different reps each see their own numbers from the one definition.

**Checkpoint C:** boards + a personal home, sharing and visibility intact.

---

## P4 — History, Formulas & Delivery (later)

*Goal: point-in-time pipeline analysis, formula fields, and getting reports out of the app.*

**Depends on P1; the waterfall/cohort depend on new history data.**

1. **Nightly pipeline snapshot.** The append-only daily freeze of every open deal + its nightly job. *Done when:* a night's snapshot row-count matches the open-deal count and re-running the job doesn't double-write.
2. **Pipeline waterfall.** The Clari-style bridge (start → created/expanded/slipped/lost → end) between two dates, each bar drilling to its deals. *Done when:* the bars reconcile start-to-end and match a hand-classified fixture.
3. **Cohort / decay report.** Group records by a start transition, track % reaching an end transition over time, for any status field. *Done when:* a cohort triangle matches hand-counted decay.
4. **Formula fields — write & preview.** Define a formula field in spreadsheet syntax with autocomplete + a live preview that catches errors; no `eval`. *Done when:* a formula evaluates correctly in preview and a bad reference is explained, not crashed.
5. **Formula fields — recalc.** Recompute a formula when its inputs change, handle formulas-referencing-formulas, and reject circular references. *Done when:* editing an input updates the formula; a cycle is rejected at save.
6. **Scheduled delivery.** Subscribe a report/dashboard to email or Slack on a schedule; a job that never double-sends. *Done when:* a daily subscription delivers once per day and can be paused.
7. **Live spreadsheet sync.** A tokened, visibility-scoped endpoint that refreshes a report's rows into a Sheet on a schedule. *Done when:* a synced sheet refreshes and the token is revocable.
8. **Member profiles.** A profile page (header + about + optional pinned personal dashboard). *Done when:* clicking a name opens their profile; a pinned dashboard shows only reports the viewer may see.

**Checkpoint D:** history reports, formula fields, delivery, and profiles complete.

---

## Cross-cutting rules for every issue

- Ships with its own tests (unit for the math, component for the screen, a live browser walk); `npm run verify` green before commit.
- Never a silently-wrong number: every measure/transform ties to a hand-checked fixture, and drill-through re-adds up to the cell.
- Never a cross-org leak: the org filter is injected server-side and tested.
- Never the server time zone: the report's zone is always resolved explicitly.
- Desktop web only (mobile/R13 deferred).

## Deferred (not in any project above)

- **R13 mobile** — much later.
- **Forecasting logic** — owned by a deal-board/forecasting spec; reporting consumes it.
