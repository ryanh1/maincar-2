# SPEC — Report Builder & Pivot UX

*Companion deep-dive to [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md) modules **R1–R4**. Owns the experience of building a report: the builder interaction model, the full parameter surface, the "Show Values As" transforms (incl. **% of total / MoM / YoY rows beneath selected rows**), **drill-through**, and **data download/export** — the last two under-covered in the map. The engine that runs the config is [SPEC-REPORTING-ARCHITECTURE.md](SPEC-REPORTING-ARCHITECTURE.md); the charts are [SPEC-REPORTING-CHARTING.md](SPEC-REPORTING-CHARTING.md).*

**Design goal (Ryan's words):** as easy as Metabase — ideally easier — flexible enough for a non-technical rep or RevOps to build something useful. **Benchmarks:** Metabase (approachability + drill-through), Excel PivotTable (transform power), think-cell (auto-maintained decorations).

---

## 1. What each benchmark teaches us

- **Metabase — approachability.** A **step-based visual builder** (Pick data → Join → Custom column → Filter → Summarize/group → Sort → Row limit → Visualize) plus **click-to-drill** (click any bar/cell/header to explore, no query written) and **X-ray** (auto-build a starter dashboard from any object). Ceiling: no reusable semantic layer, can't blend sources in the UI, and **period-over-period needs an `Offset()` expression**, not a toggle.
- **Excel PivotTable — transform power in a familiar model.** The **4-drop-zone** model (Filters / Columns / Rows / Values) is the most-recognized report metaphor in business, and **"Show Values As"** (15 options) is the gold standard for display transforms. Pain: manual refresh (silent staleness), fragile source data, "black box" calculated fields, only ~11 summary functions (no median/percentile/distinct-count).
- **think-cell — output polish that maintains itself.** Not a query tool, but loved for exactly what BI tables do worst: **derived annotations (totals, %s, CAGR/difference arrows) are first-class objects that recompute when data changes.**

**Our synthesis:** Excel's drop-zone clarity + its "Show Values As" vocabulary, Metabase's click-to-drill + template/X-ray onboarding, think-cell's philosophy that derived annotations are first-class and auto-maintained. Then beat all three on the specific gaps ([§9](#9-how-we-beat-the-benchmarks)).

---

## 2. The builder interaction model

**A hybrid: Excel drop zones as the primary metaphor, presented through a Metabase-style live, step-like panel.** No SQL mode in v1 (the engine takes a structured config only — see architecture spec).

**Entry point.** Reports home ([R1](SPEC-REPORTING-ENGINE.md#r1--reporting-home--report-lifecycle-v1)) → **+ New report** (blank pivot) or **Start from a template**.

**The layout.**
- **Left: base object + field list.** Pick a **base object** (People / Companies / Deals / Activities / Calls / any custom `ObjectDef`). The field list below is generated from that object's `AttributeDef`s + prebuilt measures + the user's `ComputedField`s. Fields are draggable, grouped (Dimensions / Measures), searchable.
- **Center: the four drop zones — Filters, Columns, Rows, Values.** Drag fields in; the result grid fills **live** as you edit (no manual refresh, ever — beats Excel). Nesting two fields in **Rows** produces grouped **subtotals** automatically; a **grand total** row/column toggles on.
- **Right: the config panel** for the selected field/zone (aggregation, "Show values as," format, sort) or the selected chart (chart type + params, per [SPEC-REPORTING-CHARTING.md](SPEC-REPORTING-CHARTING.md)).
- **Top: number ⇄ chart toggle**, an **Unsaved** chip, **Save** / **Save as**, and **Export**.

**Two safety rails from the architecture spec surface in the UI:**
- **Max-groups cap + top-N.** A dimension with too many distinct values prompts "Show top N + Other" rather than rendering 500k rows.
- **"As of HH:MM TZ"** stamp on any value served from a precomputed rollup, so live-vs-precomputed is never ambiguous.

**Acceptance:** a rep with no training drags Owner→Rows, Stage→Columns, Pipeline $→Values and sees a grouped pivot in <60s; nesting a second Row field adds subtotals; switching to a chart preserves the query.

---

## 2a. Interaction design philosophy — controls next to the thing, not a wall of forms

*Your point: Google Sheets and Excel charting are hateful because they bury every option in an unreadable properties form far from the chart; think-cell is loved because the control sits **on** the element you're changing.* This is a first-class design rule for our builder, not a nicety.

**The rule: edit where you look.** A control appears **adjacent to the element it changes**, invoked by clicking that element — not hunted down in a distant panel.

- **Click a series/bar → a small floating toolbar on it** with that series' knobs (color, label on/off, stack, this-series chart type). Not a 40-row form in a sidebar.
- **Click an axis → axis controls at the axis** (min/max, format, log, hide). **Click a legend item → toggle/recolor there.**
- **Click a data label → format it in place.** **Click a total row → the "Add summary row / Show values as" menu** right there ([§4a](#4a-the-two-requests-you-called-out--and-how-we-beat-the-benchmarks)).
- **Drop zones stay visible and direct-manipulation** — drag a field between Rows/Columns/Values and the grid reshapes live. The zones *are* the primary control; the giant form is the anti-pattern.
- **Right panel is for the few things without an on-canvas home** (base object, global filters, save/share) — it is a fallback, never the main surface. Progressive disclosure: common knobs on the element, advanced ones one click deeper.
- **Every control shows its effect live** (no "apply" button) and is **named in plain language** with a one-line "what this does" on hover.

**Benchmark contrast to encode:** Google Sheets / Excel chart editor = one long scrolling form, options divorced from the chart, high reading load → we reject this. think-cell = contextual on-object controls, minimal reading, spatial proximity → we copy this philosophy (its exact decorations are out of scope per [charting §4](SPEC-REPORTING-CHARTING.md), but the *interaction model* is the target). **Acceptance:** a usability pass shows a new user changing a series color, a label, and an axis max **without ever opening the right panel.**

---

## 3. Full parameter inventory

The complete set of knobs (also the `Report.configJson` schema). Grouped; the flat checklist is [§10](#10-parameter-checklist).

- **Data source:** base object; join/related object (constrained to registry-allowed paths — see architecture §9); cross-object blend (CRM + dialer, e.g. Calls + Deals); column include/exclude; custom/derived column.
- **Field placement:** Rows (nestable → subtotals), Columns (nestable), Values (one aggregation each), report-level Filters, visual Slicers/Timeline.
- **Aggregations:** count, sum, average, min, max, **median, percentile(p), distinct count**, stddev/variance, cumulative sum/count, **share (% of total)**, conditional **countIf / sumIf / distinctIf**. *(We ship median/percentile/distinct-count as one-click measures — Excel lacks them, Metabase hides them behind expressions.)*
- **Filters (operators by type):** text (is / is not / contains / not contains / starts / ends / empty / not empty); number (= ≠ > < ≥ ≤ between / top-N / bottom-N / empty); date (on / before / after / between / **relative** previous/current/next N units / "starting from" offset / exclude); boolean; geo (inside); saved named segments.
- **Date grain / grouping:** minute…year, day-of-week / month-of-year / quarter-of-year, **fiscal year/quarter/custom week** (a native gap in Excel — we do it), numeric binning (auto / count / width).
- **Sort / limit:** by column asc/desc, by measure value within a field, manual reorder, row limit / top-N / bottom-N.
- **Totals:** subtotals (top/bottom/off per level), grand totals (rows/cols), and **selective summary rows** ([§4](#4-show-values-as--the-transform-vocabulary)).
- **Display transforms ("Show Values As"):** [§4](#4-show-values-as--the-transform-vocabulary).
- **Number/value formatting:** style (number/percent/scientific/currency), decimals, thousands separator, prefix/suffix, multiply-by, currency unit; **dates always render with an explicit timezone label** per [CLAUDE.md](../../CLAUDE.md).
- **Conditional formatting:** single-color rules by operator, color-range heatmap, whole-row highlight, rule ordering, in-cell mini bars.
- **Drill / interaction:** [§5](#5-drill-through). **Export:** [§6](#6-data-download--export). **Save/template:** [§7](#7-templates--saved-reports).

---

## 4. "Show Values As" — the transform vocabulary

Every Values field has a **"Show values as"** dropdown (a **display transform** — no re-query; computed in SQL via window functions per architecture §5). The full set, modeled on Excel:

| Transform | Meaning |
|---|---|
| No calculation | raw value |
| % of Grand Total | value ÷ overall total |
| % of Column Total | value ÷ its column total |
| % of Row Total | value ÷ its row total |
| % Of (base item) | value ÷ a chosen base item (e.g. every month vs January) |
| % of Parent Row / Column / Total | value ÷ its parent's value (nested rows) |
| Difference From (base item) | value − a baseline |
| **% Difference From** | % variance vs a baseline → the **MoM / QoQ / YoY %** engine (base field = date, base item = *previous*) |
| Running Total In | cumulative along a base field |
| % Running Total In | cumulative as % (reaches 100%) |
| Rank (smallest→largest / largest→smallest) | rank within a field |
| Index | relative-weight `(cell × grand-grand-total) ÷ (row-total × col-total)` |

### 4a. The two requests you called out — and how we beat the benchmarks

**"% of total row beneath ONLY some number rows."** Neither Excel nor Metabase does this cleanly (Excel needs `% of Parent Row Total`, a duplicated value field, or fragile `GETPIVOTDATA`; Metabase gives a `Share()` *column*, not a selective row). **Our answer — a first-class "Add summary row" action on any selected group of rows,** with a picker: *Subtotal · % of parent · % of grand total · Running total · YoY %*. This puts a % (or delta) row under exactly the rows the user chose, and nowhere else. This is a headline differentiator — no benchmark has it.

**MoM / YoY / period-over-period.** Metabase requires the `Offset()` expression; Excel needs the `% Difference From` menu. **Our answer — a one-click toggle on any time-grouped measure: "Compare to → previous period / same period last year / custom offset,"** which emits both a **delta** and a **% delta** column (or row), auto-maintained. Under the hood it's a SQL `LAG()`/window function; to the user it's a checkbox.

**Acceptance:** on a Deals-by-month pivot, one toggle adds a "vs last year %" column that ties to a hand-checked `LAG`; selecting three rows and "Add summary row → % of grand total" inserts a % row under only those three.

---

## 5. Drill-through

**The single highest-trust feature for skeptical reps: "show me the actual calls."** Model on Metabase's zero-config drill, with Excel's "Show Detail" as the baseline.

- **Click any cell / bar / segment → a drill menu:**
  - **See these records** — opens the **underlying rows** (the real Calls / Deals / People) in a slide-over grid — the same fast grid + stacked peek drawer as [SPEC-CRM-GRID-AND-RECORD-VIEW.md](SPEC-CRM-GRID-AND-RECORD-VIEW.md). The filters that produced the number show as **removable chips**; all relevant columns show (not just the grouped ones); sort works; and **"Export just these rows"** is right there.
  - **Filter by this value** (=, ≠, <, >).
  - **Break out by** (time / category / another dimension) — re-groups in place.
  - **Zoom in** on time (month → week → day) and numeric ranges.
  - **View this related record** (FK hop) → the record page.
- **Column-header actions:** sort, distribution, sum/average (numeric), distinct values, sum-over-time.
- **Hierarchical groups:** expand/collapse nested row groups (± like Excel).
- **Row-level visibility still applies** (architecture + main spec): the aggregate is open by link, but the drilled rows show only records the viewer may see.
- **Staleness honesty:** if the number came from a rollup, drill-through reads the **same grain** or clearly labels the "as of" time so the total and the detail reconcile (architecture §9).

**Acceptance:** double-clicking a bar opens exactly that bar's rows with the originating filters as chips; removing a chip widens the set live; "export just these rows" produces a CSV of only those records; a viewer without access to a record never sees it in the drill.

---

## 6. Data download / export

*(The map under-covered this. Full treatment here; the async plumbing is in architecture §9.)*

- **Formats:** **CSV**, **Excel .xlsx**, **JSON**; **PNG** (a chart) and **PDF** (a dashboard/report). Chart PNG/SVG via ECharts ([charting spec §7](SPEC-REPORTING-CHARTING.md)).
- **Formatted vs unformatted** — a choice (apply the report's number/date formatting, or raw values) — matches Metabase.
- **Export just the drilled-down rows** — from any drill-through ([§5](#5-drill-through)).
- **Live pivot in Excel (beats Metabase).** Metabase exports a **flattened** table; a common complaint. We export a **real, live Excel PivotTable** where feasible, so the analyst who lives in Excel keeps their pivot.
- **Row limits & async.** Small exports are synchronous. **Large exports (beyond a cap) are pg-boss jobs** that stream via server-side cursor / `COPY` (or DuckDB → CSV) to S3 and hand back a link — never a blocking request (architecture §9). The UI shows "preparing your export… we'll notify you."
- **Copy to clipboard** for a selection.
- **Scheduled delivery** (email / Slack, CSV/PDF attachment) is [R11](SPEC-REPORTING-ENGINE.md#r11--scheduled-report-delivery-later) — later phase.
- **Permissions/privacy:** an export obeys row-level visibility; exporting is an auditable action (it distributes data).

**Acceptance:** a filtered report exports a CSV matching the on-screen rows; an over-cap export returns a job + link, not a timeout; the xlsx opens as a usable pivot, not a dead flat dump.

---

## 7. Templates & saved reports

**Template-first onboarding — a rep should almost never start from a blank canvas** (Metabase's collections + X-ray are the model).

- **Template gallery keyed to CRM/dialer jobs-to-be-done:** "Rep leaderboard," "Calls per day by rep," "Pipeline by stage," "Connect rate MoM," "Talk-time distribution," "Forecast by quarter." Each is a seeded `Report.configJson` ([R3](SPEC-REPORTING-ENGINE.md#r3--report-templates-that-ship-v1)); open → tweak → **Save as**.
- **"Explore this object"** — an X-ray-style one-click that auto-builds a starter report from any object, for the user who doesn't know what to build.
- **Saved reports** live in folders; **pin** important ones; an **Official/Verified** badge marks blessed reports (later, with dashboards R8). Reusable **measures** (the registry + `ComputedField`s) are the lightweight "semantic layer" so reps pick "connect rate" instead of typing an expression.

---

## 7a. Metabase feature-set coverage — what we actually need

*Your ask: think through Metabase's parameter/feature set and decide what we need.* Metabase is the approachability benchmark; here's each of its builder capabilities and our call.

| Metabase capability | Do we need it | Phase / notes |
|---|---|---|
| Visual step builder (pick data → filter → summarize → sort → limit) | ✅ yes | v1, as the drop-zone hybrid ([§2](#2-the-builder-interaction-model)). |
| **Date grain** (minute…year, day-of-week, month-of-year) | ✅ yes | v1. Plus fiscal year/quarter/custom week (Metabase lacks — we add). |
| **Numeric binning** (auto bins / bin count / bin width) | ✅ yes | v1. Needed for "deals by amount band," "calls by duration bucket." Auto-bin with a manual override. |
| **Custom columns / expressions** (arithmetic + functions) | ✅ yes, but constrained | The formula lives in `ComputedField` ([R10](SPEC-REPORTING-ENGINE.md#r10--computed--formula-fields-later)) via formulajs, not raw SQL. Report-local quick expressions in v1-lite; full formula fields later. |
| **`Share()` / % of total** | ✅ yes | v1 as a "Show values as" transform ([§4](#4-show-values-as--the-transform-vocabulary)). |
| **`Offset()` period comparison** | ✅ yes, as a toggle | v1 — but a **one-click PoP toggle**, not an expression (our differentiator, §4a). |
| Aggregations: distinct, median, percentile, cumulative, conditional (SumIf) | ✅ yes | v1 — one-click measures (Excel lacks these). |
| **Joins in the builder** (same-source) | ✅ yes, registry-constrained | v1, but only registry-allowed join paths (architecture §9) — no arbitrary N-way joins. |
| **Filter widgets / parameters** (a report prompts for a value) | ✅ yes | v1-lite: relative-date + owner/stage prompts. Full parameterized dashboards → R8. |
| Multi-source blend (Postgres + Stripe) | ❌ no | Out of scope — we blend only CRM+dialer objects we model. |
| SQL / native mode | ❌ no (v1) | Structured config only (architecture §4a). Later dev-platform path. |
| **X-ray / auto-explore** | ✅ yes, lite | v1-lite: "Explore this object" builds one starter report ([§7](#7-templates--saved-reports)). |
| Models / metrics (semantic layer) | ✅ yes, minimal | The registry + `ComputedField`s are our lightweight semantic layer. |
| Conditional formatting + in-cell mini bars | ✅ yes | v1. |
| Row/grand totals, subtotals, pivot table | ✅ yes | v1 core. |
| Dashboard subscriptions / alerts | ✅ yes | R11 (later). |

**Net:** we match Metabase's whole *builder* surface in v1 except native-SQL, multi-source blend, and full parameterized dashboards; and we **beat** it on PoP-as-a-toggle, selective summary rows, one-click median/percentile/distinct, fiscal grouping, and CRM+dialer blend.

## 7b. Won't compute / won't work — the edge cases

Configs a user can express that **cannot** produce a valid result. Each must be **caught before running** and explained inline — never a raw SQL error or a silently wrong number.

- **A measure with no aggregation on a non-numeric field** — e.g. "sum of Stage (text)." Block: only offer numeric aggregations for numeric fields; offer count/distinct for text.
- **Values with no Rows or Columns** — a measure with nothing to group by yields a single grand-total cell (valid, but often not what they meant) → render the single value + a hint "add a Row to break this down."
- **Too many groups** (high-cardinality dimension: per-person, per-phone) — would return 500k rows. Block: enforce a **max-groups cap**, prompt "Show top N + Other."
- **Join fan-out double-counting** — grouping a Deal measure by a Call dimension multiplies the deal across its calls, inflating sums. Detect the many-side join and either switch to `COUNT(DISTINCT deal)` or warn "this counts a deal once per call — use a call measure instead."
- **Non-additive measure inside a running total / % of parent** — averages and exact distinct don't compose across subtotals. Warn and offer the additive components (sum+count) instead.
- **Period-over-period with no date dimension** (or a grain that has only one period) — "vs last year" needs ≥2 comparable periods. Block: disable the PoP toggle until a date grain with enough range is present.
- **Cohort/stage-entry on a field with no `FieldHistory`** — a status field that was never change-logged has no transitions to read. Warn: "no history recorded for this field yet."
- **Divide-by-zero in % transforms** (a zero row/column total) — render `—`, never `NaN`/`Infinity`.
- **Filter that excludes everything** — valid but empty → the empty state ([§7d](#7d-empty-states--in-app-guidance)), not an error.
- **Formula field referencing a missing/renamed field** (R10) — live-preview error at edit time; the report shows the field as errored, not a crash.
- **Mixed-currency sum** — `amountMinor` carries a currency; summing USD+EUR is meaningless. Block or convert with a stated rate + "converted at …" label; never add blindly.
- **Timezone with no zone resolved** — never fall back to server zone (architecture §6a); block until a zone is resolved.
- **Result too large to render/export synchronously** — route to the async export job (architecture §9), don't hang.

**Rule:** the builder **validates the config before it runs** and surfaces a plain-language reason + a one-click fix ("Switch to distinct count," "Show top 20," "Add a date grain"). A config that can't compute never reaches Postgres.

## 7c. Chart configuration errors — anticipate and prevent

*Your ask: where will users configure a chart and get an error or a bad result?* A number that pivots fine can still make a nonsensical chart. Catch these at the **table→chart** step and steer, don't error.

| Situation | What goes wrong | How we prevent it |
|---|---|---|
| Pie/donut with a measure that has negatives (e.g. net pipeline change) | Pie can't show negative slices | Disable pie for signed measures; suggest bar/waterfall. |
| Pie with 200 categories | Unreadable confetti | Auto top-N + "Other," or suggest a bar. |
| Line chart with a categorical (non-ordered) X | A "trend" between unordered categories is meaningless | Only offer line/area when X is time or ordered; else bar. |
| Two measures on wildly different scales on one axis (count vs $) | One series flattens to zero | Auto-suggest a **dual axis** (combo), or split into two charts. |
| Stacked bar with mixed-sign values | Segments overlap/confuse | Warn; suggest grouped bar or waterfall. |
| Heatmap with a sparse/huge grid | Mostly empty or too dense | Validate the two dimensions' cardinality; suggest a table if sparse. |
| Scatter with a non-numeric axis | Nothing to plot | Require numeric X and Y for scatter. |
| 100%-stack when a group total is zero | Divide-by-zero band | Render the band empty with a note, not `NaN`. |
| KPI/single-value on a multi-row result | Which number? | KPI requires exactly one value; else prompt to add a filter or pick an aggregate. |
| Funnel where steps don't monotonically decrease | "Funnel" that grows | Warn "these steps aren't a funnel"; still render but flag. |
| Too many series/points for the renderer | Slow/janky | Cap series, enable ECharts `large`/sampling (charting §6), or suggest a table. |

**Model: auto-suggest the right chart from the data shape** (time on an axis → line; one dimension → bar; two dimensions + measure → heatmap/stacked), let the user override, and when an override is a poor fit, **show a non-blocking inline warning with a one-click "use the recommended chart."** The chart type is never silently wrong and never a stack-trace.

## 7d. Empty states & in-app guidance

*Your ask: what empty states and guidance get a user to the goal?* A blank builder is where non-technical users bounce. Every zero-data moment is a chance to teach.

- **Blank new report** — not an empty canvas. Show **"Start from a template"** cards + **"Explore this object"** + a 3-step ghost hint ("1 Pick data · 2 Drag a field to Rows · 3 Drag a measure to Values"). Pre-select a sensible base object.
- **Base object picked, no fields yet** — the drop zones show **ghost placeholders** ("Drag a field here to group rows") and the field list highlights 2–3 **suggested** starter fields for that object.
- **Valid config, zero rows** (filters exclude everything) — "No records match these filters," the active filters as **removable chips**, and a **"Loosen filters"** button — never a blank grid or an error.
- **Not-yet-computable config** ([§7b](#7b-wont-compute--wont-work--the-edge-cases)) — the plain-language reason + one-click fix, inline where the problem is.
- **Precomputed tile still warming** (first run before F4) — "Preparing this report…" skeleton with the "as of" stamp appearing when ready, not a spinner forever.
- **No history yet** (cohort/stage-entry on a young org) — "We'll show trends once there's a few weeks of history" with the date it started recording.
- **Drill-through with no underlying rows** — "The number is 0 — nothing to drill into."
- **Permission-limited drill** — "Some records are hidden by your access" rather than a silent short list.
- **First-time reporting (org has no saved reports)** — a guided **Reports home** with the template gallery front-and-center and a one-line "what reporting can do here."

**Guidance style:** inline, contextual, dismissible; plain language; every empty state offers **the next action**, not just a description. This pairs with the contextual-controls philosophy ([§2a](#2a-interaction-design-philosophy--controls-next-to-the-thing-not-a-wall-of-forms)) — help lives where the user is looking.

## 8. What we deliberately don't build (v1)

- **No SQL mode** — the engine takes a structured config only (architecture §3/§4a). Raw SQL is a later developer-platform path.
- **No arbitrary cross-source blending** beyond the CRM+dialer objects the registry models.
- **No think-cell parity** on auto-connectors / CAGR arrows (charting spec §4).
- **No unbounded high-cardinality pivots** — top-N + "Other" instead.

---

## 9. How we beat the benchmarks

1. **Never require a manual refresh** — live data, always (beats Excel).
2. **Period-over-period as a one-click toggle** emitting auto-maintained delta + % columns (beats Metabase's `Offset()`).
3. **Selective summary rows** — "% of total / YoY % under *these* rows" (no benchmark does this cleanly).
4. **One-click median / percentile / distinct-count** measures (Excel lacks; Metabase hides).
5. **Fiscal-year / custom-week grouping** natively (Excel needs helper columns).
6. **Blend CRM + dialer objects** in the UI (no data-engineering wait).
7. **Drill to the actual rows** from any number, with export of just those rows.
8. **Template-first + "Explore this object"** — never a blank canvas.
9. **Export a live Excel pivot**, not a flattened table.

---

## 10. Parameter checklist

**Data source:** base object · join/related object · cross-object blend · column include/exclude · custom column.
**Placement:** Rows (nestable→subtotals) · Columns (nestable) · Values · Filters zone · Slicers/Timeline.
**Aggregations:** count · sum · average · min · max · median · percentile(p) · distinct count · stddev/variance · cumulative sum/count · share(%) · countIf/sumIf/distinctIf · calculated field.
**Filters:** text (is/is not/contains/not contains/starts/ends/empty/not empty) · number (=/≠/>/</≥/≤/between/top-N/bottom-N/empty) · date (on/before/after/between/relative/starting-from/exclude) · boolean · geo(inside) · saved segments.
**Date grain:** minute…year · day-of-week/month-of-year/quarter-of-year · fiscal year/quarter/custom week · numeric binning (auto/count/width).
**Sort/limit:** column asc/desc · by measure value · manual reorder · row limit/top-N/bottom-N.
**Totals:** subtotals (top/bottom/off per level) · grand totals (rows/cols) · **selective summary rows** (subtotal/% of parent/% of grand total/running total/YoY %).
**Show Values As:** no calc · % of grand/column/row total · % Of(base) · % of parent row/column/total · Difference From · **% Difference From (MoM/QoQ/YoY)** · running total · % running total · rank ↑/↓ · index · **period-over-period toggle → delta + % delta**.
**Formatting:** number/percent/scientific/currency · decimals · thousands sep · prefix/suffix · multiply-by · currency unit · **timezone-labeled dates**.
**Conditional formatting:** single-color rules · color-range heatmap · whole-row highlight · rule ordering · in-cell mini bars.
**Drill/interaction:** filter by this value · see these records · view related record(s) · break out by · zoom in · header (sort/distribution/sum/average/distinct/sum-over-time) · expand/collapse groups · "show detail" · dashboard cross-filter (R8) · custom click destination · X-ray/explore.
**Export:** CSV · XLSX (flat + live pivot) · JSON · PNG(chart) · PDF(dashboard) · formatted vs unformatted · copy to clipboard · row-limit control · export just-drilled-rows · scheduled email/Slack (R11) · async large-export job.
**Save/template:** save to folder · pin · official/verified badge · reusable measures · template gallery · "Explore this object" · add to dashboard (R8).

---

## 11. Open decisions

1. **Builder metaphor — pure Excel drop-zones vs Metabase step-list vs the hybrid above.** Recommend the **hybrid** (drop zones for structure, live result, right-panel config). *(Recommend the hybrid.)*
2. **Live Excel-pivot export — v1 or fast-follow?** Recommend **CSV/XLSX-flat in v1, live-pivot xlsx as a fast follow** (it's the "beat Metabase" flourish, not a blocker). *(Recommend fast-follow.)*
3. **"Explore this object" (X-ray) — v1 or later?** Recommend **v1-lite** (auto-build one sensible starter report per object); full multi-tile X-ray later with dashboards. *(Recommend v1-lite.)*

---

## Sources

Metabase visual query builder — https://www.metabase.com/docs/latest/questions/query-builder/editor · Metabase expressions list — https://www.metabase.com/docs/latest/questions/query-builder/expressions-list · Metabase `Offset()` — https://www.metabase.com/docs/latest/questions/query-builder/expressions/offset · Metabase period-over-period — https://www.metabase.com/learn/metabase-basics/querying-and-dashboards/time-series/time-series-comparisons · Metabase drill-through — https://www.metabase.com/docs/latest/questions/visualizations/drill-through · Metabase exporting results — https://www.metabase.com/docs/latest/questions/exporting-results · Metabase collections — https://www.metabase.com/docs/latest/exploration-and-organization/collections · Excel "Show Values As" — https://support.microsoft.com/en-us/office/show-different-calculations-in-pivottable-value-fields-014d2777-baaf-480b-a32b-98431f48bfec · Excel calculated field vs item — https://www.contextures.com/calculatedfieldcalculateditem.html · Excel grouping dates — https://excelchamps.com/pivot-table/group-dates/ · Excel PivotTable limitations — https://trumpexcel.com/pivot-table/limitations/ · think-cell chart decorations — https://www.think-cell.com/en/resources/manual/chartdecorations · think-cell CAGR arrows — https://www.think-cell.com/en/resources/manual/think-cell-cagr
