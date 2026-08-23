# Doc 10 — Workflows & Automation

A **no-code, deterministic automation builder**: "when *X* happens and conditions *Y* are met, do *Z*." The rep writes the rule once; it runs the same way every time — auditable, testable, instant, no AI in the loop.

**Why this is a separate engine from the AI copilot.** We already have an **AI event engine** (doc 7b) where the AI *judges* what to do on an event (a call ends → read the transcript → decide the right follow-up). This doc is the opposite: the *user* pre-decides the whole decision tree at build time. The dividing line, and the rule to remember:

> **If the rep can write it on an index card as "when X, do Y," it's a workflow. If it needs someone to read, judge, and decide, it's an AI skill.**

Reps hand the **mechanical certainties** ("when a deal is Won, create the handoff task and stop the sequence") to deterministic workflows long before they trust AI to act unsupervised — and a deterministic rule that misfires is a bug they can *see and fix in their own logic*, which is why it earns daily-driver trust. The two are **complementary**: an AI skill can be a **single step inside** a deterministic workflow (the shell guarantees the trigger and the gated action; the AI does the one fuzzy sub-task) — exactly how Attio bolts AI blocks onto its workflow canvas.

**Benchmarks:** **Attio Workflows** (the primary model — a canvas of trigger → logic → action blocks) and **Salesforce Flow Builder** (record-triggered flows with entry criteria + ordered elements), triangulated against HubSpot Workflows and Zapier. We do **not** chase feature parity — we ship the intersection that a solo rep actually needs.

**Phase note:** this is **single-user-valuable now** (a solo rep automating their own busywork). Team-routing actions (round-robin assignment) are [LATER] with multi-user (doc 11).

**Journey numbering:** doc 10, so journeys are `Journey 10.1`, `10.2`, …

**Covers:** trigger→condition→action builder; the trigger/condition/action/delay/branch primitives; test/dry-run on one record; the workflow library (list/duplicate/delete); run history; enable/disable + versioning; user-facing monitoring + failure alerts; super-admin cross-workspace monitoring; AI skill as a workflow step.

---

## The 8 use cases this exists for (each "so that …")

These are the concrete jobs a solo rep needs — every one maps onto our primitives:

| # | When (trigger) | Do (actions) | So that |
|---|---|---|---|
| 1 | A deal is marked **Won** | create a handoff/onboarding task + send a thank-you | nothing falls through at the most important moment |
| 2 | A lead's status = **backburner** and its **callback date arrives** | add to today's call list + notify me (urgently) | I never forget a warm lead I deliberately parked |
| 3 | A call disposition = **not-interested** | set the person's status + **exit them from all sequences** | I stop pestering dead leads and keep the pipeline honest |
| 4 | A **new lead is created** (form/import) | create a "first call" task due today + start a 3-day follow-up timer | speed-to-lead is automatic, not memory-dependent |
| 5 | A deal has **sat in a stage past N days** | flag it + add to an "at-risk" list + remind me | stalling deals surface themselves before they die |
| 6 | A **meeting is booked** | create a prep task the morning of + pull the account's notes | I walk into every call ready |
| 7 | Disposition = **no-answer** | bump the callback date + re-add to the call list after a delay | persistence is systematic, not manual re-queuing |
| 8 | A **key attribute changes** (reply received / score crosses a threshold) | notify me now + pin them to the top of today's list | I act on buying signals while they're hot |

(Use cases 2 and 7 are exactly why **delay-until-a-date** is a must-have, not a nice-to-have.)

---

## Journey 10.1 — Build a workflow

*As a rep, I want to build an automation once, so that a repetitive "when X, do Y" task runs itself every time and I never have to remember it.*

1. The rep opens **Settings → Workflows** (the workflow library, Journey 10.7) and clicks **New** (top-right primary button). He names it in a small dialog and lands on a **top-to-bottom canvas**: one **trigger** block at the top, then **condition / branch / delay / action** blocks chained below (Attio's model). Each block is a card; a **+** button between cards opens a typed block picker (search + categorized list: Triggers, Logic, Actions).
2. He picks a **trigger** (Journey 10.2), adds an **entry condition** so only the right records enter (Journey 10.3), then drops **actions** (Journey 10.4), with **delays** and **branches** as needed.
3. He **tests it on a sample record** (dry-run, Journey 10.5) before turning it on.
4. He toggles it **Live**; it now runs on every matching event. Edits create a **new version** (Journey 10.6) so in-flight runs aren't disrupted.

- **Benchmark (beat this):** Attio — workflows overview — https://attio.com/help/reference/automations/workflows/getting-started-with-workflows ; Salesforce — record-triggered flows — https://trailhead.salesforce.com/content/learn/modules/record-triggered-flows/get-started-with-triggered-flows
- **Build docs:** internal — the workflow runs on the pg-boss durable runner (doc 3/7/8), same engine as the AI event jobs.

## Journey 10.2 — Triggers (the six that matter)

*As a rep, I want to choose exactly what starts my automation, so that it fires on the right event and nothing else.*

The non-negotiable trigger set, drawn from what the use cases actually need:

1. **Record created** — a new person/company/deal (from form, import, or manual).
2. **Record updated** — any change to a record.
3. **Attribute changed to a value** — a specific field hits a specific value (e.g. `stage = Won`, `disposition = not-interested`). This is the workhorse — it also catches the value being *set on create*.
4. **Entered a list / status** — a record joins a list or a status field flips (e.g. status → backburner).
5. **Scheduled / time-based** — recurring (daily/weekly), **and "when a date field arrives"** (the callback date, the close date) — this powers the backburner and no-show use cases.
6. **Webhook received** — an external system POSTs to a generated URL. *(Inbound email / call-ended are first-class events in our **AI** engine, doc 7b; a deterministic workflow can react to the records those events produce, or call an AI skill as a step, Journey 10.4.)*

- **Benchmark (beat this):** Attio — trigger blocks — https://attio.com/help/academy/workflows-course/trigger-blocks
- **Build docs:** internal — triggers subscribe to the same change-events that drive field history (E1) and the activity feed (E5).

## Journey 10.3 — Conditions, branches, and waits

*As a rep, I want to gate, branch, and delay my automation, so that only the right records run and they run at the right moment.*

1. **Entry condition (the gate).** On the trigger, the rep sets simple attribute comparisons (AND/OR) so **only matching records enter** — e.g. "stage changed AND amount > $10k". A record that fails the gate never starts the run (Salesforce entry-criteria / HubSpot enrollment model).
2. **Branch mid-flow.** An **If** block splits into true/false paths; a **Switch** routes to several named paths. **First-match-wins** (HubSpot semantics) — a record takes one branch, not all.
3. **Wait.** **Delay** pauses for a duration ("wait 3 days"); **Delay-until** pauses until a date/time ("until the callback date"). Both are required — the callback and no-show use cases need "until".

- **Benchmark (beat this):** HubSpot — if/then branches — https://knowledge.hubspot.com/workflows/use-if-then-branches-in-workflows ; Salesforce Flow — decision + wait elements — https://www.salesforceben.com/salesforce-flow-glossary/
- **Build docs:** internal — conditions reuse the doc-4 filter grammar (react-querybuilder); delays are pg-boss scheduled jobs.

## Journey 10.4 — Actions (including an AI step)

*As a rep, I want my automation to take real actions — and call AI for the one fuzzy step — so that the work actually gets done, not just flagged.*

The action set a solo rep needs:

1. **Create / update record** — incl. set a status or any attribute.
2. **Add to list / remove from list** — e.g. add to "today's call list" or "at-risk".
3. **Create / complete task** — the follow-up, the prep task, the first-call task.
4. **Exit sequence** — stop the drip (the not-interested clean-shutdown).
5. **Notify me** — in-app + push (and, once teams land, notify a teammate).
6. **Send email / SMS** — through the composer/templates (doc 5, doc 3). *(v2 for fully-unattended send; until then it can draft + queue for one-click approval, respecting the "sending is always explicit" rule.)*
7. **Run an AI skill (the hybrid step).** Call a saved skill (doc 7.8) as one block — "enrich this record", "classify the persona", "draft the follow-up" — so the deterministic shell provides the reliable trigger + gated action and the AI does the one judgment sub-task. This is the bridge between the two engines.
8. **Send HTTP request** — for anything external (webhook out).

- **Benchmark (beat this):** Attio — workflow block library (actions) — https://attio.com/help/reference/automations/workflows/workflows-block-library
- **Build docs:** internal — actions are the same typed tools as the REST API + copilot (doc 8/7.4), so one contract; writes stamp provenance.

## Journey 10.5 — Test before you trust it (dry-run on one record)

*As a rep, I want to test my automation on one real record before it goes live, so that I trust it and don't discover a mistake in production.*

**Yes — this is a first-class, required step (step 3 of Journey 10.1), not a nice-to-have.** The single feature that earns trust in an automation.

1. On the canvas, the rep clicks **Test** (top bar). A **record picker** opens — he searches and picks **one real record** (person/company/deal), or the app offers a **suggested record** that would actually match the trigger's entry condition (so the test is meaningful, not a record that fails the gate).
2. The dry-run **resolves the trigger + entry condition against that record**, then walks the steps and shows **what *would* happen** — a step-by-step trace: which branch it took, each action it would perform, the exact field values it would write or the message body it would send — **with no side effects** (nothing sent, nothing written, no sequence changed, no AI-skill billing beyond a clearly-labeled preview call).
3. If the chosen record **fails the entry gate**, the trace says so plainly ("this record wouldn't enter — `amount` is $4k, gate needs > $10k") so the rep learns *why*, not just "nothing happened."
4. He fixes the logic and re-tests. Only when the trace looks right does he toggle **Live** (Journey 10.6).

- **Benchmark (beat this):** Salesforce Flow — debug/run — https://help.salesforce.com/s/articleView?id=platform.flow_debug.htm ; Zapier — test a Zap step — https://help.zapier.com/hc/en-us/articles/8496260754829
- **Build docs:** internal — a dry-run mode that resolves conditions and *simulates* actions, logging intended effects; AI-skill steps run in a sandboxed preview that returns a sample result and is labeled "preview, not billed to the customer."

## Journey 10.6 — Run history, enable/disable, and versioning

*As a rep, I want to see every run, turn a workflow off, and edit it safely, so that I can debug and change automations without disrupting in-flight runs.*

1. **Run history:** every run logs the trigger, which branch it took, each action's success/failure, and timestamps — so a rep can debug why a workflow did (or didn't) fire. Reached from the workflow's own page (a **Runs** tab) and filterable by status (done / waiting / failed / needs-attention). Non-negotiable.
2. **Enable / disable:** a clear per-workflow toggle with an obvious "off" state; plus **draft vs. live** so edits aren't live until published.
3. **Versioning:** editing a live workflow creates a **new version**; **in-flight runs finish on the version they started on** (a record mid-"wait 3 days" isn't disrupted); new triggers use the new version. Paused/delayed runs are never orphaned when a workflow is disabled.

- **Benchmark (beat this):** Salesforce Flow — versions + debug logs ; Attio — workflow run history
- **Build docs:** internal — `WorkflowVersion` + `WorkflowRun` (below); in-flight runs pin their version.

## Journey 10.7 — The workflow library (list, duplicate, delete)

*As a rep, I want one place to see, duplicate, and delete all my automations, so that I can manage a growing library without them becoming a mess.*

Journey 10.1 covers **Create**; this is the missing **Read-many / Duplicate / Delete** (the other CRUD journeys).

1. **List (read-many).** **Settings → Workflows** shows a table of every workflow in the workspace: **name, status (Live / Draft / Disabled), trigger summary** ("When stage → Won"), **last run** (time + outcome), **runs in last 7 days**, and **owner** (once teams exist, doc 11). Sort by any column; filter by status. This is the home the New button (10.1) and the monitoring view (10.8) both live on.
2. **Row actions (⋯ menu):** **Open** (edit canvas), **Duplicate**, **Enable/Disable** (the 10.6 toggle), **View runs** (10.6), **Delete**.
3. **Duplicate** clones the latest version into a new Draft named "Copy of …" — the fast path for "I want another one almost like this."
4. **Delete** asks for confirmation and warns if **runs are in flight** ("3 records are mid-delay"). On confirm, in-flight runs are **canceled with a log entry** (never orphaned, per 10.6); the workflow moves to trash (soft-delete, recoverable for 30 days, matching the doc-4 trash model) before hard-delete.

- **Benchmark (beat this):** Attio — automations list — https://attio.com/help/reference/automations/workflows/getting-started-with-workflows ; HubSpot — manage workflows — https://knowledge.hubspot.com/workflows/create-workflows
- **Build docs:** internal — list reads `Workflow` + latest `WorkflowRun`; soft-delete flag on `Workflow`.

## Journey 10.8 — Monitor my workflows & get alerted when one breaks

*As a rep, I want to be told the moment a workflow fails and see a health view, so that a broken automation never silently rots and costs me deals.*

Run history (10.6) is pull; this is **push + at-a-glance health** — the thing that makes automations safe to depend on.

1. **The "needs attention" inbox.** When any run hits the **failed / needs-attention** state (a permanently-failed action, per the retry rules below), it surfaces in a **Workflows → Needs attention** list: the workflow, the record, the failing step, and the error. A **badge count** on the Workflows nav item shows how many are waiting.
2. **Failure notification (push).** On the *first* failure of a workflow (and again if a workflow crosses a **failure-rate threshold**, e.g. >20% of runs failing in an hour), the owner gets an **in-app + push notification** — "Workflow *Backburner callback* failed on Acme Corp: HTTP action timed out." Reuses the doc-4e notification path. Deduped so a mass-failure doesn't spam (one alert per workflow per hour, with a count).
3. **Health view (per workflow).** The workflow's page shows a small **health strip**: runs/day sparkline, success vs. failure split, and current in-flight (waiting) count — so the rep sees "is this thing healthy?" without reading the log.
4. **Fix + retry.** From a needs-attention item the rep can **retry the run from the failed step** (idempotent, per the retry rules) or **dismiss** it after fixing the underlying cause (e.g. reconnect a broken integration).

- **Benchmark (beat this):** Zapier — Zap history & error notifications — https://help.zapier.com/hc/en-us/articles/8496030096013 ; Make — scenario error handling — https://www.make.com/en/help/scenarios/scenario-execution-flow
- **Build docs:** internal — needs-attention list reads `WorkflowRun` where `status='failed'`; notification via doc-4e path; failure-rate check in job W2's completion handler.

## Journey 10.9 — Super-admin: monitor workflows across all workspaces

*As a super-admin at our company, I want to watch workflow health and cost across every workspace, so that a runaway or failing automation pages me before it hurts a customer or the invoice.*

This is the operator view, and it **lives in the superadmin console (doc 13)**, not in a customer's settings — cross-workspace by design.

1. **Fleet health.** A panel on the doc-13 dashboard shows, across all workspaces: **total runs/hour**, **global failure rate**, the **top failing workflows** (workspace + name + error), and **queue depth** for the W1/W2/W3 jobs (from doc 12 / Axiom).
2. **Runaway detection (the money guard).** The self-trigger / circuit-breaker guards (see "Self-triggering / infinite loops" below) are **instrumented and alarmed**: if any workspace trips a circuit breaker, or a single workflow exceeds a **runs-per-record** or **runs-per-hour** ceiling, it **pages the operator** (doc 13.2 runaway-alert path) and can be **killed workspace-wide from the doc-13 kill-switches** (13.5). Because workflow actions can call AI skills (10.4.7) and send HTTP, a runaway workflow is a *cost* event, so its spend is tagged and attributable in the doc-13 cost ledger (`feature="workflow"`, plus the calling `runId`).
3. **Drill-in for support.** The operator can open any workspace's failing workflow (via audited impersonation, doc 13.4) to diagnose — never silent.

- **Benchmark (beat this):** Temporal — Web UI fleet view — https://docs.temporal.io/web-ui ; internal — doc 13.2 cost/alert model.
- **Build docs:** internal — reads `WorkflowRun` aggregates + pg-boss queue metrics into the doc-13 overview; runaway alerts reuse doc-13.2 budget/alert plumbing.

---

## What was underspecified — now answered

Answers to "what else does an agent need to build this to spec":

1. **Who can build workflows?** Solo now = the owner. When teams land (doc 11): **admins and managers** can create/edit workspace workflows; **reps** can create workflows **scoped to their own records** but not ones that act on others' data (checked via the doc-11 action-permission + record-visibility split). Gated in the UI; enforced server-side.
2. **Limits / quotas (so a runaway can't cook the DB or the invoice).** Per-workspace caps, all configurable from doc 13: **max enabled workflows** (default 50), **max steps per workflow** (default 40), **run-depth / cycle limit** (default 5, the loop guard below), and a **circuit-breaker** of max runs-per-record-per-hour (default 20). Hitting a cap shows a clear error, not a silent drop.
3. **Starter templates (onboarding).** The **8 use cases** at the top of this doc ship as **one-click templates** in the New dialog ("Won → handoff task", "No-answer → bump callback"). The rep picks one, it lands pre-built on the canvas, he edits the specifics and tests (10.5). This is how a rep gets value in minute one instead of facing a blank canvas.
4. **When two+ workflows match the same event.** They each get their **own run** (independent), executed in **creation order**; they share the per-record-event idempotency lock so they can't issue contradictory writes (last explicit write to a field wins, logged). Deterministic workflows still run before AI skills (Decision 2).
5. **Where the "send email/SMS" approval queue lives.** The drafted-and-queued message (10.4.6) lands in the existing **composer's "needs approval" queue** (doc 5) with one-click **Send** / **Discard**, honoring "sending is always explicit." Not a new surface.
6. **Editing the block library is not user-facing.** The trigger/condition/action set is fixed (the shared typed-tool contract, doc 8 / 7.4). Reps compose from it; they don't define new block types.

---

## Background jobs

- **W1 — Workflow trigger dispatch.** **Trigger:** a change-event (record created/updated, attribute changed, list entry, webhook). **Steps:** match enabled workflows' triggers + entry conditions → enqueue a `WorkflowRun` per match. **pg-boss:** `workflow-dispatch` queue, runs immediately, `retryLimit: 3`; **idempotent per (eventId, workflowId)** so a re-delivered event never double-starts a run.
- **W2 — Workflow run executor.** **Trigger:** a queued `WorkflowRun` (from W1) or a resumed delay (from W3). **Steps:** execute the run's steps in order on the pg-boss durable runner — branches, delays (scheduled resume via `resumeAt`), and actions — writing a run log per step. **pg-boss:** `workflow-run` queue, **per-action `retryLimit: 3` with backoff**; non-idempotent actions carry an **idempotency key** (see retry rules); survives restarts; a permanently-failed action drops the run to `needs-attention` (10.8).
- **W3 — Scheduled/date triggers.** **Trigger:** a pg-boss **cron ticker** (every minute). **Steps:** fire recurring workflows whose schedule is due and "date field arrived" triggers (callback/close dates) → enqueue runs into W2. **pg-boss:** `workflow-ticker` cron; **idempotent per (workflowId, recordId, fireDate)** so a given date fires a record once.

---

## Decisions for you (workflows)

**1. Two engines, one bridge. Decided (my pick).** Keep the **deterministic** workflow builder (this doc) and the **AI event engine** (doc 7b) as **separate tools**, connected by one seam: an **AI skill is callable as a workflow step**. Reps get predictable automation for the certainties and delegated judgment for the fuzzy calls, and can compose them. *Alternative: fold everything into the AI engine — rejected; reps need a rule they wrote and can audit, not judgment, for "when Won, create task".*

**2. Precedence when both fire on the same event. Decided (my pick): deterministic runs first.** If a record event triggers both a workflow and an AI skill, the **workflow runs first** so it can gate/short-circuit the AI (e.g. a workflow sets status=not-interested and stops sequences, so the AI doesn't draft a follow-up). A shared per-record-event lock prevents contradictory writes. *Alternative: AI first — rejected; the deterministic rule is the safer gate.*

**3. Fully-unattended send — [LATER].** For now, workflow "send email/SMS" **drafts + queues for one-click approval** rather than sending silently, honoring the repo-wide "sending is always explicit" rule. Flip to unattended once the rep trusts it. *Tell me if you want unattended send from day one.*

---

## Technology choices (where it is not obvious)

- **Runs on pg-boss (Postgres-backed durable jobs), not a new engine.** The workflow executor is the **same durable runner** used by the AI event engine (7b), enrichment (H2), and the dialer jobs — so delays, retries, and restart-survival come for free, and there's one queue to operate. Options considered: a dedicated workflow engine (Temporal, n8n embedded) — rejected as heavy for the MVP intersection; we already run pg-boss.
- **Conditions reuse the doc-4 filter grammar** (react-querybuilder) so the same AND/OR builder the rep knows from views drives workflow entry conditions.
- **Actions are the shared typed tools** (doc 8 REST contract + doc 7.4 copilot tools). Defining the action set once means the workflow builder, the API, and the AI agent never drift.
- **The workflow ↔ AI-engine seam** is a single "run skill" action that invokes a saved skill (doc 7.8) and waits for its structured result before continuing — the deterministic-shell-with-an-AI-step pattern Attio validates.

## Data model (Prisma) — additions in this doc

```prisma
model Workflow {             // NEW — one automation
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  isEnabled   Boolean @default(false)   // draft vs live toggle (Journey 10.6)
  liveVersionId String?                 // the published version
  createdById String?                   // owner, for reps' own-record workflows (doc 11 perms)
  deletedAt   DateTime?                 // soft-delete → trash, 30-day recovery (Journey 10.7)
  versions    WorkflowVersion[]
  createdAt   DateTime @default(now())
}

model WorkflowVersion {      // NEW — an immutable version of the logic (Journey 10.6)
  id          String  @id @default(cuid())
  workflowId  String
  version     Int
  triggerJson Json           // { type, entryConditions }  (Journeys 10.2/10.3)
  stepsJson   Json           // ordered blocks: conditions, branches, delays, actions (10.3/10.4)
  createdAt   DateTime @default(now())
  @@unique([workflowId, version])
}

model WorkflowRun {          // NEW — one execution (job W2; Journey 10.6 history)
  id          String   @id @default(cuid())
  workflowId  String
  versionId   String          // pinned; in-flight runs finish on their version
  recordId    String          // the record that triggered it
  status      String          // running | waiting | done | failed | canceled
  branchLog   Json            // which branch taken + each action's result + timestamps
  resumeAt    DateTime?       // for delay / delay-until (scheduled resume)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([workflowId, createdAt])
  @@index([status, resumeAt])
}
```

## Technical decisions, trade-offs & edge cases

**Self-triggering / infinite loops (the #1 thing to get right).** Workflow A updates a field → that update fires Workflow A again, or B updates a field that re-fires A. Three guards: (1) **don't re-fire a workflow on changes it made itself** (tag writes with their run id and skip re-triggering that workflow); (2) a **per-record run-depth / cycle guard** (a chain can't recurse past a small limit); (3) a **circuit breaker** — max runs per record per time window. Without these, the engine cooks the database.

**Ordering vs. the AI event engine.** The same event can trigger both a workflow and an AI skill (Decision 2): **deterministic runs first** so it can short-circuit the AI, both share a **per-record-event idempotency lock**, and the two are barred from issuing contradictory writes (the workflow's write wins if it explicitly sets a field the AI would touch). Documented so the two engines never silently fight.

**Failed-action retries.** An HTTP call, enrichment, or write fails mid-run. Idempotent actions (update to a known value) retry with backoff; non-idempotent ones (create a task) use an **idempotency key** so a retry doesn't duplicate. A permanently failed action drops the run to a **"needs attention"** state visible in run history — never silently dropped. Partial runs resume from the failed step, not from the top.

**Editing a workflow while runs are in flight.** A rep edits logic while 40 records sit in a "wait 3 days" delay. **In-flight runs complete on the version they started on** (`WorkflowRun.versionId` is pinned); the edit creates a new `WorkflowVersion` that only applies to *new* triggers. Draft/live states mean edits aren't live until published, and disabling/deleting a workflow **never orphans** paused runs — they're either allowed to finish or explicitly canceled with a log entry.

**Why not just use the AI engine for everything?** Because determinism *is* the feature. "When stage = Won, create the onboarding task" must fire the same way every time, be auditable, run instantly, cost nothing, and be fixable by the rep. An AI skill is the right tool only when the action depends on judgment over unstructured input. Offering both, with the AI-skill-as-a-step bridge, is the whole design.
