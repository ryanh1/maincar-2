# SPEC — Reporting Engine Architecture & Performance

*Companion deep-dive to [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md) module **R0**. This doc answers: how does a report actually get its numbers? Do we hit Postgres every time or precompute? Do we use the ORM or write SQL? What breaks at scale, and what will we deliberately not promise?*

**Audience note.** [§1](#1-the-core-question-eli5) is written for a non-technical reader. The rest is for whoever builds R0.

---

## 1. The core question (ELI5)

**Question you asked:** *"Are we hitting Postgres constantly, or is there a more performant way?"*

Think of a **coffee shop**:

- **Hitting the database every time = grinding fresh beans for every cup.** Always fresh, but every customer waits, and at rush hour the line backs up.
- **Precomputing = brewing a big urn each morning.** You pour a cup instantly, but it's only as fresh as the last brew, and you spend effort brewing whether or not anyone drinks it.

A report that reads straight from the database on every open is **grinding fresh**. A report that reads from a nightly summary table is **pouring from the urn**.

**Our plan: grind fresh until the line gets too long, then brew an urn for the drinks people order most.** Concretely:

- Most reports run a **live query on Postgres** every time. For the amount of data one customer's account holds (tens of thousands to a few million calls/activities — not billions), a properly-indexed database answers in a fraction of a second. Fresh and simple.
- A **few heavy, popular reports** (things that look back over months of history, like the pipeline waterfall) get a **precomputed summary table** refreshed by a nightly/hourly background job. Instant to open; "fresh as of 2am."

We do **not** start with a separate analytics database or a heavy "semantic layer." Those solve a slowness problem we don't have yet. We add them only if we measure a real need — and the doc says exactly when ([§7](#7-the-precompute-ladder-and-when-to-climb-it)).

---

## 2. Relation to the main spec

R0 in [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md) is the shared aggregation service. This doc specs its **internals**. The other companion specs sit on top: the builder UX ([SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md)) produces the report config this engine compiles; the charts ([SPEC-REPORTING-CHARTING.md](SPEC-REPORTING-CHARTING.md)) render its output.

Stack (unchanged): Express + TypeScript API, PostgreSQL via Prisma, pg-boss for jobs, multi-tenant by `orgId`.

---

## 3. Chosen architecture — config → compiler → parameterized SQL

```
report config (JSON)  ──►  SQL compiler  ──►  parameterized SQL  ──►  Postgres
   (from the builder)       (allowlist +        ($queryRaw /            (live, or
                             registry)           Kysely)                 a rollup table)
                                │
                                └── every cell also compiles to a drill-through row query
```

**Principle:** the report config is **data, never code**. The user picks symbolic field IDs and options; the compiler maps each to a **vetted SQL fragment** from a server-side registry and refuses anything not in the map. No user free-text SQL in v1.

This is the same design Metabase uses: pivots/subtotals are built from a **structured query representation**, not raw SQL — Metabase's own pivot tables only work on query-builder questions, not SQL questions, precisely because the engine must rewrite the query to compute subtotals. We mirror that: **structured config in, compiled SQL out.**

---

## 4. How it works — ORM vs generated SQL

**Question you asked:** *"Are we using an ORM that produces SQL queries?"*

**Short answer: Prisma for normal reads and writes; hand-generated SQL for the analytics.** Prisma (our ORM) is great at "get me this deal and its calls," but it **cannot express** the analytics a report builder needs:

| Reporting need | Prisma? |
|---|---|
| Single group-by with sum/count (`groupBy` + `_sum`/`_count` + `having`) | ✅ yes |
| Multi-dimension pivot with subtotals (`GROUPING SETS` / `ROLLUP` / `CUBE`) | ❌ no |
| % of total / running total / rank (window functions) | ❌ no |
| Conditional measures (`SUM(x) FILTER (WHERE …)`) | ❌ no |
| Nested CTEs, `HAVING` on derived expressions | ❌ no |

So the engine **drops to SQL** for aggregation. Two constraints shape *how*:

- **Prisma's `TypedSQL` (`$queryRawTyped`) does not fit** — it needs static `.sql` files and "cannot handle dynamically constructed SQL: column names, table names, or WHERE clauses built at runtime." Our SQL shape is user-defined at runtime, so TypedSQL is out.
- **We build SQL dynamically**, via either raw `$queryRaw` with parameters, or **Kysely** (a type-safe, composable query builder) for the harder compositions. Recommendation: **Kysely for the compiler's structured parts, `$queryRaw` for the few window/grouping-set fragments Kysely can't model.**

### 4a. The safety rule — you cannot parameterize identifiers

SQL placeholders (`$1, $2`) bind **values**, not table names, column names, sort direction, or aggregate function names. Dynamic `ORDER BY` and dynamic column lists are exactly where injection sneaks back in. **Two-layer rule, enforced in the compiler:**

1. **Every value → a bound parameter.** Never string-concatenate a user value.
2. **Every identifier & keyword → validated against a server-side allowlist.** Columns, tables, `ASC`/`DESC`, `SUM`/`COUNT`/`AVG`, and the time-bucket grain are looked up in a registry; anything not in it is rejected.
3. **`WHERE "orgId" = $n` is injected server-side, always**, from the session — never from client config. This is the tenant isolation guarantee.

### 4b. The metric/dimension registry — our "small query language"

Instead of inventing a query language, we ship a **registry**: for each base object, a table of allowed dimensions and measures.

```ts
// illustrative shape
registry.deal = {
  table: 'Deal',
  dimensions: {
    stage:  { sql: 'stage."name"', join: 'stage', type: 'select' },
    owner:  { sql: 'owner."name"', join: 'owner', type: 'user' },
    closeMonth: { sql: `date_trunc('month', "closeDate" AT TIME ZONE $tz)`, type: 'date' },
  },
  measures: {
    count:        { sql: 'count(*)', additive: true },
    pipelineValue:{ sql: 'sum("amountMinor")', additive: true, money: true },
    weightedFcst: { sql: 'sum("amountMinor" * stage."winProbability" / 100.0)', additive: true, money: true },
    winRate:      { sql: "avg((\"status\"='won')::int)", additive: false },
  },
  joins: { stage: '… PipelineStage …', owner: '… User …' },
}
```

The pivot's field list ([R2](SPEC-REPORTING-ENGINE.md#r2--pivot-builder--advanced-metrics--drill-through-v1)) is generated from this registry **plus** the object's `AttributeDef` rows (schema-as-data) **plus** the user's `ComputedField`s. The config references field IDs; only registry-approved SQL ever reaches the string. **`additive` matters** (see [§7](#7-the-precompute-ladder-and-when-to-climb-it)): additive measures (sum/count/min/max) can be rolled up and re-summed; non-additive ones (avg, exact distinct) cannot, which limits precompute.

---

## 5. The Postgres analytics toolkit (use from day one)

These are query-shape tools, not infrastructure — the compiler emits them directly:

- **`GROUPING SETS` / `ROLLUP` / `CUBE`** — pivot subtotals + grand totals in a single pass. This is how the pivot's row/column subtotals are computed.
- **Window functions** — `SUM(x) OVER ()` for % of grand total, `SUM(x) OVER (PARTITION BY …)` for % of column/row, `SUM(x) OVER (ORDER BY …)` for running totals, `RANK()`/`LAG()` for rank and period-over-period. This is the SQL behind the "Show Values As" transforms in the builder spec.
- **`FILTER (WHERE …)`** — conditional measures like "connected calls" (`count(*) FILTER (WHERE disposition_category = 'connected')`) without a second query.

---

## 6. Timezone correctness — the #1 "the numbers are wrong" bug

Per [CLAUDE.md](../../CLAUDE.md) every displayed time carries an explicit zone. For **bucketing**, the rule is strict:

- Bucket in the **viewer/org IANA zone**, applying `AT TIME ZONE` **before** `date_trunc`:
  `date_trunc('day', "occurredAt" AT TIME ZONE 'America/New_York')`.
- **Never** bucket by UTC day, a numeric offset (`-05:00`), or an abbreviation (`EST`). DST gives one local day a doubled hour and another a missing hour; a fixed offset silently misfiles those, and sub-hour zones (India, parts of Australia) split an hour across two buckets.
- The zone is a **compiler parameter** (`$tz`), set per report/viewer, so switching the display zone re-buckets on the fly with no data rewrite.

This is centralized in the compiler so every report gets it right once. The call-analytics heatmap (hour × day) is the most DST-sensitive surface.

### 6a. Different viewers in the same org, different zones

*Your question: two teammates in one org, one in New York, one in London — whose day is a "day"?*

There are **three candidate zones**, and the report must pick one explicitly, never fall back to the server's:

1. **The report's pinned zone** — the report config can carry a fixed `displayZone` ("always show this report in US/Eastern"). Best for a shared team report where everyone must read the *same* numbers — a London viewer and a New York viewer see identical buckets. This is the default for saved/shared reports.
2. **The viewing user's zone** — each `User` has an IANA `timeZone` (per [CLAUDE.md](../../CLAUDE.md)). A personal report ("my calls today") should bucket in the **viewer's** zone, so "today" means their today. This is the default for personal/"My Pipeline" surfaces.
3. **The accountable user's zone** — for a rep-scoped number a manager views, bucket in the **rep's** zone (their working day), not the manager's. Used where the row is "about" a specific person.

**The rule:** every report declares which of these it uses (`zoneMode: pinned | viewer | subject`), and the compiler resolves it to a concrete IANA string as the `$tz` parameter at query time. **No report ever buckets in the server zone or an ambiguous default.** A header on the report states the zone in use (`Buckets in US/Eastern`) so two teammates never silently compare mismatched days.

**The precompute catch (important).** A rollup table ([§7](#7-the-precompute-ladder-and-when-to-climb-it)) is physically bucketed in **one** zone. A viewer in a different zone **cannot reuse it** without re-bucketing — the day boundaries differ. Three ways to handle it, in preference order:

- **Precompute at a fine grain (hour), re-bucket to the viewer's day at query time.** Store hourly rollups keyed in UTC; sum the right 24 hourly buckets per the viewer's zone on read. Correct for any zone, cheap, and the recommended design for any rollup that feeds multi-zone or personal reports.
- **Pin the report's zone** (mode 1) so the rollup and the report share one zone — then the rollup is reused directly. Correct only for pinned-zone reports.
- **Fall back to live query** for a viewer whose zone doesn't match the rollup's grain. Always correct, slower.

So: **rollups store hour-grain in UTC; day/week/month buckets are assembled per-viewer-zone at read time.** This keeps one shared rollup correct for New York, London, and Kolkata alike. Whole-hour zones are exact; the rare sub-hour zones (India +5:30) mean "day" boundaries fall mid-UTC-hour — handled by keeping the rollup at 15-minute grain only if a sub-hour-zone org exists, else hour grain is enough.

---

## 7. The precompute ladder — and when to climb it

Order of adoption. **Start at rung 1. Climb only on a measured trigger.**

| Rung | Technique | How it works | Climb when |
|---|---|---|---|
| **1** | **Live SQL** (default) | Aggregate the source tables on every load. Always current, zero extra storage. | — start here for every report. |
| **2** | **Incremental rollup tables** (pg-boss) | A real table (e.g. daily counts by owner/stage) upserted from a watermark via `INSERT … ON CONFLICT DO UPDATE`; process only new rows. | A hot report is measurably slow (>~1–2s) **and** its grain is stable. This is our chosen precompute for the waterfall + dashboards (`ReportRollup`, `PipelineSnapshot`, job F4). |
| **3** | **Materialized views** | Postgres stores a query's result; `REFRESH … CONCURRENTLY` (needs a unique index) rebuilds it. No incremental refresh — every refresh is a full recompute. | A report is static, a full nightly recompute is fine, and you want zero app-side maintenance code. Prefer rung 2 when recompute waste or freshness matters. |
| **4** | **DuckDB** (embedded OLAP, MIT) | In-process columnar engine in the Node API; reads only needed columns, vectorized. No server. | For **CSV/Parquet export** and heavy ad-hoc scans over snapshots — offload from Postgres. Not the primary path. |
| **5** | **Cube.dev** (semantic layer) | A service that centralizes metric definitions and does aggregate-aware routing to pre-aggregations it maintains in Cube Store. | Many reports share metrics and you want consistency + caching without hand-rolling every rollup. **Deferred** — it's a second stateful service + a modeling language to own. |

We reject **Malloy** (a modeling *language*, not an embeddable engine for a user-facing builder) and **Superset** (a full BI *app* to deploy, not a library) for the in-app engine.

**Additive measures gate precompute.** A rollup can only answer a query if its measures are additive (sum/count/min/max). `avg` and exact `count(distinct)` are non-additive — either store their components (sum + count, recombine) or accept they stay live. This is why the registry marks `additive`.

---

## 8. Postgres performance techniques & rough thresholds

Adopt in order as data grows. Below ~1M rows/table, good indexes + good SQL are enough.

- **Composite indexes leading with `orgId`**, matching filter+group keys: `("orgId", "occurredAt")`, `("orgId", "ownerUserId", "closeDate")`. **Covering** (`INCLUDE (…)`) → index-only scans for hot rollups. **Partial** (`WHERE "isArchived" = false` / recent window) → smaller, faster for active-row reports.
- **BRIN** on append-only, time-ordered logs (`ActivityEntry`, `FieldHistory`, `Call`): ~99% smaller than B-tree. **Only works if rows are physically time-correlated** — good for append-only feeds. *~10M+ rows.*
- **Declarative partitioning** (range by time) on the big feeds: partition pruning + cheap `DROP PARTITION` for retention. Adds planning/management overhead — *~50–100M rows/table, or when time-based retention is a hard requirement.*
- **Keyset (cursor) pagination for drill-through** — never deep `OFFSET`. Offset is O(n) at depth (~0.28ms at offset 0 → ~138ms at offset 1M) and mis-pages when rows shift. Use `WHERE (sortKey, id) > ($1,$2) ORDER BY sortKey, id LIMIT n` on a matching composite index. *Above a few thousand drill-through rows.*
- **`postgresql-hll` (HyperLogLog)** for distinct-count measures at scale: ~2% error in ~1.3KB, and **mergeable** so it composes with rollups (a reported 7s → 54ms). *When distinct-count measures span millions of rows.*

---

## 9. Hard problems, tradeoffs, and what we will NOT promise

State these out loud in the product, not silently best-effort:

- **"As-of" historical reporting needs snapshots.** "How many deals were in stage X on June 1" cannot come from current-state tables. Salesforce and HubSpot both solve this with **reporting snapshots**, not by replaying history. We do the same: the nightly `PipelineSnapshot` ([main spec §3B-2](SPEC-REPORTING-ENGINE.md#3b--mismatches--needs-the-planned-schema-does-not-satisfy-today)). We do **not** promise arbitrary as-of reconstruction from `FieldHistory` — it's slow and error-prone. `FieldHistory` serves *stage-entry transitions* (via the 3B-1 index), not full point-in-time state.
- **Staleness vs live drill-through won't reconcile intraday.** If a dashboard number comes from a 2am rollup but drill-through reads live rows, the total and the detail differ during the day. Fix: drill through the **same grain**, and **label "as of HH:MM"** everywhere a precomputed number appears. This is the honesty tax on precompute.
- **High-cardinality group-bys** (per-contact, per-phone) produce huge result sets that blow past render limits. Enforce a **max-groups cap** + **top-N + "Other"** bucket. Don't pivot 500k groups into the browser.
- **Cross-object joins fan out.** Deal↔Call↔Activity joins multiply rows and produce wrong sums (a deal counted once per call). Constrain joinable paths in the registry; pre-aggregate one side before joining. No arbitrary N-way joins.
- **Concurrent heavy reports contend with the dialer's OLTP traffic.** Mitigate: `statement_timeout` on report queries, a bounded pg-boss concurrency queue, and (later) a read replica for analytics.
- **Big exports must be async.** A multi-hundred-MB CSV is a pg-boss job that streams via server-side cursor / `COPY` (or DuckDB → CSV) to S3, then returns a link — never a synchronous request. (Export UX lives in [SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md); the async plumbing is here.)

**Explicitly de-scoped in v1:** user free-text SQL; arbitrary as-of history without snapshots; exact distinct on multi-million-row sets (approximate + labeled instead); unbounded cross-object joins; synchronous large exports; sub-minute freshness on any precomputed number.

---

## 10. Recommendation stack (v1)

1. **Engine:** structured report config → allowlist-validated compiler (registry of dimensions/measures with per-field allowed aggregates) → parameterized SQL via Kysely + `$queryRaw`. `orgId` filter injected server-side, always.
2. **SQL features:** `GROUPING SETS`/`ROLLUP`/`CUBE`, window functions, `FILTER`; timezone-correct `AT TIME ZONE` bucketing centralized as a `$tz` compiler param.
3. **Performance:** composite `("orgId", …)` + covering/partial indexes first; BRIN + partitioning on the feeds as they cross ~10M/~50M rows; **incremental rollup tables (pg-boss)** for the waterfall + dashboards; `postgresql-hll` for distinct-count at scale; keyset pagination for drill-through.
4. **Async:** exports + `PipelineSnapshot` + rollups as pg-boss jobs; `statement_timeout` + concurrency cap on live report queries.
5. **Scale-out (documented, deferred):** DuckDB for export/scan offload; Cube.dev if shared-metric caching becomes necessary; read replica for analytics isolation.

---

## 11. Open decisions

1. **Query builder library — Kysely vs raw `$queryRaw` only.** Recommend **Kysely** for type-safe composition of the structured parts, with `$queryRaw` for window/grouping-set fragments. *(Recommend Kysely; it's MIT and composes cleanly with a compiler.)*
2. **First precompute target.** Recommend the **pipeline waterfall + its `PipelineSnapshot`** (rung 2) as the only precompute in v1; everything else stays live until measured. *(Recommend as stated.)*
3. **Read replica** — defer until concurrent-report contention with the dialer is measured. *(Recommend defer.)*

---

## Sources

Cube pre-aggregations — https://docs.cube.dev/reference/data-modeling/pre-aggregations · Cube semantic layer — https://cube.dev/blog/what-the-heck-is-the-semantic-layer · Citus materialized views vs rollup tables — https://www.citusdata.com/blog/2018/10/31/materialized-views-vs-rollup-tables/ · Stormatics Postgres materialized views — https://stormatics.tech/blogs/postgresql-materialized-views-when-caching-your-query-results-makes-sense · Prisma raw queries — https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries · Prisma TypedSQL — https://www.prisma.io/blog/announcing-typedsql-make-your-raw-sql-queries-type-safe-with-prisma-orm · Limitations of Prisma for analytics — https://losefor.medium.com/the-limitations-of-prisma-as-an-orm-for-analytics-228cb91d9eed · Metabase pivot tables — https://www.metabase.com/docs/latest/questions/visualizations/pivot-table · Metabase pivot + SQL limitation — https://github.com/metabase/metabase/issues/19862 · SQL injection / allowlist identifiers — https://datadriven.io/sql/injection-cheat-sheet · Postgres GROUPING SETS/ROLLUP/CUBE — https://www.enterprisedb.com/postgres-tutorials/how-use-grouping-sets-cube-and-rollup-postgresql · Crunchy BRIN — https://www.crunchydata.com/blog/postgresql-brin-indexes-big-data-performance-with-minimal-storage · Postgres partitioning — https://www.postgresql.org/docs/current/ddl-partitioning.html · Keyset pagination — https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/ · DuckDB vs Postgres embedded — https://motherduck.com/learn/duckdb-vs-postgres-embedded-analytics/ · Postgres HLL distinct count — https://docs.citusdata.com/en/stable/articles/hll_count_distinct.html · Timezone grouping in Postgres — https://tunasakara.com/en/blog/multi-timezone-grouping-postgresql · Salesforce point-in-time snapshots — https://elevation.solutions/resources/salesforce-point-in-time-reporting-with-reporting-snapshots/
