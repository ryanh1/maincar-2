# SPEC — Charting & Visualization

*Companion deep-dive to [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md). Owns the chart layer: which library, which chart types, the per-chart parameter surface, "think-cell-quality" labeling (and its limits), performance, and export. The builder that produces chart configs is [SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md); the engine that feeds them data is [SPEC-REPORTING-ARCHITECTURE.md](SPEC-REPORTING-ARCHITECTURE.md).*

---

## 1. Decision — Apache ECharts (Apache-2.0), one library

**The licensing constraint decides the field.** maincar-2 is a **commercial, closed-source** product. That eliminates or caps the obvious names:

- ❌ **Highcharts** — **not free for commercial use** (paid per-developer license from ~$176/dev/yr; separate SaaS tier). Free only for personal/non-profit/academic. Easy to prototype with, illegal to ship without paying. Keep it out of even a prototype.
- ⚠️ **AG Charts** — Community is MIT, but **Waterfall, Sankey, radar, financial series, animations, and zoom are Enterprise (paid)**. Standardizing on it sets up a forced purchase the moment we need a waterfall — which we do (R6).
- ✅ **Safe (permissive):** ECharts (Apache-2.0), Recharts / visx / nivo / Plotly.js / Chart.js (MIT), Observable Plot (ISC).

**Among the safe set, Apache ECharts is the pick**, and it validates our earlier tentative choice:

1. **License is clean** — Apache-2.0, no seats, no tier trap.
2. **Native breadth matches our list** better than any other free library: bar/line/area, pie/donut, **funnel**, **heatmap**, **gauge**, **scatter-at-scale**, and **combo/dual-axis** are all first-class. Only **waterfall** and **KPI tile** need building, and both are small.
3. **Best OSS labeling/annotation stack** (`labelLayout` overlap handling, `markLine`/`markPoint`/`markArea`, `graphic`/`custom` series) — the closest anyone gets to think-cell without buying it.
4. **Scales** via a canvas renderer + progressive rendering + downsampling — large heatmaps, dense scatter, and many-chart dashboards stay responsive. SVG libraries (Recharts, visx, Plot) hit a wall around ~5,000 DOM nodes.
5. **The option model is serializable JSON** — it maps almost 1:1 onto a saved chart config and the builder's "pick type, set params" flow.

**One library, deliberately.** Running two chart engines in production means a bigger bundle and a design-tone mismatch. We standardize on ECharts and make two narrow exceptions handled in-house (below), not with a second library.

---

## 2. The two in-house exceptions

- **KPI / big-number tiles and sparklines → plain React components** (a styled number + delta + optional inline sparkline). KPI is not a chart in *any* of these libraries; don't force one to render a single number. A sparkline can be a tiny ECharts instance or inline SVG.
- **Waterfall → an ECharts recipe**, not a native series: a **stacked bar with a transparent "placeholder" base series** (the documented ECharts approach). Works cleanly; the auto-bridge/connector polish is our code (see [§4](#4-think-cell-quality--what-we-can-and-cant-match)).

---

## 3. Chart-type coverage (what R2's toggle offers)

| Chart type | ECharts | How |
|---|---|---|
| Grouped / stacked / 100%-stacked bar | ✅ native | `series.type:'bar'` + `stack` |
| Line, area, stacked area | ✅ native | `series.type:'line'` + `areaStyle`/`stack` |
| Pie / donut | ✅ native | `series.type:'pie'` |
| **Funnel** | ✅ native | `series.type:'funnel'` (dial→meeting funnel) |
| **Waterfall / bridge** | 🟡 recipe | stacked bar + transparent base ([§2](#2-the-two-in-house-exceptions)); the pipeline waterfall (R6) |
| **Heatmap** (hour × day connect-rate) | ✅ native | `series.type:'heatmap'` + `visualMap` (R5) |
| Cohort / decay lines | ✅ native | multi-series `line` (R7) |
| Scatter / bubble | ✅ native (+ `large` mode) | `series.type:'scatter'`, `symbolSize` for bubble |
| **KPI / big-number** | ❌ → React | styled number + delta ([§2](#2-the-two-in-house-exceptions)) |
| Gauge | ✅ native | `series.type:'gauge'` |
| Sparkline | 🟡 minimal line | tiny line, axes/labels off |
| Combo (bar + line, dual-axis) | ✅ native | mixed series + second `yAxis` |

---

## 4. "think-cell quality" — what we can and can't match

think-cell is loved for auto-maintained decorations. Set expectations honestly: **no OSS JS charting library reproduces its full set out of the box.** ECharts gets the closest.

**What ECharts gives us natively (promise these):**
- **Smart label thinning** — `labelLayout` with `hideOverlap:true` drops colliding labels and `moveOverlap:'shiftY'`/`'shiftX'` nudges them, with `labelLine` leaders. Best-in-OSS, genuinely think-cell-adjacent for pie/scatter/line. *Caveats:* `moveOverlap` needs `labelLayout.x/y` set, doesn't apply in hover/emphasis state, and isn't bulletproof in custom series — so promise **"smart label thinning," not "never overlaps."**
- **In-segment stacked-bar labels** — per-series `label.position:'inside'`. Auto-hiding labels that don't fit a small segment is a manual value/height threshold.
- **Reference / target / goal lines** — `markLine` at a yAxis value (a quota line), average/min/max lines; `markPoint` for max/min callouts; `markArea` to shade a region.

**What is HARD and we will NOT promise for v1:**
1. **Series connectors between stacked columns** (lines linking segment N across adjacent columns). Not native anywhere in OSS; buildable via a `graphic`/`custom` overlay that recomputes on every resize/data change — real engineering.
2. **Automatic CAGR / difference / growth arrows** with auto-positioned labels. Not native; hand-built via `graphic` + `markLine`. Offer only *specific, pre-defined* arrows if at all, never "add an arrow anywhere and it lays out."
3. **Guaranteed zero-overlap labels in every state** (esp. hover, dense stacks). ECharts *reduces* overlap; it doesn't *guarantee* it.
4. **One-click automatic waterfall with computed subtotals and connectors.** Our waterfall is the stacked-bar recipe; subtotal columns and connector lines are our code.

These four are scoped as **individual custom `graphic`/`custom`-series features**, never implied as a suite.

---

## 5. Per-chart parameter surface (the saved-chart config schema)

Every knob a user can set on a report chart, grounded in ECharts' option model + what Metabase/think-cell expose. This is also the `Report.configJson.chart` shape.

**Chart identity**
- Chart type (bar/line/area/pie/donut/funnel/waterfall/heatmap/scatter/gauge/combo/KPI) → `series.type` (+ recipe flag for waterfall/KPI)
- Per-series type override for combos (this series = bar, that = line)

**Series / data mapping**
- X (category/time) field → `xAxis` + `dataset` dimension
- Y measure field(s) → `series.encode.y`
- Group / breakout field → one series per value
- Color-by field → color mapping / `visualMap` (heatmap)
- Size field (bubble) → `symbolSize`

**Axes**
- X/Y axis labels: show/hide, custom text, rotation → `axisLabel`, `name`
- Y min/max (auto or fixed) → `yAxis.min/max`
- Log scale → `yAxis.type:'log'`
- **Dual / secondary Y axis** (combo) → second `yAxis` + `series.yAxisIndex`
- Tick format (number/date) → `axisLabel.formatter`
- Gridlines on/off → `splitLine`

**Legend** — show/hide, position, orientation → `legend`

**Colors / theme** — series palette, per-series override, light/dark theme → `color[]` + registered theme

**Data labels** (the think-cell-relevant surface)
- On/off, and **"all values" vs "some values"** (Metabase's model) → `label.show` + `labelLayout.hideOverlap`
- Position (inside/outside/top/end) → `label.position`
- Number/percent/currency format → `label.formatter`
- Overlap strategy (thin / move / show all) → `labelLayout`

**Stacking** — none / stacked / 100%-stacked → `series.stack` + percent normalization

**Sorting** — by value / by label / original; asc/desc → pre-sort the dataset

**Formatting** — number (decimals, thousands, %, currency); **date/time with an explicit timezone label** per [CLAUDE.md](../../CLAUDE.md) — the server hands ECharts pre-formatted, zone-labeled strings; ECharts never formats a time in server/browser local zone.

**Tooltips** — show/hide, shared vs per-series, custom format → `tooltip.trigger`, `formatter`

**Annotations / reference lines** — target/goal line (`markLine`), trend line, reference band (`markArea`), min/max/avg callouts (`markPoint`)

**Interaction** — click-to-drill event (emits selected category/series back to the app for R2 drill-through), `dataZoom` pan/zoom on long series, legend/label toggles at view time

---

## 6. Performance

- **Canvas renderer by default.** SVG libraries create one DOM node per mark and slow past ~5,000 nodes; a dense scatter or long series would choke them. ECharts canvas does not.
- **Big-data modes:** `sampling:'lttb'` + `dataZoom` for long lines; `large:true`/`largeThreshold` for dense scatter/bar; **progressive rendering** for anything above ~50k points; `TypedArray` input for lower memory.
- **Our surfaces are comfortably in range:** an hour×day heatmap is 168 cells; dashboards hold many small charts. The one real risk is "scatter of every call," handled by `large` mode.
- **React lifecycle — the #1 leak:** an ECharts instance holds a canvas + resources; **forgetting `dispose()` on unmount leaks memory.** Use `echarts-for-react` (disposes for us) or an explicit `useEffect` cleanup. On many-chart dashboards, init lazily on viewport intersection and reuse one registered theme.
- **Bundle:** use **modular imports** (register only used series/components) — ~80–130 KB gzipped tree-shaken, vs ~520 KB for the full build. This is mandatory, not optional.

---

## 7. Export (client-side)

- **PNG** — `getDataURL({type:'png'})` or the toolbox `saveAsImage` (canvas renderer), with `pixelRatio`, `backgroundColor`, `excludeComponents`.
- **SVG** — `getDataURL({type:'svg'})`, but **only when the chart uses the SVG renderer**. So: render canvas by default, switch a chart to the SVG renderer on demand when an SVG export is requested.
- **PDF** — no native ECharts PDF; compose the PNG/SVG into a PDF with jsPDF/pdf-lib client-side.
- **CORS caveat** — a chart embedding a cross-origin image taints the canvas and breaks PNG export; keep chart imagery same-origin/data-URI.
- The **data** behind a chart exports via the report's CSV/XLSX path ([SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md)), not the chart lib.

---

## 8. Implementation rules (bake into the build)

1. **Modular ECharts imports** — register only used series/components (bundle discipline).
2. **Always `dispose()` on unmount** (or use `echarts-for-react`).
3. **Canvas renderer by default;** SVG renderer only when SVG export is requested.
4. **Feed pre-formatted, timezone-labeled date strings** from the server — never let ECharts localize times.
5. **One library.** If million-point scatter ever becomes real, add Plotly.js `scattergl` for *that one view* only — don't switch the app.

---

## 9. Open decisions

1. **KPI tiles & sparklines — pure React vs tiny ECharts.** Recommend **pure React for KPI number+delta**, tiny **ECharts for the sparkline** (reuses the theme). *(Recommend as stated.)*
2. **think-cell decorations (connectors, CAGR arrows) — v1 or later?** Recommend **later**, and scoped as individual `graphic` features, not a suite. v1 ships native labels + reference lines only. *(Recommend later.)*
3. **`echarts-for-react` wrapper vs hand-rolled lifecycle.** Recommend the **wrapper** (handles dispose, the #1 leak). *(Recommend the wrapper.)*

---

## Sources

ECharts features (series, renderers, big-data) — https://echarts.apache.org/en/feature.html · ECharts waterfall recipe — https://echarts.apache.org/handbook/en/how-to/chart-types/bar/waterfall/ · ECharts label overlap (`labelLayout`) issues — https://github.com/apache/echarts/issues/17937 · ECharts mark annotations — https://deepwiki.com/apache/echarts-doc/7.3-mark-annotations · ECharts export/toolbox — https://apache-echarts.mintlify.app/components/toolbox · Highcharts licensing — https://shop.highcharts.com/license · AG Charts Community vs Enterprise — https://www.ag-grid.com/charts/javascript/community-vs-enterprise/ · Metabase best OSS chart library — https://www.metabase.com/blog/best-open-source-chart-library · Data-viz library deep-dive (perf/bundle) — https://www.youngju.dev/blog/culture/2026-05-14-data-visualization-libraries-2026-d3-plot-visx-recharts-echarts-vega-comparison-deep-dive-2026.en · Plotly WebGL/scattergl perf — https://community.plotly.com/t/performance-issues-with-scattergl-plotly-js-v2-35-3-for-large-datasets/90455 · think-cell waterfall/decorations — https://www.think-cell.com/en/resources/manual/chartdecorations

*Note: permissive licenses for Recharts v3 / nivo / visx (MIT) and Observable Plot (ISC) are from the research pass; confirm each repo's LICENSE before relying on it in code.*
