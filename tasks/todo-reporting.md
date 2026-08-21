# TODO — Reporting Engine (checklist)

Full plan + acceptance criteria: `tasks/plan-reporting.md`. Boxes map 1:1 to Linear issues. Mobile (R13) deferred.

## P1 — Reporting v1: Core Engine & Pivot Builder
- [ ] P1.1 Engine skeleton: one correct number (Deals group-by-sum, org-scoped)
- [ ] P1.2 Make the engine safe (allowlist + org filter + injection/isolation tests)
- [ ] P1.3 Reports home + save/open/rename/delete
- [ ] P1.4 Pivot builder — drop zones + live grid + subtotals
- [ ] P1.5 More measures (count/avg/distinct/median/percentile)
- [ ] P1.6 "Show values as" + MoM/YoY toggle + selective summary rows
- [ ] P1.7 Charts (ECharts + on-element contextual controls)
- [ ] P1.8 Stop bad charts (validation + auto-suggest)
- [ ] P1.9 Drill-through to real records (reconciles to the cell)
- [ ] P1.10 Export (CSV/XLSX + async job + drilled rows)
- [ ] P1.11 Sharing + permissions (view-by-link, editors, visibility seam)
- [ ] P1.12 Empty states + guidance
- [ ] P1.13 Time zones (pinned/viewer/subject; DST-safe)
- [ ] P1.14 Test + guardrail harness (fixtures, truth suite, budgets, caps)
- [ ] **Checkpoint A** — build → chart → drill → export → share, all correct

## P2 — Reporting v1: Standard Reports, Activity & Call Analytics
- [ ] P2.1 Template gallery + seeded templates
- [ ] P2.2 Activity grid — event counts
- [ ] P2.3 Activity grid — stage moves + conversions (+ FieldHistory index)
- [ ] P2.4 Call dispositions CRUD + log on a call (coordinate w/ dialer spec)
- [ ] P2.5 Connect-rate by number & area (+ rollup job)
- [ ] P2.6 Connect-rate heatmap (best time to call)
- [ ] **Checkpoint B** — v1 reporting release

## P3 — Dashboards & My Pipeline (later)
- [ ] P3.1 Dashboard + report tiles (grid saves)
- [ ] P3.2 Text blocks
- [ ] P3.3 Board filters + current-user + refresh
- [ ] P3.4 Cross-filter (fast-follow)
- [ ] P3.5 My Pipeline home
- [ ] **Checkpoint C**

## P4 — History, Formulas & Delivery (later)
- [ ] P4.1 Nightly pipeline snapshot + job
- [ ] P4.2 Pipeline waterfall
- [ ] P4.3 Cohort / decay report
- [ ] P4.4 Formula fields — write & preview
- [ ] P4.5 Formula fields — recalc + cycle detection
- [ ] P4.6 Scheduled delivery
- [ ] P4.7 Live spreadsheet sync
- [ ] P4.8 Member profiles
- [ ] **Checkpoint D**

## Deferred
- [ ] R13 mobile — much later
- [ ] Forecasting — owned by deal-board/forecasting spec
