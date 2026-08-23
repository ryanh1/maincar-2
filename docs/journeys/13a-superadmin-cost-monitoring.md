# Doc 13a — Superadmin: AI & credit cost monitoring

The part of the superadmin console ([doc 13](13-superadmin-console.md)) that answers the one question that keeps a consumption-billed product solvent: **what is expensive, who/what caused it, and what do I change to cut it — without guessing from an invoice a month later.**

**Why it matters:** AI (LLM tokens), telephony (Twilio), transcription (Deepgram minutes), and enrichment (per-record provider calls) all **bill by usage**, so cost scales with adoption and a single runaway feature can 10× your bill overnight. This doc makes spend **visible the moment it happens**, **attributable** to a feature/user/run, and **capped** so a runaway pages you instead of surprising you.

**Phase note:** the **`UsageEvent` ledger + metering wrapper** (Journey 13a.1) ships with the **first AI call** in Phase 2 — before any dashboard — so we never fly blind. The dashboard, budgets, and alerts follow. This is the split called out in [sequencing](../development-guidelines/sequencing-and-build-order.md) (decision 5).

**Where things live (the read/write split from [doc 13](13-superadmin-console.md)):** the **dashboards are read** and live in **Axiom** (real-time) + **Evidence.dev** (versioned SQL reports) — we don't rebuild charts. The **budgets are write** and live in a small **custom form** in the `/admin` area over our own `CostBudget` model.

**Journey numbering:** `Journey 13a.1`, `13a.2`, …

---

## Journey 13a.1 — Meter every consumption call at the moment it happens (the algorithmic journey)

*As a superadmin, I want every paid call metered and tagged the instant it runs, so that spend is attributable to a feature, user, and background run — not reconstructed from a bill.*

This is a **data journey**, not a screen — it is the plumbing every later journey reads from.

1. **Every** AI / telephony / transcription / enrichment call in the app goes through **one thin wrapper** (`meter(fn, tags)`), never the raw provider SDK directly. This is a code convention enforced in review: a raw provider call in a request path is a bug.
2. When the wrapped call returns, the wrapper reads the **units actually consumed** from the response — LLM `usage.total_tokens`, Deepgram audio-seconds, Twilio call-seconds, or an enrichment provider's credit count.
3. It **computes dollar cost at call time** from a small in-code price table (per-model $/1K tokens, $/min, $/credit), because the price is knowable now and impossible to attribute later.
4. It writes one **`UsageEvent`** row tagged with **`workspaceId`, `userId`, `feature`, `provider`, `model`, `runId`, `units`, `unitKind`, `costUsd`** — and emits the same event to **Axiom** (for the real-time dashboards).
5. Two sinks on purpose: **Postgres `UsageEvent`** is the durable ledger (exact, joinable, the future billing source of truth); **Axiom** is the fast query/alert layer. They never disagree because they're written from the same wrapper call.

- **`feature` is the key tag.** It names the *product reason* for the spend — `call-summary`, `enrichment-waterfall`, `transcription`, `sequence-email-draft`, `data-chat`, `ai-field:<name>` — so the dashboard can say "enrichment is 60% of spend," not just "OpenAI is 60% of spend." `runId` ties a cost back to the exact background run that caused it.
- **Why compute cost at the call, not after:** tokens/minutes are in the response *now*; a month-end invoice is an undifferentiated total with no feature/user/run attribution. Reconstructing "what was expensive" from an invoice is impossible; metering at the edge is a few lines.
- **Benchmark (beat this):** **Langfuse** / **Helicone** — per-user/per-feature LLM cost attribution — Langfuse token & cost tracking [how it works] — https://langfuse.com/docs/observability/features/token-and-cost-tracking + user tracking — https://langfuse.com/docs/observability/features/users ; Helicone custom properties (tag a request by feature/user) [how it works] — https://docs.helicone.ai/features/advanced-usage/custom-properties + how cost is calculated — https://docs.helicone.ai/references/how-we-calculate-cost ; **Axiom LLM observability** — https://axiom.co/docs/apps/openai (metering pattern). *Want cost attribution at least as granular as Langfuse's user/feature/run tags.*
- **Build docs:** internal — the `meter()` wrapper + a `UsageEvent` insert + an Axiom event; **open-source Langfuse/Helicone/LiteLLM can supply the LLM half off-the-shelf** and we tag telephony/enrichment ourselves.

**Decision — build the ledger vs adopt Langfuse/Helicone first.** *Pick: adopt an open-source LLM-cost tool (Langfuse or Helicone) for the LLM slice, wired to our tags, and keep our own `UsageEvent` for the non-LLM slice (Twilio/Deepgram/enrichment) — unify in the dashboard.* We get per-user/feature LLM attribution fast without building it, and still own the full ledger for billing later. *Alternative: build the whole ledger first — rejected; slower to value, and the tags/wrapper are identical either way.*

## Journey 13a.2 — Read the cost dashboard (where the money goes)

*As a superadmin, I want to slice spend by feature, user, workspace, provider, and model over time, so that I can see at a glance where the money goes and what's climbing.*

1. From the Overview ([doc 13](13-superadmin-console.md) Journey 13.2) "Today's spend" tile → **open cost console**.
2. You land on the **cost dashboard** — an **embedded Axiom dashboard** (for real-time / last-24h) with a link to the **Evidence report** (for month-over-month, versioned). You did not build these charts; you built the tagged events they read.
3. The default view slices **spend by feature × day**, with breakdowns you can pivot to **user**, **workspace**, **provider**, or **model**.
4. A **trend flag** highlights any slice climbing abnormally (e.g. "enrichment +140% vs 7-day avg").
5. You click a spiking slice → drill into it (Journey 13a.3).

```
COST — last 30 days                        [ by Feature ▾ ]  [ 30d ▾ ]   embedded Axiom
Total  $9,840        ▁▂▂▃▃▄▅▅▆▇  ↑ 22% vs prior 30d
┌─────────────────────────┬──────────┬────────┬──────────────────────────┐
│ Feature                 │  Spend   │  %     │  trend                    │
├─────────────────────────┼──────────┼────────┼──────────────────────────┤
│ enrichment-waterfall    │ $5,910   │  60%   │ ▁▁▂▃▅▇  ⚠ +140% (Acme)    │
│ call-summary            │ $1,880   │  19%   │ ▃▃▃▃▃▃  →                 │
│ transcription           │ $1,180   │  12%   │ ▂▂▃▂▂▂  →                 │
│ data-chat               │   $470   │   5%   │ ▁▂▁▁▂▁  →                 │
│ sequence-email-draft    │   $400   │   4%   │ ▁▁▂▂▂▃  ↑                 │
└─────────────────────────┴──────────┴────────┴──────────────────────────┘
Pivot ▸  Feature · User · Workspace · Provider · Model        [ open Evidence report → ]
```

- **How the data arrives:** Axiom queries the metered events from Journey 13a.1 (real-time); Evidence queries the `UsageEvent` table in Postgres for the versioned monthly report. Same events, two read tools.
- **The three usual cost drivers the dashboard makes obvious:**
  - **Long-context LLM calls** — cost is per token, so stuffing big transcripts/docs into a prompt is the #1 driver.
  - **Enrichment waterfalls** — one record → several sequential provider calls; cost multiplies per record and hides in the aggregate until you slice by feature.
  - **Transcription minutes** — Deepgram bills per minute; long or re-run transcriptions add up.
- **Benchmark (beat this):** Langfuse dashboards (cost by user/feature over time) — https://langfuse.com/docs/analytics ; Evidence.dev (versioned SQL reports) — https://evidence.dev/
- **Build docs:** internal — an Axiom dashboard (embed) + an Evidence report page reading `UsageEvent`.

## Journey 13a.3 — Investigate a cost spike (drill-down)

*As a superadmin, I want to drill from a spiking slice to the exact runs and records behind it, so that I can decide whether it's legitimate growth or a bug/abuse.*

1. From the dashboard (Journey 13a.2) you click the flagged slice — e.g. `enrichment-waterfall +140%, mostly Acme`.
2. You filter to **that feature × that workspace × the spike window**, and the view resolves to the **individual runs** (`runId`) and their cost.
3. You see the shape: e.g. "one user bulk-ran a 4,000-row list through the enrichment waterfall at $0.22/row." Now you know *what* happened and *who*.
4. You decide: legitimate (leave it, maybe raise their budget in 13a.5), inefficient (right-size the model / add caching — the levers in [doc 13b](13b-superadmin-model-and-killswitches.md)), or abusive (throttle via a budget, or kill-switch the feature for them — [doc 13b](13b-superadmin-model-and-killswitches.md)).
5. Every optimization is **measurable against this same dashboard** — you compare spend-per-feature before and after your change.

- **How to make the cost decision (the console guides these):**
  - **Right-size the model** — cheap/small models for cheap tasks (classification, short extraction), expensive long-context models only where they earn it. You set this routing in [doc 13b](13b-superadmin-model-and-killswitches.md).
  - **Cache aggressively** — reuse identical requests and transcriptions; provider prompt-caching where available; never re-pay for the same answer (ties to enrichment run-conditions, [doc 7.7](7-ai-copilot.md)).
  - **Trim context** — summarize/chunk long inputs before an expensive call.
- **Benchmark (beat this):** Helicone — Sessions (group related requests, then trace one flow end to end) [how it works] — https://docs.helicone.ai/features/sessions ; Helicone — user metrics & analytics [visual] — https://docs.helicone.ai/features/advanced-usage/user-metrics ; Langfuse — custom dashboards (slice cost by model/tag/user) [visual] — https://langfuse.com/docs/metrics/features/custom-dashboards
- **Build docs:** internal — the drill is a filtered query over `UsageEvent` / Axiom by `feature`+`workspaceId`+`runId`+time.

## Journey 13a.4 — Create a cost budget (create)

*As a superadmin, I want to set a monthly spend ceiling per feature or per workspace, so that a runaway is capped before it hurts.*

1. In the `/admin` cost area → **Budgets → + New budget**.
2. A form: **scope** (feature / workspace / global), the **target** (which feature or workspace), **monthly cap ($)**, **alert-at %** (default 80), and **hard-stop behavior** at 100% (**throttle**, **degrade to a cheaper model**, or **block** — decided below).
3. Save → writes a **`CostBudget`** row → live immediately (budgets are read at runtime by the meter path).

```
New budget
Scope      ( ) Global   (•) Feature   ( ) Workspace
Feature    [ enrichment-waterfall            ▾ ]
Cap        $ [ 2000 ] / month
Alert at   [ 80 ] %          →  alert fires; you get paged
At 100%    (•) Degrade to cheaper model   ( ) Throttle   ( ) Block
                                                   [ Cancel ]  [ Create ]
```

- **How it's enforced:** the meter wrapper (Journey 13a.1) checks the running month-to-date spend for the scope **before** an expensive call; at `alertAtPct` it fires the alert (Journey 13a.6), at 100% it applies the hard-stop behavior.
- **Benchmark (beat this):** AWS Budgets (scoped caps + alert thresholds) — https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html ; Langfuse budget alerts.
- **Build docs:** internal — `CostBudget` insert; enforcement read in `meter()`.

## Journey 13a.5 — Edit or delete a cost budget (update / delete)

*As a superadmin, I want to change or remove a budget, so that caps track reality as a workspace grows or a feature's cost profile changes.*

1. **Budgets** list → click a budget → **Edit** the cap / alert % / hard-stop behavior → Save (writes the `CostBudget` row; step-up if raising the cap, since that raises spend exposure).
2. **Delete** → confirm → removes the cap. A dialog warns "removing this cap means this scope has no ceiling — spend is uncapped." Deleting a budget is itself an `AdminAudit` action ([doc 13](13-superadmin-console.md) Journey 13.9).
3. Both changes are **live immediately**.

- **If X then Y:** *If you raise a cap* → step-up + audit (spend exposure up). *If you lower a cap below current month-to-date* → the scope is already over; the hard-stop behavior applies on the next call and you're warned at save time.
- **Benchmark (beat this):** AWS Budgets edit ; Stripe billing-threshold edit.
- **Build docs:** internal — `CostBudget` update/delete; audited.

## Journey 13a.6 — Budget breach → alert & auto-throttle (background job)

*As a superadmin, I want to be paged the moment a budget is threatened and have spend auto-contained at the ceiling, so that a runaway can't outrun me.*

This is a **background/algorithmic journey** with two triggers — one inline, one scheduled.

1. **Inline check (fast path).** On every metered expensive call (Journey 13a.1), the wrapper reads the scope's month-to-date spend vs its `CostBudget`. **If ≥ alertAtPct** → enqueue a `cost-alert` job (deduped per scope per day). **If ≥ 100%** → apply the hard-stop behavior **on that call** (degrade/throttle/block per the budget).
2. **Scheduled sweep (safety net).** A **cron** job (`cost-budget-sweep`, every 15 min) recomputes month-to-date spend per scope from `UsageEvent` and catches anything the inline path missed (e.g. cost that landed via a provider webhook after the call). It fires the same alerts.
3. **Runaway guard (independent of budgets).** A separate rule — "**any single user/workspace > $50 in 24h**" — fires a **hard page** even if no explicit budget exists, so a brand-new abusive pattern still pages you.
4. **What the alert does:** posts to the Overview Alerts band ([doc 13](13-superadmin-console.md) Journey 13.2) + pages you (email/Slack/PagerDuty per config). The alert links straight to the drill-down (Journey 13a.3).

- **Background jobs (pg-boss):**
  - `cost-alert` — **Trigger:** inline threshold cross or sweep. **Steps:** build the alert, post to Overview + page. **pg-boss:** `retryLimit: 3`, **deduped/singleton per `(scope, scopeId, day)`** so one breach doesn't page you 400 times.
  - `cost-budget-sweep` — **Trigger:** cron every 15 min. **Steps:** recompute MTD per scope, compare to caps, enqueue `cost-alert` on crossings. **pg-boss:** `singleton` (no overlap), cron schedule.
  - The **hard-stop** at 100% is applied **synchronously in `meter()`**, not via a job, so the cap actually stops the *next* call rather than reacting after the fact.
- **Benchmark (beat this):** AWS Budgets actions (auto-action at threshold) ; Datadog monitor alerting (dedupe + escalation) — https://docs.datadoghq.com/monitors/
- **Build docs:** internal — inline check in `meter()` + a cron sweep + a deduped alert job.

## Journey 13a.7 — One wrapper's full job: prompts, evals, and params in one place — *and does it cover transcription too?*

*As a superadmin, I want the same wrapper that tracks cost to also capture the exact prompt, let me run evals, and show every call's parameters in one place — and I want to know whether that also covers transcription and other non-LLM providers.*

You asked whether we should use a **wrapper library** around our models to track **cost, usage source, prompts, evals, parameter-swapping, one-place param viewing, and every call-site** — and whether it **also works for transcription and other provider types**. The `meter()` wrapper (Journey 13a.1) already gives you **cost + usage source + call-site coverage for every provider**. This journey answers the rest — and the honest answer is **it's two layers, because LLM-observability tools are LLM-shaped and transcription/telephony are not.**

1. **Layer 1 — an LLM-observability wrapper (Langfuse) around every *LLM* call.** All LLM traffic already flows through the provider-agnostic agent layer (the Vercel AI SDK, [doc 7](7-ai-copilot.md)) with the `meter()` wrapper. We attach **Langfuse** (or Helicone) at that same choke-point to add the LLM-specific depth in your list — nothing new to remember, one wrapper:
   - **Prompts** — the full prompt + completion of every call is captured, and Langfuse **versions named prompts**, so you can see and roll back exactly which prompt produced a result.
   - **Usage source** — every call carries the same tags as the ledger (`feature`, `userId`, `workspaceId`, `runId`), so a trace answers "which feature/user/run made this call."
   - **Evals** — captured traces become the **eval dataset**; Langfuse runs scored evals against the [doc 7a](7a-copilot-eval-fixtures.md) fixtures, so a prompt/model change is **graded before it ships**.
   - **Parameters — swappable *and* viewable in one place.** The model/temperature/max-tokens/tools/system-prompt are **config, not code** — swapping them is a [doc 13b](13b-superadmin-model-and-killswitches.md) `ModelRouting` change (no deploy) — and the Langfuse **trace view shows the exact params of every call in one screen**, so "what settings did this call use?" is one click, not a code read.
2. **Layer 2 — the provider-agnostic `UsageEvent` ledger for *every* provider (this is the transcription answer).** Langfuse models an *LLM* call (prompt / completion / tokens); it does **not** model a Deepgram audio-minute or a Twilio call-minute. So **cost/usage for the non-LLM providers rides on the `UsageEvent` ledger** (Journey 13a.1), which is deliberately unit-agnostic (`unitKind = tokens | audio_seconds | provider_credits`). **Every** provider call — LLM, **transcription (Deepgram)**, telephony (Twilio), enrichment — routes through the same `meter()` wrapper that writes a `UsageEvent`.
3. **So, plainly: "does it also work for transcription and other providers?"**
   - **Cost + usage source + call-site tracking → yes, one uniform system for all of them** (`UsageEvent`, Journey 13a.1). One dashboard covers LLM, transcription, telephony, and enrichment.
   - **Prompt / eval / parameter-trace depth → that's an LLM concept, so it applies to the LLM calls.** Transcription/telephony have no "prompt" to version, but their **request options** (e.g. the Deepgram model + diarization flags) are still logged as `UsageEvent` metadata + a span, so you can still see what settings a transcription used — just not in an LLM prompt/eval tool.
4. **Why a wrapper at all (not per-call logging):** a single choke-point means **no call-site can forget to log** — the wrapper is where cost is computed, tags are attached, the trace is opened, and the params are read from config. Adding a provider is one adapter behind the wrapper; every dashboard, eval, and budget then covers it for free. This is the same "a raw provider call is a review-blocking bug" rule as Journey 13a.1.

- **Benchmark (beat this):** **Langfuse** — prompts, traces, evals, params in one place — https://langfuse.com/docs ; **Helicone** — platform overview (proxy, sessions, properties, costs in one place) — https://docs.helicone.ai/getting-started/platform-overview ; **LiteLLM** — one interface + cost across providers — https://docs.litellm.ai/docs/ ; **Vercel AI SDK** — provider-agnostic model layer ([doc 7](7-ai-copilot.md)) — https://sdk.vercel.ai/docs. *Want prompt/eval/param visibility at least as good as Langfuse's trace view.*
- **Build docs:** internal — Langfuse wrapper on the doc-7 AI SDK layer (LLM depth) composed with the `meter()` ledger wrapper (uniform cost, Journey 13a.1); params read from `ModelRouting` ([doc 13b](13b-superadmin-model-and-killswitches.md)); evals reuse the [doc 7a](7a-copilot-eval-fixtures.md) fixtures.

---

## Decisions for you (cost monitoring)

**1. Build the ledger vs adopt Langfuse/Helicone. Decided (my pick): adopt open-source Langfuse/Helicone for the LLM slice, keep our own `UsageEvent` for telephony/transcription/enrichment, unify in the dashboard.** Fast per-user/feature LLM attribution now; we still own the full ledger for billing later. *Alternative: build everything first — rejected; slower, same tags either way.*

**2. Hard-stop behavior at 100% of budget — block vs degrade vs throttle. Decided (my pick): default to *degrade to a cheaper model*, with *throttle* and *block* as per-budget options.** Degrading keeps the feature working at lower quality/cost instead of breaking it; a hard block is right only for clearly abusive scopes. *Alternative: always block — rejected; a blocked core feature looks like an outage to the customer.*

**3. Alert channel. Decided (my pick): Overview Alerts band + Slack for warnings, PagerDuty/phone for the $50/24h runaway page.** Warnings shouldn't wake you; a true runaway should. *Alternative: email-only — rejected; too easy to miss the one that matters.*

## Data model (Prisma) — additions in this doc

```prisma
model UsageEvent {           // NEW — one metered AI/consumption call (Journey 13a.1)
  id          String   @id @default(cuid())
  workspaceId String
  userId      String?
  feature     String          // "call-summary" | "enrichment-waterfall" | "transcription" | "sequence-email-draft" | ...
  provider    String          // openai | anthropic | deepgram | <enrichment vendor> | twilio
  model       String?
  runId       String?         // ties to a background run / skill run
  units       Int             // tokens or audio-seconds or provider-credits
  unitKind    String          // tokens | audio_seconds | provider_credits
  costUsd     Decimal         // computed at call time
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
  @@index([feature, createdAt])
  @@index([runId])
}

model CostBudget {           // NEW — per-feature/workspace/global ceiling + alerting (Journeys 13a.4–6)
  id            String  @id @default(cuid())
  scope         String          // feature | workspace | global
  scopeId       String?         // the feature name or workspaceId; null for global
  monthlyCapUsd Decimal
  alertAtPct    Int     @default(80)
  hardStop      String  @default("degrade") // degrade | throttle | block  (behavior at 100%)
  updatedAt     DateTime @updatedAt
  @@unique([scope, scopeId])
}
```

## Technical decisions, trade-offs & edge cases

**Attribute cost at the call, not after.** The only reliable way to know what's expensive is to compute cost **when the call is made** (tokens/minutes are in the response) and tag it with feature/user/run. Reconstructing spend from invoices can't attribute it. Every AI/telephony/enrichment path routes through the `meter()` wrapper — a raw provider call in a request path is a review-blocking bug.

**Cost monitoring is also the billing foundation.** The `UsageEvent` ledger that answers "what's expensive for me" is the same metering that later bills customers for usage-based plans ([doc 14 backlog](14-backlog.md) → billing). Building it now pays twice.

**The ledger ships before the dashboard.** The wrapper + `UsageEvent` turn on with the first AI call so we never discover spend on an invoice; the Axiom/Evidence dashboards and budgets follow. This is the [sequencing](../development-guidelines/sequencing-and-build-order.md) decision to split the ledger from the console.

**Two sinks, one write.** Postgres (durable, joinable, billing-grade) and Axiom (fast, alertable) are written from the same wrapper call, so they can't drift. If Axiom is down, the ledger is still correct and we backfill dashboards from Postgres.
