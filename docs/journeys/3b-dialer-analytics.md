# Doc 3b — Dialer analytics

Third of the "at scale" docs (doc 3 = import + call lists + power dial; doc 3a = numbers, SMS, transfer, compliance). Same journey format. Journey numbers are stable across the split — this is still **3.9**.

## The big decision first (your question): dialer analytics is a *subset* of the main reporting, in the same place, on the same tools

**Yes.** You asked whether the dialer's analytics should be a subset of the analytics covered elsewhere, live in the same place in the app, and use the same internal services. **All three: yes.**

- **Same place.** Dialer analytics is **not a separate Analytics page.** It lives inside the **CRM reporting surface** (doc 5 Journeys 5.8 / 5.9 / 5.9a) — the same Reports area, the same navigation.
- **Same tools / internal services.** It uses **doc 5's reporting engine** — the precompute + query-time hybrid, the **F-series rollups**, the saved-`Report` model, and **Apache ECharts** for charts. We do **not** build a second charting stack.
  - *(This corrects the earlier draft, which named Recharts — the app standardized on **ECharts** in doc 5. One chart library.)*
- **Subset.** The general call metrics — **dials / connects / conversations / meetings by day**, and the **dial → meeting funnel** — are already the doc 5 **activity report** (5.8) and pivot (5.9). We **do not rebuild them.** Calls simply feed those reports as activity rows (Connected calls, Dials, etc.).

So this doc only owns the **few number-centric slices doc 5 doesn't model** — and even those **render in the doc 5 reporting UI with ECharts.**

## Journey 3.9 — View the dialer-specific analytics slices

*As a rep or manager, I want to see connect rates by number, area code, and time of day, so that I can protect my number health and call people when they actually pick up.*

1. **Entry point.** In the **Reports** area (doc 5), he opens the **"Dialer"** report group (a set of shipped report templates, like doc 5 Journey 5.9b's presets — just pre-built over dialer dimensions).
2. **The three slices that live here** (everything else is doc 5's activity report / pivot):
   - **Connect rate by NUMBER, area code, and time-of-day** — feeds number health (doc 3a Journey 3.8) and local-presence (3.7) decisions.
   - **Best time-of-day window** to reach a persona/segment — feeds the *Best time to call* field (doc 3a Journey 3.14d).
   - **Per-number health trends** (spam status, answer rate over time) — the Number Health dashboard (doc 3a Journey 3.8).
3. **How the page looks (your ask — the rows and columns).** These render as **standard tables + ECharts** in the doc 5 report shell. The two most useful:

**Connect rate by number** — one row per owned number, sortable:

```
Number            Area   Dials   Connects   Connect %   Spam status   Daily cap
+1 (415) 555-0110  415    412      74          18.0%      clean         200/200
+1 (415) 555-0142  415    388      51          13.1%      flagged ⚠     140/200
+1 (212) 555-0188  212    301      66          21.9%      clean          90/200
──────────────────────────────────────────────────────────────────────────────
Total                    1,101    191         17.3%
```

**Connect rate by time-of-day** — a heat grid (hour × day-of-week), the classic "when do they answer" view, drawn as an ECharts heatmap:

```
          Mon   Tue   Wed   Thu   Fri
 8–10am   14%   19%   17%   22%   11%
10–12pm   21%   24%   26%   25%   15%
12–2pm    12%   13%   11%   14%    9%
 2–4pm    23%   27%   29%   28%   18%    ← best window
 4–6pm    26%   31%   30%   29%   16%
(darker cell = higher connect rate)
```

The **best window** (here, 4–6pm midweek) is what feeds the *Best time to call* field (doc 3a Journey 3.14d), computed nightly.

4. **Scope.** Solo for now — **your own numbers.** Per-rep / team roll-ups are **[LATER]** (they arrive with multi-user), and when they do they're just a **group-by** in the same doc 5 pivot, not a new page.

- **Benchmark (beat this):** Nooks — dialer analytics *(the "connect rate by time of day" heatmap we want — but rendered inside our unified Reports area, not a bolted-on page; marketing page — limited screenshots)* — https://support.nooks.ai/articles/9662500284-nooks-reporting-explained [how it works: which slices Nooks reports and how they are cut] ; the visual bar is a standard hour×day heatmap.
- **Build docs:** reuses doc 5's reporting engine (Journeys 5.8 / 5.9 / 5.9a), **Apache ECharts**, and the F-series rollups; the dialer-specific rollup is job **D6** (below).

---

## Background job

- **D6 — Dialer analytics rollup.** **Trigger:** pg-boss **cron, hourly** (`0 * * * *`) for near-real-time slices, plus **on-demand** when a report is opened with a stale bucket. **Steps:** aggregate only the **dialer-specific** slices doc 5 doesn't model — **connect rate by number / area code / time-of-day** — into `AnalyticsRollup`, **bucketed in the workspace timezone**. The general activity/funnel metrics are rolled up by **doc 5's F-series jobs**, not here — we don't double-aggregate. **pg-boss:** queue `dialer-analytics-rollup`, `retryLimit: 2`, `singletonKey` = workspaceId so overlapping runs coalesce.

---

## Data model (Prisma) — additions in this doc

```prisma
model AnalyticsRollup {    // NEW — precomputed by D6 for the dialer-specific slices only
  id          String   @id @default(cuid())
  workspaceId String
  day         DateTime       // bucket (UTC day; displayed in workspace tz)
  hourOfDay   Int?           // for the time-of-day heatmap (Journey 3.9)
  numberId    String?        // for connect-rate-by-number
  areaCode    String?        // for connect-rate-by-area
  dials       Int      @default(0)
  connects    Int      @default(0)
  @@unique([workspaceId, day, hourOfDay, numberId, areaCode])
}
// General dials/connects/funnel-by-day is doc 5's activity report — not duplicated here.
```

---

## Technology choices (analytics)

- **Charts — Apache ECharts** (the app standard, chosen in doc 5). *Not* Recharts — one chart library across the app. Heatmaps, bars, and line series all come from ECharts.
- **Aggregation — reuse doc 5's precompute + query-time hybrid.** Dialer-specific slices precompute into `AnalyticsRollup` (job D6) for a fast page; ad-hoc filters query at request time — same pattern as doc 5.
- **Timezone — store UTC, bucket + display in the workspace timezone** (the Amplitude model, same as doc 5): ingest every timestamp in **UTC**; **bucket and render in a workspace-set timezone** (seeded from the browser at setup) using a real IANA zone so DST is handled, with a per-report override. Switching the display zone re-buckets on the fly — no rewrite. We do **not** follow the device timezone live (a travelling rep's history would shift) and do **not** lock the zone at setup with no override (GA4's anti-pattern).
