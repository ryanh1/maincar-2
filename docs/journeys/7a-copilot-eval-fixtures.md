# Doc 7a — AI Eval Fixtures

Part of the **AI Copilot** family (head: [7 — AI Copilot](7-ai-copilot.md)). These are the **test cases** the AI is graded against — realistic scenarios with the **actions the AI should take** spelled out, so we can measure quality and catch regressions ([7f.8 evals](7f-skills.md)). Build/implementation for the behaviors lives with the engine ([7c](7c-ai-decision-engine.md)) and skills ([7f](7f-skills.md)); this doc is the graded set only.

**What changed from the old version.** The old doc was ~200 read-only question prompts. That under-weighted the real job: **most requests require an action** — a CRM update, a follow-up, an outreach, a notification — not just a lookup. So this is **consolidated to ~24 fixtures, ≥60% action-oriented**, each showing the actions expected, folding in the event-triggered cases (the old 7b.4–7b.11). Benchmarks are removed (a fixture set doesn't need them). Each fixture lists the **tools it needs**, so we can see what's feasible to grade end-to-end vs. what needs a live tool.

**Columns.** *Persona* (rep / mgr / CRO / RevOps) · *Category* · *Prompt or trigger* · *Expected actions* · *Internal tools* (our own API/CRM) · *External tools* (leave-the-building) · *Script?* (needs code execution Y/N) · *Other*. Internal tools use the [7e.4 contract](7e-agent-surface.md): `search`, `get/create/update/upsert_record`, `add_to_list`, `run_report`, `enrich`, `run_skill`; external: `send_email`, `send_sms`, `notify_slack`, `create_calendar_event`.

---

## A. User-prompted fixtures (a rep/manager/CRO/RevOps asks)

| # | Persona | Category | Prompt | Expected actions | Internal tools | External tools | Script? | Other |
|---|---|---|---|---|---|---|---|---|
| 1 | Rep | Log + follow-up | "Log the call I just had with Jane at Northwind about pricing and set a follow-up." | Create a call/note on the contact; create a task; open a follow-up loop | create_record (note, task) | — | N | Ties to [7c.14](7c-ai-decision-engine.md) |
| 2 | Rep | Deal update | "Acme pushed again — move close to next Friday and add a risk note." | Update deal.closeDate; add note; flag risk | update_record, create_record | — | N | Date parse ("next Friday") |
| 3 | Rep | Multi-step research→create | "Research trade associations; if they're good targets, enrich them and add the top contacts (desc, title, email, phone, website, LinkedIn)." | Web research + judgment; source records; enrich; create + add-to-list — all via accept/reject | run_skill (research), enrich, create_record, add_to_list | web fetch/search | N | The 7.11 multi-step case; identity-confirm before write |
| 4 | Rep | Data correction | "This is the real company phone from their site — store it and mark the old one dead." | Set ContactPhone; mark old number dead + reason | update_record | — | N | Dead-value pattern ([7b.9](7b-copilot-automations.md)) |
| 5 | Rep | Outreach + conditional | "Text Dana to confirm she got the samples, and remind me to follow up if she doesn't reply." | Draft SMS (queued, external); open a conditional loop ("unless she replies") | create_record (loop) | send_sms (queued) | N | External queued, never auto-sent |
| 6 | Rep | Prep + draft | "Prep me for my 2pm with Globex — brief + draft an agenda email." | Read account history → brief; draft an agenda email (queued) | search, run_report | send_email (draft) | N | Mixed read+action |
| 7 | Rep | Enrich (targeted) | "Find the VP of Sales at Cyberdyne and their mobile." | Run find-decision-maker + find-mobile skills; propose fields | run_skill, enrich | — | N | Waterfall ([7d.4](7d-enrichment.md)) |
| 8 | Mgr | Team nudge | "Ping the reps whose commit deals have no activity in 10 days to update them." | Query deals; identify reps; draft a Slack/notification to each | search, run_report | notify_slack | Y (query) | Nudge = internal notify |
| 9 | Mgr | Reassign + notify | "Reassign the Acme deal from David to Sarah and notify both." | Update deal.owner; notify David + Sarah | update_record | notify_slack | N | Ownership change |
| 10 | Mgr | Bulk w/ preview | "Bump all of Tom's stage-1 deals with past close dates — show me first." | Query; present a preview batch; on accept, bulk update | search, update_record | — | Y (query) | Preview-before-write |
| 11 | CRO | Report + nudge | "Pipeline report of opportunities that slipped this quarter, and nudge the owners." | Run a slippage report; for each, draft an owner nudge | run_report | notify_slack | Y (report) | Report + action |
| 12 | CRO | Risk + draft | "Which commit deals are at risk — draft a note to each owner asking for a plan." | Identify at-risk commit; draft a note per owner | run_report | notify_slack / send_email (draft) | Y | Judgment on "at risk" |
| 13 | RevOps | Bulk reassign | "Reassign all leads from the rep who left to round-robin, after I confirm." | Query; propose reassignment; on confirm, bulk update | search, update_record | — | Y | Confirm gate |
| 14 | RevOps | Dedupe + merge | "Find duplicate Acme accounts and merge them, pending my approval." | Run dedupe skill; propose merges; on approval, merge | run_skill, update_record | — | Y | Merge is irreversible → approval |
| 15 | RevOps | Standardize | "Standardize region from billing country where blank — preview first." | Compute region; preview; on accept, bulk write | search, update_record | — | Y | Preview-before-write |
| 16 | Rep | Knowledge | "What did we discuss on my last call with Globex?" | Read transcript; answer with citations | search (transcript) | — | N | Read-only |
| 17 | Rep | Knowledge | "Who's the economic buyer on Massive Dynamic and how do I reach them?" | Read deal roles + contact; answer | search | — | N | Read-only |
| 18 | Mgr | Knowledge | "Prep me for my 1:1 with Sarah — top deals, risks, activity." | Read + summarize rep's book | run_report | — | Y | Read-only |
| 19 | CRO | Knowledge | "Company-wide forecast this quarter, committed vs best case, biggest swings." | Run forecast report | run_report | — | Y | Read-only |
| 20 | RevOps | Knowledge | "Which required fields are most often blank at each stage?" | Analyze; return a breakdown | run_report | — | Y | Read-only |

*(20 fixtures; 14 action, 6 knowledge = 70% action.)*

## B. Event-triggered fixtures (the AI runs unprompted — folds in old 7b.4–7b.11 + the engine)

| # | Trigger | Category | Scenario | Expected actions | Internal tools | External tools | Script? | Other |
|---|---|---|---|---|---|---|---|---|
| 21 | Call: meeting agreed w/ date | Auto-draft | Transcript detects a meeting agreed | Draft invite + confirmation email + day-before reminder (all queued) | create_record (task) | create_calendar_event (draft), send_email (draft) | N | Old 7b.4; ≥X-days rule |
| 22 | Call: "call me back Thu 2pm" | Reminder | Callback time, no formal meeting | Create an internal reminder/task at that time | create_record (task) | — | N | Old 7b.5 |
| 23 | Call: no connect | Auto-draft | Call didn't connect | Draft a "tried to reach you" email (queued) | — | send_email (draft) | N | Old 7b.6 |
| 24 | Call: wrong person | Upsert+enrich | Reached a gatekeeper/different person | Upsert the person; set persona; enrich title/contact; quick research card | create_record, enrich, run_skill | web | N | Old 7b.7 |
| 25 | Call connects to human | Number memory | A number connects | Bump connectCount/lastConnectedAt; pre-select next time | update_record | — | N | Old 7b.8 (dialer-learning) |
| 26 | Wrong number / email bounce | Dead-value | Clear wrong-number signal or a bounce | Mark value dead + reason; offer "find a better one" | update_record, enrich | — | N | Old 7b.9; iffy signals don't auto-mark |
| 27 | Call: "call me Matt" / says name | Name capture | Nickname / pronunciation heard | Write preferredName; clip pronunciation audio | update_record | — | N | Old 7b.10 |
| 28 | Enrichment: DBA ≠ legal name | DBA capture | Known-as name differs | Store company.dba | update_record | — | N | Old 7b.11 |
| 29 | Timer: proposal unanswered by promised date | Escalation | The Dana chase | Re-read account; draft next touch (queued); re-arm; hand back at budget | search, create_record | send_email (draft) | N | [7c.13/7c.15](7c-ai-decision-engine.md) |
| 30 | Inbound: reply arrives | Auto-close | The awaited reply lands (any channel) | Auto-close the open loop with a reason note | update_record | — | N | [7c.24](7c-ai-decision-engine.md); identity match |

*(≈30 fixtures total; the intent is a tight, high-signal set, not exhaustive — expand per skill in [7f.8](7f-skills.md).)*

---

## Every AI job → the fixtures it needs (the "all our jobs" table you asked for)

*Not just user prompts — every background job with an AI component needs its own graded set. This is the map.*

| Job | What it does | Fixture set needed |
|---|---|---|
| H1 — next-action proposals | Draft the post-call stack | #1, #6, #21–#23 (draft quality: email/task/invite) |
| H2 — enrich | Per-field waterfall | #4, #7, #24, #26, #28 + the [7d](7d-enrichment.md) golden set (per-field match-rate) |
| H3 — recompute AI fields | Summaries on activity | Summary-quality fixtures (LLM-as-judge on a rolling summary) |
| H4 — signal research | Hiring/funding/job-change | Signal-precision fixtures (did it find a real, dated, cited signal?) |
| H5 — skill runs | A skill over a selection | Each skill's own golden set ([7f.8](7f-skills.md)) |
| Decision engine wake ([7c](7c-ai-decision-engine.md)) | The five-move think | #29, #30 + chronology fixtures (resolve/wait/act/ask/hand-back correctness) |
| Gate ([7c.12](7c-ai-decision-engine.md)) | "Worth a full think?" | Gate precision/recall fixtures (did it correctly skip vs. escalate?) |
| Live-call extractor ([7c](7c-ai-decision-engine.md)) | Structured items mid-call | Transcript fixtures with hand-labeled commitments/next-steps |
| Data-chat agent ([7e](7e-agent-surface.md)) | Answer + change data | #1–#20 (this doc's set A) |

---

## What's hard about all of this (the honest part)

The fixtures surface where this gets genuinely difficult — worth naming so we grade the right things:

1. **Judgment, not lookup.** Fixtures like #3, #12, #29 hinge on the AI *deciding* ("are these good targets?", "is this deal at risk?", "should I nudge or hand back?"). These have **no single right answer**, so we grade with an **LLM-as-judge + human spot-checks**, not string-match — and accept a score, not a pass/fail. This is the hardest eval category.
2. **Multi-step runs compound error.** #3 chains research → source → enrich → create. A 90%-correct step, four deep, is ~66% end-to-end. We grade **each step** and the **whole chain**, and design the chain to **checkpoint** so a late failure doesn't discard early good work.
3. **Actions need a sandbox to grade end-to-end.** A read fixture (#16) grades on the answer; an action fixture (#2, #9) only truly grades if the write happens. So we run action fixtures against a **seeded test workspace** with the real tools, and diff the resulting records against the expected state — heavier than text evals, but the only honest way to grade actions.
4. **Time-based fixtures need a clock.** #29/#30 depend on "the promised date arrived" / "a reply came." We grade these by **simulating the timeline** (inject the events, advance a virtual clock) — a fixture is a *chronology*, not a single prompt.
5. **The gate is graded on what it *skips*.** A false "skip" silently drops work; a false "escalate" wastes money. Its fixtures need **labeled negatives** (events that should be ignored), which are tedious to author but essential.
6. **Provenance is gradable, and should be.** Every written value must carry a source ([7k](7k-provenance.md)); a fixture fails if the value is right but the source is missing or wrong — that catches confident hallucinations.
7. **Cost is a grading dimension.** Two runs can both be "correct" but one costs 10×. We track **tokens/cost per fixture** so a cheaper prompt that holds quality wins (feeds the [7c cost design](7c-ai-decision-engine.md)).

---

## Data model
Fixtures are golden sets attached to skills/jobs ([7f](7f-skills.md) `SkillGolden`), each row: input (a prompt, or an event chronology), expected actions/output, expected provenance, and a grading mode (match / LLM-judge / record-diff). The seeded test workspace is a fixture-only workspace the action fixtures run against.

## Cross-doc references preserved
Replaces the old prompt list. Referenced by: skills evals [7f.8](7f-skills.md), the decision engine [7c](7c-ai-decision-engine.md), enrichment [7d](7d-enrichment.md), the agent [7e](7e-agent-surface.md).
