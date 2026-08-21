# SPEC — Dashboards

*Companion deep-dive broken out of [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md) module **R8** (§13 flagged the layout/refresh engine as under-specified). Owns named boards of report tiles + text blocks: the layout engine, refresh, dashboard-level filters/cross-filtering, sharing, mobile, and performance. Also the substrate for **My Pipeline** (R12).*

---

## 1. What a dashboard is

A **dashboard** is a named board holding **report tiles** and **rich-text blocks** on one drag/resize grid, so a stakeholder reads the story, not just the charts.

**Entry point.** Navbar **Dashboards** → a list of the user's + shared dashboards → **+ New dashboard**; or from any open report, **Add to dashboard**.

**Beats Attio on two things** Attio lacks: **text/annotation blocks**, and an explicit **Refresh** with an "as of" stamp.

---

## 2. Build & arrange

1. **Create + title.** New dashboard opens blank with an editable **title** + optional **description**.
2. **Add report tiles.** **Add report** → pick a saved report (or build one inline) → drops as a tile showing the report's chart/table live.
3. **Add text/content blocks (beats Attio).** **Add text** → a rich-text block (**TipTap**, the same editor as notes) for headings, commentary, an exec summary above the numbers. Tiles and text blocks share one grid.
4. **Arrange.** Every tile and text block is **drag-to-move and drag-to-resize** on a snap grid; layout saves per dashboard (`ReportWidget.layoutJson`).
5. **Refresh (beats Attio).** Tiles read precomputed rollups (job F4) and show an **"as of HH:MM TZ"** stamp. A **Refresh** button (whole board, or per tile) forces a recompute and restamps — a live review can pull the latest without reloading the app.

---

## 3. The layout engine

- **Grid model:** a responsive snap grid (12-column desktop). Each widget stores `{x, y, w, h}` in `ReportWidget.layoutJson`. **Library:** `react-grid-layout` (MIT) or equivalent — draggable/resizable, responsive breakpoints built in.
- **Tiles and text share the grid** (one `ReportWidget` model, `kind: report | text`), so you can caption a chart, section the board, or write a summary between rows.
- **Responsive/mobile (R13) is deferred** (much later). R8 v1 targets desktop web; the single-column phone reflow and mobile drill/refresh land when R13 is picked up — **not** part of R8's v1 Definition of Done. Store layout in a way that can later carry per-breakpoint values.
- **Empty dashboard** shows the guidance pattern ([builder-UX §7d](SPEC-REPORTING-BUILDER-UX.md#7d-empty-states--in-app-guidance)): "Add your first report" + template suggestions, not a blank grid.

---

## 4. Dashboard-level filters & cross-filtering

*The feature that makes a dashboard interactive rather than static — Metabase's model.*

- **Dashboard filters (parameters).** A dashboard can carry shared filters (date range, owner, stage, segment) rendered as controls at the top. Setting one **applies to every tile** whose base object has that field — so one date-range control re-scopes the whole board.
- **Per-viewer / "Current user" filter.** A filter can resolve to **the viewing user** (`ownerUserId = me`) — the Attio "Current user" pattern that powers **My Pipeline** (R12): one dashboard definition personalizes for every rep.
- **Cross-filtering (click-to-filter).** Clicking a bar/slice on one tile can **filter the rest of the board** to that value (a per-tile click-behavior setting: open drill menu / update a dashboard filter / go to a destination). Off by default; opt-in per tile.
- **Timezone:** dashboard date filters and tile buckets follow the report/viewer zone rules ([architecture §6a](SPEC-REPORTING-ARCHITECTURE.md#6a-different-viewers-in-the-same-org-different-zones)); the board header states the zone in use.

---

## 5. Refresh & data freshness

- Tiles read **precomputed rollups** where available (F4) and show **"as of HH:MM TZ."** Live-only tiles compute on load.
- **Refresh** (board or tile) forces a recompute and restamps. Throttled so a mash of the button doesn't stampede Postgres.
- **Staleness honesty:** a tile's number and its drill-through reconcile — drill reads the same grain or the "as of" makes the gap explicit ([architecture §9](SPEC-REPORTING-ARCHITECTURE.md#9-hard-problems-tradeoffs-and-what-we-will-not-promise)).

---

## 6. Sharing & permissions

Identical to reports (see [SPEC-REPORTING-SHARING-AND-PERMISSIONS.md](SPEC-REPORTING-SHARING-AND-PERMISSIONS.md)):

- **View = any org member with the link.** **Edit = owner + `editors[]`.**
- **Each tile's drill-through obeys row-level record visibility** — a tile shows the aggregate but drills only to records the viewer may see, with the honest "some records hidden" note.
- **No anonymous/public links in v1.**

---

## 7. Performance

Many tiles = many queries — the dashboard is where the reporting engine gets stress-tested.

- **Lazy-load on viewport intersection** — tiles below the fold don't query until scrolled to.
- **Share rollups** — tiles over the same rollup reuse it; the board doesn't re-aggregate the same data per tile.
- **ECharts lifecycle discipline** — dispose on unmount, one registered theme, modular imports ([charting §6](SPEC-REPORTING-CHARTING.md#6-performance)).
- **Refresh throttling + a concurrency cap** so a board refresh doesn't starve the dialer's OLTP.
- **Widget cap / warning** on a pathologically large board.

---

## 8. Data model

`Dashboard` + `ReportWidget` from the master spec, with the filter/refresh additions:

```prisma
model Dashboard {
  id          String  @id @default(cuid())
  orgId       String
  title       String
  description String?
  ownerId     String
  editors     String[]
  pinnedToProfileUserId String?     // set when saved to a profile (R9)
  filtersJson Json     @default("{}") // dashboard-level filters/parameters (§4), incl. "current user"
  isSeeded    Boolean  @default(false) // e.g. the My Pipeline template (R12)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([orgId])
}

model ReportWidget {
  id          String  @id @default(cuid())
  orgId       String
  dashboardId String
  kind        String            // report | text
  reportId    String?           // when kind=report
  textJson    Json?             // TipTap, when kind=text
  layoutJson  Json              // {x,y,w,h} per breakpoint
  clickBehavior Json?           // drill | cross-filter | destination (§4)
  @@index([orgId, dashboardId])
}
```

---

## 9. My Pipeline (R12) rides this

[R12 My Pipeline](SPEC-REPORTING-ENGINE.md#r12--my-pipeline-home-near-term-differentiator) is a **seeded `Dashboard`** (`isSeeded=true`) with a **`filtersJson` "current user"** filter and `zoneMode: viewer`. It needs from R8: the grid, per-viewer filters, and mobile reflow. **If full R8 slips, a lite single-page version** (a fixed set of tiles, no drag-arrange) can ship R12 earlier — the tiles reuse R0/R2, only the arrange/persist layer waits.

---

## 10. Edge cases

- **A tile's report is deleted** → the tile shows "This report was deleted" with a remove action, not a crash; deleting a report warns when it's on N dashboards.
- **A tile the viewer partly can't see** → aggregate renders, drill respects visibility (§6).
- **Resizing on mobile** → single-column reflow; no horizontal scroll.
- **A cross-filter that empties every tile** → each tile shows its empty state, board stays usable.
- **A dashboard filter for a field a tile's object lacks** → that tile ignores the filter (documented), rather than erroring.
- **Owner leaves** → ownership transfers to an admin (permissions spec §9).

---

## 11. Testing (see [SPEC-REPORTING-TESTING.md](SPEC-REPORTING-TESTING.md))

- Layout persists and reloads (desktop; mobile/R13 deferred).
- A dashboard filter re-scopes every applicable tile; a cross-filter click updates the board.
- "Current user" filter renders the viewer's own data for two different viewers.
- Each tile's drill-through obeys row-level visibility.
- Refresh restamps "as of"; throttling holds under rapid refresh.
- Lazy-load: below-fold tiles don't query until scrolled.
- A deleted-report tile degrades gracefully.

---

## 12. Open decisions

1. **Layout library.** Recommend **`react-grid-layout` (MIT)** — mature, responsive, draggable/resizable. *(Recommend it.)*
2. **Cross-filtering in R8 v1 or fast-follow.** Recommend **dashboard filters in v1, click-to-cross-filter as a fast follow** (it's the interactive flourish, not the core). *(Recommend fast-follow.)*
3. **My Pipeline path.** Recommend the **lite single-page R12 first** (ships rep-love sooner), then fold it into full R8 dashboards. *(Recommend lite-first.)*
