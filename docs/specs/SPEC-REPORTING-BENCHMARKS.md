# SPEC — CRM Reporting Benchmarks & What Reps Actually Want

*Companion to [SPEC-REPORTING-ENGINE.md](SPEC-REPORTING-ENGINE.md). Not a build spec — a **positioning and gap** spec. It answers: who is best at CRM reporting, what reps love and hate, who the credible experts are, and the concrete gaps we should beat. Use it to prioritize the roadmap and to keep the other specs honest about *why* a feature matters.*

---

## 1. The one-line thesis

**CRM reporting is a solved problem for charts and an unsolved problem for people.** Every incumbent sits on one side of a fault line:

- **Powerful but gated** — Salesforce, CRM Analytics, Outreach: anything is possible, but not without an admin/analyst.
- **Easy but shallow** — Pipedrive, Close, Salesloft, HubSpot standard reports: a rep can use them, but they hit a low ceiling fast.

The tools reps genuinely **love** are the **specialists** that answer one question with zero setup: **Gong** (call analytics), **Clari** (pipeline waterfall), **Nooks** (dialer analytics). The universal fallback when the CRM builder fails is **"export to a spreadsheet."**

**Our opportunity: collapse the fault line.** Give an individual rep self-serve, pivot-fast, drill-to-the-record reporting on **live** data, on mobile, with the point-in-time snapshots and best-time-to-call intelligence that today only the specialist tools offer — **without a RevOps ticket.**

---

## 2. The landscape (strength · weakness · standout)

| Tool | Best at | Real weakness | Standout to steal |
|---|---|---|---|
| **Salesforce Reports & Dashboards** | Breadth (joined reports, report types) | Almost nothing non-trivial without an admin; slow at scale; widgets desync; crippled mobile | — |
| **Salesforce CRM Analytics** | "Real BI" depth | Complex + expensive; JSON-editing dashboards; weak blending | — |
| **HubSpot custom report builder** | No-code drag-drop; smart-chart auto-suggest; great sharing | **2-property axis cap**; 1,000-row cap on non-table; thin custom-object reporting; tier-gated | The 2-minute no-training report |
| **Attio reports & dashboards** | Fast, data-first, any IC builds it | No calculated metrics across aggregates; **no historical backfill**; export limited | **"Current user" filter** → one dashboard personalizes per rep |
| **Clari** | Pipeline waterfall + forecasting | Priced for leadership; forecast logic a black box | **The waterfall + point-in-time snapshots** (gold standard) |
| **Gong** | Call/deal analytics | Brittle keyword trackers; ~60-min lag; weak forecasting; export limits | **Talk-ratio / monologue / interactivity tied to outcomes** |
| **Nooks** | Dialer/activity analytics | Narrow scope; premium price | **Connect-rate + best-window analytics that change behavior tomorrow** |
| **Outreach / Salesloft** | Sequence depth / clean simplicity | Outreach needs an ops resource; Salesloft less customizable | Outreach = depth; Salesloft = zero-training clarity |
| **Pipedrive** | "Reps actually use it" dashboards | Shallow for multi-object analysis | **Personal, per-rep dashboards that feel like *mine*** |
| **Close** | Funnel + velocity out-of-the-box | Limited depth beyond built-ins | Opportunity funnel + sales velocity with no build |

---

## 3. What reps LOVE (design toward these)

- **Leaderboards & visible competition** — reps increase effort and copy top performers when metrics are visible.
- **A personal "My Pipeline"** — their deals, their activity, their progress-to-goal (Pipedrive per-rep dashboards; Attio "Current user").
- **Controllable leading indicators** — in a slump, reps want the causal activity they *can* move (response rate, booked meetings), not last quarter's result.
- **Call analytics they use to get better** — seeing their own talk-ratio, sharing snippets (Gong onboarding is loved by reps).
- **Best-time-to-call intelligence** — connect rate by day/hour/attempt; *their* windows beat generic benchmarks.
- **Volume dashboards that make effort feel rewarded** — raw grind → visible pipeline impact (Nooks).

**Pattern:** reps love reporting that is **personal, competitive, real-time, low-friction, and behavior-changing** — never reporting they must request or build.

---

## 4. What reps & RevOps HATE (design against these)

- **"I just export to a spreadsheet anyway"** — the universal tell that the builder failed.
- **You need an admin to build anything** — the gatekeeper bottleneck; RevOps drowns in "small" report requests.
- **Can't ask complex questions** — nested queries, better filters, multi-dimension — the r/salesforce plea.
- **Stale / out-of-sync data** — desynced widgets; ~60-min call lag.
- **Slow** at scale.
- **Rigid, low ceilings** — HubSpot's 2-axis / 1,000-row caps; Attio's no-calculated-metrics / no-backfill.
- **Bad mobile** — Salesforce mobile can't drill or pull-to-refresh properly.
- **No point-in-time history** — spreadsheets and most CRMs lose "what did the pipeline look like last month" (why teams buy Clari).
- **Licensing cost / gating** of the good stuff.
- **Brittle "AI" / keyword trackers** — miss meaning when phrasing shifts, creating false confidence.
- **Export constraints** — flattened or blocked exports.

---

## 5. The experts (who to trust, and their doctrine)

- **Peter Kazanjy** — "data-driven sales management"; *Founding Sales*; Modern Sales Pros + Atrium. **Doctrine:** a disciplined metrics hierarchy — **activity → output → outcome**.
- **Kevin "KD" Dorsey** — modern sales leadership. **Doctrine:** *"results live in the past; coach the causal metrics."* Find the one metric that most moves results per rep and improve it each quarter → **leading-indicator dashboards over vanity revenue charts.**
- **Kyle Coleman** (ex-Clari, ex-Looker) — "what great looks like" (WGLL) frameworks; operationalizing metrics.
- **Chris Orlob & Devin Reed** (Gong Labs alumni) — **doctrine:** *data over opinion* — benchmark against real conversation data (talk-ratio, monologue length, discovery-question counts), not gut.
- **RevOps practitioners** — Rosalyn Santa Elena, Jeff Ignacio, Taft Love (Iceberg), Ryan Milligan (QuotaPath), Anne Pao.
- **Publications to mine:** Gong Labs, Sales Hacker, The GTM Newsletter, Iceberg RevOps, The RevOps Collective.

**Where the experts agree good ≠ bad reporting:** (1) **fewer KPIs tied to revenue** — a polished report on bad data is *more* dangerous than a rough one; (2) **build for the reader/decision**, not the builder; (3) **leading over lagging**; (4) **cadence matches the metric** (no daily report for a monthly metric); (5) **trust the source** — validate before trusting a pretty output.

---

## 6. The gaps we should beat (each tied to a real complaint/expert view)

1. **Self-serve by the rep, no admin ticket** — any rep builds a real report in <60s. *(Beats SF/Outreach/CRM Analytics.)*
2. **Pivot-native, not axis-capped** — in-product pivot (drag rows/cols/measures, multi-dimension, calculated fields) so no one leaves for Excel. *(Beats HubSpot 2-axis, Attio no-calc.)* → [SPEC-REPORTING-BUILDER-UX.md](SPEC-REPORTING-BUILDER-UX.md)
3. **Drill from any cell to the records** — zero-config drill-through; no dead-end reports. *(Beats SF mobile drill limits.)* → builder-UX §5
4. **Point-in-time snapshots + a pipeline waterfall, built-in and free** — the one thing spreadsheets can't do and the reason teams buy Clari. *(Beats every CRM that loses commit history.)* → main spec R6 + §3B-2
5. **Live data, always fresh, with an "as of HH:MM TZ" stamp** — no 60-min lag, no desynced widgets, trust made explicit. *(Beats Gong lag, SF desync.)* → architecture §9
6. **Fast at scale** — sub-second on large orgs; data volume never punishes. *(Beats SF slowness.)* → architecture §8
7. **A real "My Pipeline" home per rep** — personal, competitive, goal-pacing, leaderboard, by default (one dashboard, per-user filter). *(Matches the strongest rep-love; beats company-centric dashboards.)* → main spec R8/R9
8. **Best-time-to-call / activity intelligence in the CRM** — connect rate by day/hour/attempt with a "call these now" nudge. *(Beats generic CRMs.)* → main spec R5
9. **First-class mobile** — full drill, refresh, personal dashboards on a phone.
10. **Export that isn't a punishment** — one-click CSV/Sheets of the *actual* rows + the styled view; live Excel-pivot; ideally a Sheets sync so "I export anyway" becomes "it's already synced." *(Beats Attio/Gong export limits.)* → builder-UX §6
11. **Leading-indicator templates out of the box** — activity→output→outcome dashboards (Dorsey/Kazanjy), so managers coach causes not corpses. → main spec R3
12. **Natural-language question → report, grounded** — writes a real query against the model and shows the drill-through (removes the admin without inventing numbers, avoiding Gong-tracker brittleness). *(Later; answers the "let me ask my data" plea.)*

**Roadmap read:** items 1–4, 5, 6, 8, 11 are already reflected in the v1/near-term modules; **7 (My Pipeline), 9 (mobile), 10 (Sheets sync), 12 (NL→report)** are the differentiators to slot deliberately — 7 and 10 are the highest rep-love-per-effort.

---

## 7. Benchmark features to match or beat (with links)

| Feature | Owner | Match/beat |
|---|---|---|
| Pipeline waterfall (change by driver, snapshots) | Clari — https://www.clari.com/blog/new-from-clari-next-level-analytics-for-revenue-leaders/ | Ship free + built-in; let a **rep** run it on their own book. |
| Excel-style pivot ease | Excel / Pipeliner — https://help.pipelinersales.com/en/articles/2728834-reports-creating-a-standard-table-report-or-a-pivot-table-report | Native pivot + calculated fields; beat HubSpot's 2-axis cap. |
| Zero-config drill-through | Metabase — https://www.metabase.com/features/drill-through | Every cell → underlying records + one hop to the record page. |
| Call analytics (talk-ratio, monologue, interactivity) | Gong — https://www.gong.io/blog/talk-to-listen-conversion-ratio | Surface per rep in-CRM; fix Gong's brittleness + 60-min lag. |
| Data-first dashboards + "Current user" | Attio — https://attio.com/help/reference/managing-your-data/dashboard-and-reports/build-a-sales-reporting-dashboard | Match speed; beat with calculated metrics + historical backfill. |
| No-code custom report builder | HubSpot — https://knowledge.hubspot.com/reports/create-reports-with-the-custom-report-builder | Match the UX; beat the axis/row/cross-object caps. |
| Dialer/activity analytics | Nooks — https://www.nooks.ai/blog-posts/nooks-review-top-rated-outbound-dialer-software | Bring best-time-to-call + connect-rate into the reporting layer. |

---

## 8. Sources

**Salesforce:** billion-dollar-complaint analysis — https://mihais7.substack.com/p/the-billion-dollar-complaint-a-single · report performance — https://help.salesforce.com/s/articleView?id=sf.improving_report_performance.htm · mobile analytics limits — https://help.salesforce.com/s/articleView?id=sf.limits_mobile_sf1_analytics.htm · CRM Analytics (Gartner) — https://gartner.com/reviews/market/analytics-business-intelligence-platforms/vendor/salesforce-tableau/product/crm-analytics
**HubSpot:** custom report builder — https://knowledge.hubspot.com/reports/create-reports-with-the-custom-report-builder · limitations — https://agentsforhire.ai/blog/hubspot-custom-report-builder-limitations-what-marketing-ops-needs-to-know
**Attio:** reporting — https://attio.com/platform/reporting · guide — https://www.automationjinn.com/blog/attio-reporting-dashboards-guide
**Clari:** analytics — https://www.clari.com/blog/new-from-clari-next-level-analytics-for-revenue-leaders/ · snapshots — https://www.weflow.ai/blog/clari-commit-history-pipeline-snapshots-salesforce
**Gong:** talk-to-listen — https://www.gong.io/blog/talk-to-listen-conversion-ratio · 600-review analysis — https://www.oliv.ai/blog/gong-reviews · analytics — https://improvado.io/blog/gong-analytics
**Nooks:** review — https://www.nooks.ai/blog-posts/nooks-review-top-rated-outbound-dialer-software
**Outreach/Salesloft:** comparison — https://forecastio.ai/blog/outreach-vs-salesloft
**Pipedrive/Close:** Pipedrive dashboard — https://www.pipedrive.com/en/features/sales-dashboard · Close reporting — https://close.com/reporting
**Reps love/hate:** Geckoboard — https://www.geckoboard.com/dashboard-examples/sales/ · why reps export — https://www.graphed.com/blog/how-to-export-crm-data-to-excel · admin bottleneck — https://www.altahq.com/post/ai-salesforce-reporting-how-ai-is-changing-the-way-teams-use-crm-data-in-2026 · best time to cold call — https://www.convoso.com/blog/best-time-to-cold-call/
**Experts:** RevOps leaders — https://www.quotapath.com/blog/revops-leaders-list/ · KD Dorsey — https://modernsaleshq.com/kevin-dorsey · Gong Labs — https://www.gong.io/gong-labs · sales reporting best practices — https://www.qobra.co/blog/sales-reporting-steps-best-practices-tools · Iceberg — https://icebergops.com/4-key-ways-to-maximize-the-value-of-your-reporting/

*Caveats from the research pass: the r/salesforce primary thread sits behind a paywall (quotes paraphrased via a secondary analysis); G2's Salesforce dashboards page returned 403 to automated fetch, so verbatim G2 quotes weren't captured; several roundups (oliv.ai, automationjinn, agentsforhire) are secondary aggregations of G2/Capterra reviews — reliable for sentiment, one step removed from the individual reviewer.*
