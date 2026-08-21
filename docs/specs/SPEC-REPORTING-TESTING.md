# SPEC — Reporting Testing & Guardrails

*Companion to [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md). Answers "for all parts, what testing and guardrails do we need?" Covers the test strategy per layer, the **runtime guardrails** (not just tests), and the per-module Definition of Done. Guardrails here back the edge-case and error catalogs in [SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md) §7b–7c and the perf/tradeoff limits in [SPEC-REPORTING-ARCHITECTURE.md](SPEC-REPORTING-ARCHITECTURE.md) §8–9.*

**The gate is [CLAUDE.md](../../CLAUDE.md)'s:** `npm run verify` (typecheck + lint + test + **integration**) green before every commit. Reporting adds specific suites below; a feature ticket carries its own tests, committed together.

---

## 1. Why reporting needs more than usual

Reporting has three failure modes that are worse than a normal feature bug:

1. **Silently wrong numbers.** A report that renders a *plausible but incorrect* total is more dangerous than one that errors — a rep makes a decision on it. Correctness tests are non-negotiable.
2. **A cross-tenant leak.** Dynamic SQL over multi-tenant data is the highest-risk surface in the app. One missing `orgId` filter exposes another org's pipeline.
3. **A runaway query.** A user config can ask Postgres for a 500k-group pivot that starves the dialer's OLTP traffic.

The strategy below is organized around preventing exactly these three.

---

## 2. Correctness — the aggregation truth suite

**The core suite: for each measure/transform, a fixture dataset with a hand-computed expected result.** The engine's output must equal the hand-checked answer.

- **Golden fixtures.** A seeded org with known Deals/Calls/Activities/FieldHistory whose sums, counts, distincts, medians, percentiles, and stage-entry counts are computed by hand (or a trivially-correct reference), stored as expected values. Every aggregation runs against them.
- **Transform tests.** Each "Show Values As" (% of row/column/grand/parent, running total, rank, index) and each PoP (MoM/QoQ/YoY) has a fixture where the expected % is hand-derived. Divide-by-zero cases assert `—`, never `NaN`/`Infinity`.
- **Subtotal/grouping-set tests.** Nested-row subtotals and grand totals equal the sum of their children; `GROUPING SETS`/`ROLLUP` output matches a hand pivot.
- **Stage-entry & cohort tests.** "Entered stage X in week W" ties to seeded `FieldHistory` transitions; cohort triangles match hand-counted decay.
- **Reconciliation test (the big one).** For any report, **the drilled-through rows sum back to the aggregate cell.** A cell that says 42 must drill to rows that re-aggregate to 42 — enforced as a property test across random configs.
- **Rollup == live parity.** For every additive measure, the precomputed `ReportRollup`/hourly rollup must equal the live query for the same window. A drift test runs both and asserts equality (within the documented staleness window).

---

## 3. Security — tenant isolation & injection

**This suite blocks the cross-tenant leak and the injection.**

- **Tenant-isolation tests.** For every report endpoint and every base object: seed two orgs, run org A's report as an org A user, assert **zero** org B rows appear. A parametrized test sweeps all object types and all join paths. The `WHERE "orgId" = $session` injection (architecture §4a) is asserted present in the compiled SQL, not just trusted.
- **Compiler allowlist tests.** Feed the compiler configs that reference **non-registry** identifiers (a raw column name, a `; DROP TABLE`, an unlisted table/aggregate/sort direction) and assert each is **rejected**, never emitted into SQL. Fuzz the config with hostile field IDs, sort keys, and grain strings.
- **Parameterization tests.** Assert every *value* is a bound parameter (`$n`) and no user value is string-concatenated — checked by inspecting the emitted query + params.
- **Drill-through visibility.** A viewer without access to a record must never see it in a drill-through, even when the aggregate counted it. Seed a restricted record; assert the aggregate includes it but the drill excludes it (row-level visibility, per R1/architecture §9).
- **Export visibility & audit.** An export obeys the same row-level visibility, and every export is written to the audit log (it distributes data).

---

## 4. Timezone / DST correctness

- **Bucketing tests** across zones: the same UTC timestamps bucket differently in `America/New_York`, `Europe/London`, `Asia/Kolkata` (+5:30), and each matches a hand-computed local-day assignment.
- **DST-transition fixtures:** a call at the "spring forward" gap and the "fall back" doubled hour lands in exactly one correct local bucket. Assert no call is dropped or double-counted across a DST week.
- **Per-viewer tests** (architecture §6a): the same report in `zoneMode: viewer` produces different buckets for a NY vs London viewer; `zoneMode: pinned` produces identical buckets for both; the hourly-rollup re-bucketing sums to the same total as a live query in each viewer's zone.
- **No-server-zone assertion:** a report with no resolved zone is **blocked**, and a test asserts the engine never falls back to the process timezone.

---

## 5. Config validation — won't-compute & chart errors

Every case in [builder-UX §7b](SPEC-REPORTING-BUILDER-UX.md#7b-wont-compute--wont-work--the-edge-cases) and [§7c](SPEC-REPORTING-BUILDER-UX.md#7c-chart-configuration-errors--anticipate-and-prevent) gets a test that the config is **caught before it runs** and returns a plain-language reason + fix, not a SQL error or a wrong number:

- Non-numeric aggregation blocked; high-cardinality prompts top-N; join fan-out warns/switches to `COUNT(DISTINCT)`; non-additive-in-running-total warns; PoP-without-date disabled; mixed-currency blocked; too-large routes to async export.
- Chart-shape mismatches (pie with negatives, line on unordered X, KPI on multi-row, dual-scale) are caught at the table→chart step and steer to the recommended chart — asserted per row of the §7c table.

---

## 6. Performance — budgets & guardrails

**Guardrails are runtime limits, enforced in code — tests assert they hold.**

| Guardrail | Runtime enforcement | Test |
|---|---|---|
| Query timeout | `statement_timeout` on every report query | a deliberately heavy query aborts, returns a friendly error, doesn't hang |
| Concurrency cap | bounded pg-boss/report queue | N concurrent heavy reports don't starve OLTP; excess queues |
| Max-groups cap | reject/prompt top-N above the cap | a per-contact pivot is capped, not rendered to 500k rows |
| Drill pagination | keyset (not OFFSET) | a deep drill page stays fast; assert keyset SQL is used |
| Async large export | over-cap export → pg-boss job to S3 | a big export returns a job+link, never a synchronous timeout |
| Bundle | modular ECharts imports | a bundle-size check keeps the chart chunk within budget |

- **Perf budget tests** on the golden fixtures at a realistic size (e.g. 1M activities/org): the common reports return under a target (e.g. p95 < 1s live). A regression that blows the budget fails CI.
- **Rollup necessity** is measured, not assumed (architecture §7): a report only gets a rollup after a live-query budget test shows it's needed.

---

## 7. Jobs & data integrity

- **Idempotency:** F4 (snapshot + rollup), D6 (dialer rollup), `report-deliver` are idempotent per their keys — a re-run never double-writes a snapshot or double-sends a subscription. Tested by running each job twice and asserting one effect.
- **Snapshot monitoring:** nightly `PipelineSnapshot` row-count vs expected open-deal count; a drop (a missed org) alerts. Tested with a seeded org that's skipped.
- **Money:** `amountMinor` sums stay integer minor units; a mixed-currency sum is blocked or converted with a stated rate (never blind addition) — asserted.
- **Formula fields (R10):** parser rejects unknown functions/fields; recalc fires when a referenced field changes; no raw `eval` path exists (a test greps the evaluation path); a formula referencing a renamed field errors gracefully in preview.

---

## 8. UI & journey tests

- **Component tests** for the builder (drop zones, contextual controls, Show-Values-As menu, chart config), empty states, and drill-through drawer.
- **Empty-state tests:** each zero-data moment ([builder-UX §7d](SPEC-REPORTING-BUILDER-UX.md#7d-empty-states--in-app-guidance)) renders the guidance + next action, not a blank/spinner.
- **Browser journey walk** (per CLAUDE.md — a route is a string, click it): a rep opens Reports → builds a pivot → toggles a chart → drills to rows → exports → saves. Verified live in the preview, not just in isolation.
- **Mobile (R13) is deferred** — no phone-width pass is required for v1; desktop web is the target. When R13 is picked up, add the responsive passes then.

---

## 9. Definition of Done (per reporting module)

A reporting module is done when:

1. **Correctness:** its aggregations/transforms match hand-checked fixtures; drill-through reconciles to the aggregate.
2. **Isolation:** tenant-isolation + allowlist + drill-visibility tests pass.
3. **Timezone:** buckets correctly across zones incl. a DST week; no server-zone fallback.
4. **Validation:** its won't-compute and chart-error cases are caught with plain-language guidance.
5. **Performance:** meets the budget on realistic-size fixtures; guardrails (timeout, cap, async export) hold.
6. **UI:** component tests + empty states + a live browser journey walk (desktop web; mobile/R13 deferred).
7. **Gate:** `npm run verify` green; tests committed with the feature.

---

## 10. Open decisions

1. **Perf-budget fixture size for CI.** Recommend a **1M-activity/org** seeded fixture for p95 budget tests (large enough to catch regressions, small enough for CI). *(Recommend 1M; revisit if CI time bloats.)*
2. **Property-based reconciliation testing.** Recommend adding a **property test** that random-generates configs and asserts drill-sum == aggregate — the highest-leverage correctness guard. *(Recommend yes.)*
3. **Where tenant-isolation tests live.** Recommend the **integration suite** (needs Postgres), since it's the concurrency/isolation guardrail CLAUDE.md already treats as the real gate. *(Recommend integration suite.)*
