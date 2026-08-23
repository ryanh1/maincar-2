# Doc 7c — The AI Decision Engine ("open loops")

Part of the **AI Copilot** family (head: [7 — AI Copilot](7-ai-copilot.md)). It **replaces the old "conditional reminders" journey (7b.3)** and is the thinking half of the event engine (the system that runs the AI on every call/email/meeting/timer — [7b.1](7b-copilot-automations.md)). Background working notes: [../ideas/decision-engine.md](../ideas/decision-engine.md) (the direction) and [../ideas/decision-engine-benchmarks.md](../ideas/decision-engine-benchmarks.md) (the 35-product benchmark study). **Every journey below now carries its own `Benchmark (beat this)` line**, naming the product, the exact aspect we are matching, and a link; each cites the factor in the research doc that it came from. Where no product does the thing, the line says so as an **open gap to beat** rather than staying silent.. The per-question coverage audit of the whole Doc 7 family is [../ideas/doc7-coverage-audit.md](../ideas/doc7-coverage-audit.md).

> **Scope check (read this first).** This engine is **one piece** of the eventual Doc 7 rewrite, not all of it. It owns *follow-ups and unprompted AI action*. It **uses** — but does not replace — enrichment, the skills library, provenance, and the data-chat agent; those stay their own features with their own docs. The full map is in *Coverage & mapping* at the end.

> **Numbering.** Journeys are numbered **7c.1–7c.32** and grouped into seven phases (A–G). The group letter is a *label* in the taxonomy table; the journey number (7c.N) is the reference used everywhere.

---

## What this is, in one paragraph

Today's plan (old 7b.3) treated a reminder as a **rule**: "remind me in 3 days unless they reply," and a fixed checklist decided when it was done. That is too rigid for real follow-up, which is full of judgment calls (when to check, what counts as "handled," what to do next, when to give up). New plan: **a reminder is a cue for the AI to think.** We call the thing the rep is waiting on an **open loop**. When a loop "wakes" — on its own scheduled check, or because something happened (a reply, a booking) — the AI re-reads the whole account and picks one of five moves: **resolve it, wait, act, ask the rep, or hand it back.** Almost nothing is stored on the loop itself; the AI works it out fresh each time. That is what lets it handle the messy cases a fixed rule can't.

This is **one engine for all unprompted AI** in the app — follow-ups, buying signals, deal-health changes, renewals are all "the AI wakes, reads context, decides, proposes or acts."

## Terms in one place (so you never have to read ahead)

- **Open loop** — the core object: something the rep is waiting on. Holds only: a plain-language *intent*, a *next-check* time, the *record* it's about, a *status*, and a little state (touches tried, budget used).
- **The gate** — a cheap first check that asks "is anything here worth a full, expensive think?" It kills ~80% of events cheaply. (Journey 7c.12.)
- **The five moves** — what a full think can decide: **resolve** (close it), **wait** (check again later), **act** (do/queue the next touch), **ask** (put a question to the rep), **hand back** (give up gracefully and ask what to do). (Journey 7c.13.)
- **The permission matrix** — a settings grid: for each kind of action (write a note, draft an email, *send* an email, change a deal stage…), is the AI allowed to do it on its own (**auto**), must it **ask** first, or is it **never** allowed? Claude-Code-style. (Journey 7c.27.)
- **Internal vs external** — *internal* = changes to our own database (a note, a stage, marking a phone number dead). *External* = anything that leaves the building and reaches a person (an email, a text). Default: internal is automatic, external is drafted and put in a queue for the rep to approve.
- **The post-call stack** — the list of ready-to-approve actions that pops up when the rep hangs up (this already exists, Doc 7.1). The engine feeds items into it.
- **The away-queue + digest** — when the rep is away from the screen, drafts wait in a queue and get summarized in a **twice-a-day digest** ("here's what I lined up"), with urgent items allowed to break through. (Journey 7c.17.)
- **The "needs you" tray** — where the AI parks genuine judgment questions for the rep. (Journey 7c.19.)
- **The escalation ladder** — a multi-step chase the AI runs itself (email → second email → try another contact → call), deciding each step, while the rep approves every outbound one. (Journey 7c.15.)
- **Provenance** — the saved record of where each AI value came from and why (already a Doc 7.9 feature). Every AI write keeps one.
- **The event engine (7b.1)** — the plumbing that fires the AI on each call/email/meeting/timer. This doc is its "brain"; 7b.1 is its "nervous system."
- **A skill** — a written instruction set for the AI (plain-language, sometimes with a small script). "What good follow-up looks like" is a skill. (Doc 7f is the skills library; Journey 7c.28 here is how the engine uses them.)

### Rules inherited from Doc 7

- **The model is chosen by the super-admin** (our internal admin) on the backend — no per-rep model picker. Under the hood we use three tiers (default IDs, swappable): **`claude-haiku-4-5`** for the gate (cheap, runs on every event), **`claude-sonnet-5`** for the decision (the five-move think), and **`claude-opus-5`** only for rare hard cases. Speed/cost drive the gate to Haiku; accuracy drives the decision to Sonnet; Opus is reserved for the small set of genuinely hard judgments.
- **Every AI-written value keeps its provenance** (where it came from). No exceptions.
- **North star: trust over leverage.** When unsure, it asks. We accept it doing a bit less so it never does something embarrassing on its own.

## How the journeys are grouped (the taxonomy)

Slicing by sales scenario ("follow up before a meeting") is the wrong cut — endless and too specific. We slice by **what the engine is doing** (its phase), and split the trigger phase by channel. Seven groups:

| Group | Phase (plain English) | Journeys |
|---|---|---|
| **A** | **Trigger** — what wakes the AI | **7c.1–7c.11**, by source: call, email, text, voicemail, calendar, CRM change, timer, rep prompt, rep edit |
| **B** | **Decide** — what it works out on waking | **7c.12** the gate · **7c.13** the five moves · **7c.14** create/re-arm a loop · **7c.15** the escalation step |
| **C** | **Surface & approve** — depends on where the rep is | **7c.16** in-app · **7c.17** away (queue + digest) · **7c.18** on a call · **7c.19** "needs you" · **7c.20** Slack/text |
| **D** | **Act** | **7c.21** auto internal · **7c.22** approved external · **7c.23** undo |
| **E** | **Close & learn** | **7c.24** auto-close · **7c.25** hand back · **7c.26** learn from accept/edit/reject |
| **F** | **Configure** | **7c.27** permission grid · **7c.28** write a skill · **7c.29** on/off · **7c.30** earn autonomy |
| **G** | **Audit** | **7c.31** rep sees a loop's history · **7c.32** super-admin sees full traces |

**Doc 7 tags** on each journey: **NEW** (nothing like it in Doc 7) · **RETHOUGHT** (existed but fundamentally changed) · **FROM 7x** (moves in mostly intact). Full table at the end.

## Reference — every trigger → what runs on it (answers 7b.1.2)

*You asked for a table tracking every trigger: which skills run, which tools are made available, and a brief system-prompt summary. Here it is. ("Skills" are defined in [7f](7f-skills.md); the internal "good follow-up" skill is ours, not user-editable. Tools follow the [7e.4 contract](7e-agent-surface.md).)*

| Trigger event | Skills that run | Tools made available | System-prompt summary (brief) |
|---|---|---|---|
| `call.transcript.chunk` (live) | live-extractor · wrong-person · name-capture | read record; stage drafts only (no writes mid-call) | "From this finalized turn, pull commitments, meetings-agreed, callbacks, and wrong-person signals — each with a supporting quote." |
| `call.ended` | next-action-drafter · qualification-fill · good-follow-up | read; create task/note (internal, auto); draft email/invite (queued) | "Draft the ranked post-call stack and open any 'waiting-on-them' loops the call implies." |
| `email.received` | reconcile-loops · good-follow-up | read; update/close loop (internal); draft reply (queued) | "Does this satisfy an open loop (close it) or need a reply (draft one)?" |
| `email.sent` | open-expectation-loop | read; create loop (internal) | "Did this create something to wait on? If so, open a loop with a next-check taken from the text." |
| `sms.received` | reconcile-loops | read; update loop; draft reply (queued) | (same as `email.received`, over SMS; match on person, any channel) |
| `voicemail.received` | no-connect-drafter · reconcile-loops | read; draft email (queued); update loop | "No-connect → draft a 'tried you' email; a callback → close the waiting loop." |
| `calendar.event.*` | calendar-sync-judgment | read; update loop/task (internal); draft re-propose (queued) | "Interpret accept/decline/reschedule/cancel and update or re-open the linked loop." |
| `record.updated` (owned) | stage-loop-reconcile · offer-follow-through | read; update loop (internal); propose task/email (queued) | "Did this change resolve a loop, or is there an obvious follow-through to propose (never auto-fire)?" |
| `schedule.cron` / `due_date.reached` | gate → good-follow-up → escalation | read; internal writes auto; external drafts queued | "Re-read the account and pick one move: resolve / wait / act / ask / hand back." |
| user prompt (via the agent, 7e) | the requested skill | the full tool set, behind the accept-before-external gate | "Do what the rep asked; route any external action through approval." |

---

## Group A — Triggers (what wakes the AI)

Every event first hits **the gate** (Journey 7c.12 — the cheap "worth a full think?" check) before any expensive work. **v1 rule: the AI only acts on records the rep owns** — a teammate editing their own account won't push work into this rep's queue. (We can widen this to shared records later.)

## Journey 7c.1 — On a live call, the AI hears something worth acting on
*As a rep, I want the AI to catch promises and cues while I talk, so the follow-up is ready the second I hang up.*
- **Wakes on:** a finalized chunk of the live call transcript.
- 1. A lightweight live "listener" (explained in *Live-call architecture* below) spots things: a promise ("I'll send pricing Friday"), a meeting agreed, a "call me back Thursday," or that the rep reached the wrong person.
- 2. Each becomes a **staged draft** and/or a pending open loop. Nothing pops up mid-call by default — it collects for the post-call stack (the approve-list that appears at hang-up).
- 3. At hang-up, that stack finalizes (Journey 7c.2).
- **Doc 7 tag:** RETHOUGHT of the old 7b.4/7b.5/7b.7 recipes (meeting-agreed, call-me-back, wrong-person) — they now flow through this engine instead of each firing on its own.
- **Benchmark (beat this):** AssemblyAI — Universal-Streaming [how it works: immutable transcripts and Turn objects, so an extractor never thrashes on rewritten partials] — https://www.assemblyai.com/docs/streaming/universal-streaming ; Deepgram — Flux [how it works: an end-of-turn event, ~260ms P50, as the natural extraction trigger] — https://deepgram.com/learn/introducing-flux-conversational-speech-recognition ; VAPI — structured outputs [how it works: the *post-call-only* limit we are beating] — https://docs.vapi.ai/assistants/structured-outputs . **Open gap to beat (no product to copy):** nobody sells live structured extraction on a *human-run* call — you assemble it. Full analysis: benchmarks doc, Factor 7.

## Journey 7c.2 — At hang-up, finalize the approve-list (the "post-call stack")
*As a rep, I want a ranked, pre-filled list the moment I hang up, so I clear it with the keyboard.*
- **Wakes on:** the call ending.
- 1. The AI drafts the ranked actions (email / task / meeting / field changes) and opens any "waiting on them" loops the call implies.
- 2. The rep clears the list with Enter/Tab/Esc (the existing Doc 7.1/7.2 flow).
- **Doc 7 tag:** FROM 7.1 / 7.2 (that surface is unchanged); this doc just adds *which actions become open loops*.
- **Benchmark (beat this):** Salesloft Rhythm [how it works: a signal-to-action system that re-ranks in real time and attaches a "why this action" rationale to every item] — https://www.salesloft.com/company/newsroom/salesloft-announces-rhythm-powered-by-conductor-ai ; the accept/edit/reject surface itself is Doc 7.1/7.2, benchmarked there. Benchmarks doc, Factor 2.

## Journey 7c.3 — An email comes in → close the loop, or draft a reply
*As a rep, I want a reply to auto-close the "waiting on them" loop, and if it needs an answer, get a draft ready.*
- **Wakes on:** an inbound email matched to a contact.
- 1. Gate: does this contact have an open loop, or does the email need an action?
- 2. If the reply is the thing the loop was waiting for → **auto-close** the loop (7c.24) with a short reason note.
- 3. If it needs a reply → draft one and put it in the away-queue (7c.17), or into the post-call stack if the rep is on a call.
- **Doc 7 tag:** RETHOUGHT of 7b.3 (a reply used to clear a reminder via a fixed rule) — now matched on *who the person is* (any channel counts) and judged by the AI, not a fixed dropdown.
- **Benchmark (beat this):** Superhuman — "Remind me if no reply" [how it works: the reminder cancels itself the instant a reply lands] — https://new.superhuman.com/remind-me-regardless-30768 ; Fyxer [how it works: drafts land in the native drafts folder, never auto-sent, so approval needs no new UI] — https://support.fyxer.com/article/meet-fyxer-your-ai-email-and-meeting-assistant . *We beat both by matching on contact identity across channels, not on one email thread.* Benchmarks doc, Factor 4.

## Journey 7c.4 — The rep sends an email → open a "waiting on" loop
*As a rep, I want the AI to remember what I'm now waiting for, so I don't set a manual reminder.*
- **Wakes on:** an outbound email being sent.
- 1. Gate + judgment: does this create something to wait on (a proposal, an ask)? If yes, the AI opens an open loop ("waiting on Dana re: proposal"), with a next-check time taken from the email if it's stated ("by Monday" → check Tuesday), otherwise a sensible default.
- **Doc 7 tag:** NEW (the AI setting its own cue).
- **Benchmark (beat this):** Outreach — out-of-office detection [how it works: it parses the stated *return date* out of the reply and reschedules the next touch to it — the content of the signal sets the next-check time] — https://www.outreach.ai/resources/blog/out-of-office-reply-detection-managing-prospects-and-tasks-with-outreach ; HubSpot — prospecting agent [how it works: outbound work creates a queued follow-up rather than a fire-and-forget send] — https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent . Benchmarks doc, Factor 4.

## Journey 7c.5 — A text comes in → close/propose

*As a rep, I want an inbound text to close a waiting loop or get a reply drafted, so texts are handled like emails.*

- **Wakes on:** an inbound SMS. Same shape as 7c.3, over text; a text reply counts as "handled." **Doc 7 tag:** RETHOUGHT of the 7b.3 "text to confirm samples" case.
- **Benchmark (beat this):** Lindy — AI inbox management [how it works: the approval and the reply both happen in the channel the user already lives in, including SMS] — https://www.lindy.ai/blog/ai-inbox-management ; the email twin of this journey is 7c.3, same auto-close rule. Benchmarks doc, Factor 3.

## Journey 7c.6 — A voicemail (or a no-answer) → draft a follow-up

*As a rep, I want a no-answer or voicemail to trigger the right follow-up on its own, so I don't chase dead air.*

- **Wakes on:** a voicemail or a call that didn't connect. A no-answer drafts a short "tried to reach you" email into the queue; a callback voicemail can close a "waiting for callback" loop. **Doc 7 tag:** FROM 7b.6, routed through the engine.
- **Benchmark (beat this):** Nooks — auto-skip answering machines while power dialing [how it works: a no-connect is classified, not just logged] — https://support.nooks.ai/articles/6503054824-auto-skip-answering-machines-while-power-dialing ; HubSpot — prospecting agent [how it works: the "tried to reach you" draft goes to a review queue] — https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent .

## Journey 7c.7 — A calendar change → update or re-open the loop
*As a rep, I want a decline or reschedule to change my follow-up automatically — not silently mark it done.*
- **Wakes on:** a meeting being accepted / declined / rescheduled / cancelled.
- 1. **Accepted** → the "confirm the meeting" loop resolves.
- 2. **Rescheduled** → the loop's due date moves with it.
- 3. **Declined** → do **not** mark done; rewrite the loop to "re-propose times" and flag a deal risk (a "needs you," 7c.19).
- 4. **Cancelled** → cancel an AI-created loop; leave a rep-created one open.
- **Doc 7 tag:** RETHOUGHT of 7b.13 (the calendar↔task sync). The task↔meeting link model from 7b.13 stays as the plumbing; the *decision* about what a state change means is now the AI's.
- **Benchmark (beat this):** Outreach / HubSpot — auto-unenroll on *meeting booked* [how it works: a booking is a terminal state for the chase] — https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent ; Superhuman — auto-cancel on the awaited event — https://new.superhuman.com/remind-me-regardless-30768 . **Open gap to beat:** neither distinguishes *declined* from *done* — treating a decline as a re-open plus a deal risk is ours. Benchmarks doc, Factor 4.

## Journey 7c.8 — A CRM change (that I made, on my record) → react

*As a rep, I want moving a deal's stage to resolve the loop that was waiting on it, so I don't clear reminders by hand.*

- **Wakes on:** a field/stage change on a record the rep owns. E.g. moving a deal to "Proposal" resolves a "push to Proposal" loop; moving it to "Closed" resolves a "chase until Won/Lost" loop. **Doc 7 tag:** RETHOUGHT of the 7b.3 stage-change cases.
- **Benchmark (beat this):** Attio — Automations [how it works: triggers on record create/update, on a *specific field-value* change such as deal stage or owner, and on time-based delays after a record event] — https://attio.com/blog/introducing-attio-automations . Benchmarks doc, Factor 1.

## Journey 7c.9 — A scheduled check comes due (the core wake) ⭐
*As a rep, I want the AI to re-check an open loop on its own date and work out the right next move, so nothing falls through.*
- **Wakes on:** a loop's next-check time arriving (background job DE-Wake — a scheduled timer per loop).
- 1. Gate (7c.12): has anything meaningful changed, or is a decision genuinely due? If not, cheaply set the next check and stop.
- 2. If yes → the full think (7c.13) runs over fresh context and picks one of the five moves.
- **Doc 7 tag:** RETHOUGHT of 7b.3 — the due date is now a *cue to think*, not a trigger to fire a pre-set action.
- **Benchmark (beat this):** OpenAI — Scheduled Tasks [how it works: "monitoring tasks" wake on a timer, *remember previous runs*, notify only when there is something worth reporting, and stop when an end condition is met — almost exactly our open loop] — https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt ; Manus — Scheduled Tasks 2.0 [how it works: a recurring run continues inside the *same task context* rather than restarting from zero] — https://manus.im/docs/features/scheduled-tasks ; Devin — automations [how it works: the distinction between starting a fresh session and feeding an event into one persistent long-running session] — https://docs.devin.ai/product-guides/automations . Benchmarks doc, Factor 2 and Factor 4.

## Journey 7c.10 — The rep asks the AI (chat / command bar / record sidebar)
*As a rep, I want to tell the AI to do something and have it use the same guardrails.*
- **Wakes on:** the rep typing or dictating a request (the Cmd-J chat, the top command bar, or the AI panel on a record — all part of the data-chat agent, [7e](7e-agent-surface.md)).
- 1. The agent uses the same tools + the same approve-before-external gate. A request can also **create an open loop** ("remind me to chase this unless they reply").
- **Doc 7 tag:** FROM 7.4 / 7.11; this doc adds "a request can open a loop."
- **Benchmark (beat this):** Claude Code [how it works: one agent, one tool contract, the same approval gate whether the work was asked for or self-started] — https://code.claude.com/docs/en/how-claude-code-works ; the chat surface itself is [7e](7e-agent-surface.md), benchmarked there.

## Journey 7c.11 — The rep edits the CRM by hand → the AI offers to help
*As a rep, when I change something myself, I want the AI to offer the obvious next step — but never do it silently.*
- **Wakes on:** the rep editing a record (e.g. setting a deal to "At risk").
- 1. Gate + judgment: is there an obvious follow-through (open a task, draft a save-the-deal email)? If so, **propose** it (in-app or in the queue). It never auto-fires off a human edit.
- **Doc 7 tag:** NEW.
- **Benchmark (beat this):** Attio — Automations [how it works: a field-change trigger, which is the wake; the *judgement* about what the edit implies is ours] — https://attio.com/blog/introducing-attio-automations ; Lindy — triggers and trigger filters [how it works: filters sit at the entry point so most events die before any inference] — https://docs.lindy.ai/fundamentals/lindy-101/triggers . **Open gap to beat:** neither proposes a follow-through off a human edit. Benchmarks doc, Factor 1.

---

## Group B — Decide (what the AI works out on waking)

## Journey 7c.12 — The gate: is this worth a full think? ⭐
*As the company, I want a cheap check to decide whether to spend a full (expensive) think, so cost stays sane.*
- **Runs on:** every trigger and every scheduled wake.
- 1. A **simple rules + cheap-model** check asks: is there meaningful new context, or is a decision genuinely due? It reads a short, always-fresh account summary — not the whole history.
- 2. **No** → drop it, or cheaply set the next check; log that it was skipped.
- 3. **Yes** → hand off to the full think (7c.13).
- **Why it matters:** it kills ~80% of events cheaply — the difference between a modeled ~$59k/month and ~$4k/month bill (see *Cost*).
- **Doc 7 tag:** NEW. (Open sub-decision: pure rules vs. a tiny classifier vs. a cheap model — start with rules + a cheap model, tune later.)
- **Benchmark (beat this):** Lindy — trigger filters [how it works: the cheapest gate is the one that runs before any model does] — https://docs.lindy.ai/fundamentals/lindy-101/triggers ; LLM model routing [how it works: published routers report 40–70% cost cuts at <2% quality loss] — https://www.digitalapplied.com/blog/llm-model-routing-2026-cost-quality-optimization-engineering-guide ; Anthropic — prompt caching [how it works: the 5-minute default TTL, which is *why* the gate has to be scheduled around bursts rather than run blind] — https://platform.claude.com/docs/en/build-with-claude/prompt-caching . Full cost math: benchmarks doc, Factor 6.

## Journey 7c.13 — The full think (the five moves) ⭐
*As a rep, I want the AI, each time it wakes, to work out what I'd want by now and either handle it or ask me.*
- **Runs on:** the gate saying "yes."
- 1. Load **as much context as it can**: the account's emails/calls/meetings/notes/stage, the loop's original intent, prior touches, and its own prior decisions.
- 2. Apply the internal **"good follow-up" skill** (our own instructions, not shown to users) plus any custom skills the workspace/rep added (7c.28).
- 3. Pick **one** move:
  - **Resolve** → close the loop (an internal action, so automatic), leave a short reason note (7c.24).
  - **Wait** → set the next check (timing taken from the signal — see the rule below), no rep involvement.
  - **Act** → internal changes happen automatically (per the permission grid); external touches are drafted and queued (7c.17), or added to the post-call stack (7c.18).
  - **Ask** → put a judgment question to the rep (7c.19).
  - **Hand back** → out of runway → ask the rep what to do (7c.25).
- 4. **Double-check step:** for any *big or irreversible* action (send an email, mark a deal Won), a second model reviews the decision before it's queued or applied. Cheap internal edits skip this.
- **Doc 7 tag:** NEW (the whole loop). This is what replaces the old fixed-rule reconcile of 7b.3.
- **Benchmark (beat this):** Salesloft Rhythm [how it works: rank the actions *and* attach a rationale, so a re-decision is auditable] — https://www.salesloft.com/company/newsroom/salesloft-announces-rhythm-powered-by-conductor-ai ; Sierra [how it works: a **supervisor LLM** inspects the primary agent's reasoning and sends it back with notes — chaining two ~90% models toward ~99% — which is our step-4 double-check] — https://sierra.ai/blog/agent-development-life-cycle ; Decagon — layered guardrails [how it works: irreversible steps are pulled out of the model into deterministic code, wrapped before/during/after] — https://decagon.ai/resources/designing-layered-guardrails-for-reliable-ai-agents . Benchmarks doc, Factor 2 and Factor 3.

## Journey 7c.14 — Create or re-arm a loop (rep or AI)
*As a rep, I want to set "watch this" in plain words; and I'm OK with the AI opening its own loops, as long as I can see them.*
- **Starts from:** a rep request/quick-picker, or the AI (7c.4, 7c.2, or a 7c.13 "wait").
- 1. **Rep path:** plain language ("follow up unless Dana replies with a real reason to hold") or a quick picker; the AI pulls out the *intent*, the *next-check* time, and the *record*.
- 2. **AI path:** the AI opens the loop on its own (this is an internal, cheap, reversible action). It shows up in the audit view (7c.31) and the rep can delete it.
- 3. The loop stores only: intent, next-check, record, status, a little state (touches/budget), and provenance (who created it + the original words).
- **Doc 7 tag:** RETHOUGHT of 7b.3's "set it" — plain language is now first-class (not squeezed into a fixed dropdown); **AI opening its own loops is NEW.**
- **Benchmark (beat this):** OpenAI — Scheduled Tasks [how it works: a task is created in plain language and carries its own end condition] — https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt ; Lindy — "Ask for Confirmation" [how it works: the pending action is held as a **draft object** the user can edit, approve, or delete — the shape our loop takes] — https://docs.lindy.ai/testing/human-in-the-loop . **Open gap to beat:** none of these lets the *agent* open its own durable loop and show it to the user for deletion.

## Journey 7c.15 — The escalation ladder (one step at a time)
*As a rep, I want the AI to run a sensible multi-week chase, deciding each next touch itself, while I approve every outbound one.*
- **Starts from:** a "wait/act" where earlier touches went unanswered.
- 1. The AI decides the **next touch and its timing** from context + the "good follow-up" skill (not a rep-programmed sequence): e.g. email → second email → try a different contact → "call them" task.
- 2. Internal steps happen automatically; each **outbound step is drafted and queued** for approval (7c.17).
- 3. **Soft stop:** a dead end (a bounced email, an explicit "no," a dead number) stops it at once; a default **budget (3 touches or 14 days, whichever comes first)** triggers a check-in with the rep (7c.25), *not* a silent kill. The numbers live in settings.
- **Doc 7 tag:** NEW. (On purpose *not* the rule-based sequence tool of Doc 15 — this is adaptive and AI-authored.)

### The next-check timing rule (used by "wait" and the ladder)
Take the next-check time from **what was actually said** where possible ("I'll get back Monday" → Tuesday morning; an out-of-office → the stated return date); otherwise a sensible default. **Doc 7 tag:** RETHOUGHT of 7b.3's fixed due date. (Modeled on Outreach reading an out-of-office date — see benchmarks.)
- **Benchmark (beat this):** UserGems — job-change playbooks [how it works: signals are treated as **perishable** — act within 7 days, then 10–12 touches over 40–60 days — the concrete model for how long a loop should chase before going cold] — https://www.usergems.com/blog/track-job-changes ; Outreach — out-of-office detection [how it works: the next-check time comes from what was actually said] — https://www.outreach.ai/resources/blog/out-of-office-reply-detection-managing-prospects-and-tasks-with-outreach . *We are deliberately not benchmarking the rule-based sequence tools here (that is Doc 15) — this ladder is AI-authored.* Benchmarks doc, Factor 4.

---

## Group C — Surface & approve (depends on where the rep is)

## Journey 7c.16 — In-app: approve inline while watching
*As a rep in the app, I want proposals right there so I clear them fast.* — This is the post-call stack / AI panel (Journeys 7.1/7.2). **Doc 7 tag:** FROM 7.1.
- **Benchmark (beat this):** Claude Code — permission modes, including plan mode [how it works: read-only until an explicit approval step releases the change — a built-in propose-then-approve gate] — https://code.claude.com/docs/en/permission-modes ; Intercom Fin Copilot [how it works: the accept/edit/reject interaction, two keystrokes] — https://www.intercom.com/help/en/articles/8587194-how-to-use-copilot . The surface itself is Doc 7.1, benchmarked there.

## Journey 7c.17 — Away: a queue + a twice-a-day digest (plus urgent break-through) ⭐
*As a rep away from my screen, I want the AI's queued work summarized — not streamed at me — unless it's truly urgent.*
- **Starts from:** the AI queued external drafts / took internal actions while the rep was away.
- 1. Drafts land in a **queue** the rep can edit, approve, or delete.
- 2. A **digest** goes out **morning and afternoon** (background job DE-Digest — a scheduled timer): "here are the 6 things I lined up, and here's what I did on my own." Each item is one-tap approvable from the digest.
- 3. **Urgent break-through:** a genuinely time-sensitive item (a hot prospect replied; a deal at risk) can notify right away — a rare, curated exception, not the default.
- **Doc 7 tag:** NEW (Doc 7 has nothing for the away case). *Locked with you: digest + urgent break-through.* (Modeled on Cora's twice-daily brief + HubSpot's daily draft digest.)
- **Benchmark (beat this):** Cora [how it works: a **Brief twice daily**, morning and afternoon — the digest cadence *is* the anti-nag mechanism] — https://every.to/p/introducing-cora-manage-your-inbox-with-ai ; HubSpot — prospecting agent [how it works: a daily digest of drafts awaiting review] — https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent ; OpenAI — Watch Mode [how it works: autonomy **auto-pauses** when the user goes inactive or navigates away] — https://deploymentsafety.openai.com/chatgpt-agent/watch-mode . **Open gap to beat (no visual benchmark):** none of the three publishes its digest UI — the digest layout and the one-tap approve inside it are ours to draw. Benchmarks doc, Factor 3.

## Journey 7c.18 — On a call: hold everything for the post-call stack
*As a rep on a call, I don't want to be interrupted — queue it for hang-up.* — Items staged during a call (7c.1) only appear in the post-call stack. **Doc 7 tag:** NEW (an explicit "on a call" rule).
- **Benchmark (beat this):** OpenAI — Watch Mode [how it works: the agent holds rather than interrupts when the user's attention is elsewhere] — https://deploymentsafety.openai.com/chatgpt-agent/watch-mode ; Gong's post-call-only stance is the counter-example we are splitting the difference with (cheap live pass, rich pass at hangup — benchmarks doc, Factor 7). **Open gap to beat:** "the rep is mid-call" is not a state any of these products models.

## Journey 7c.19 — The "needs you" question
*As a rep, when the AI hits a real judgment call, I want it to ask me clearly, not guess.*
- **Starts from:** a 7c.13 "ask" (e.g. "Dana said John arrives Thursday — hold the follow-up until Friday?").
- 1. The question goes to a **"needs you" tray** (and into the digest if the rep is away), showing the AI's read, the choices, and a one-tap answer.
- 2. The answer feeds back into the loop and into learning (7c.26).
- **Doc 7 tag:** NEW (this is the "surface the ambiguity to the rep" idea). Modeled on Salesforce asking a clarifying question mid-task, and on Claude Code / Codex asking a short structured question.
- **Benchmark (beat this):** Intercom Fin [how it works: "ask a human" is a guaranteed fallback, gated on a confidence threshold, and it never offers escalation twice in a row] — https://www.intercom.com/help/en/articles/9929230-the-fin-ai-engine ; Salesforce Atlas [how it works: asking a structured clarifying question mid-task instead of guessing] — https://www.salesforce.com/agentforce/what-is-a-reasoning-engine/atlas/ . **Open gap to beat (no visual benchmark):** the "needs you" tray as a standing surface is ours. Benchmarks doc, Factor 3.

## Journey 7c.20 — Approve from Slack or text [LATER]
*As a rep, I want to approve from where I already am.* — Push the item + a one-tap yes to Slack/SMS. **Doc 7 tag:** NEW; parked. Ties to Doc 11a (Slack).
- **Benchmark (beat this):** Lindy [how it works: it texts you the draft for a yes/no, so approval reaches you outside the app] — https://www.lindy.ai/blog/ai-inbox-management ; Zapier — agent activity [how it works: a standing **"Needs action"** section rather than a stream of pings] — https://help.zapier.com/hc/en-us/articles/33336184962573-Review-your-agent-s-activity ; the Slack plumbing is [11a](11a-slack-integration.md). Benchmarks doc, Factor 3.

---

## Group D — Act

## Journey 7c.21 — Do an internal change automatically

*As a rep, I want the AI to make safe internal edits on its own, so I'm not approving low-stakes housekeeping.*

Internal changes (a note, a stage, marking a number dead, setting the next check) happen on their own (per the permission grid), each keeping its provenance. **Doc 7 tag:** FROM 7.9 + the existing "perform an approved action" job; the grid default of "auto" for internal is NEW.
- **Benchmark (beat this):** Salesloft Rhythm and Clari [how it works: mature products auto-write their *own* CRM fields without asking — internal-write-auto is the market consensus, not a risk we are inventing] — https://www.salesloft.com/company/newsroom/salesloft-announces-rhythm-powered-by-conductor-ai ; Decagon [how it works: the few irreversible internal steps are pulled out of the model into deterministic code] — https://decagon.ai/resources/designing-layered-guardrails-for-reliable-ai-agents . Benchmarks doc, headline finding 1.

## Journey 7c.22 — Do an approved external action

*As a rep, I want an approved email or text to send reliably and only once, so I trust that "accept" means done.*

Once the rep approves, the action runs through the **same code the manual buttons use** (so there's no second copy to keep in sync), and it's safe to retry without double-acting — only one job per loop can run at a time, so an early reply and a scheduled check can't both fire and act twice. **Doc 7 tag:** FROM 7.1; adds the one-job-per-loop safety (the "exactly once" lesson from the research).
- **Benchmark (beat this):** Temporal — human-in-the-loop [how it works: an Activity that already executed is never re-run on replay, so a re-woken loop cannot double-write] — https://docs.temporal.io/ai-cookbook/human-in-the-loop-python ; Trigger.dev — waitpoint tokens [how it works: the run pauses and stops billing while it waits for the approval] — https://trigger.dev/docs/guides/example-projects/human-in-the-loop-workflow . *We are on pg-boss, so the transferable part is the idempotency + singleton-per-loop discipline, not the engine.* Benchmarks doc, Factor 4.

## Journey 7c.23 — Undo

*As a rep, I want a few seconds to undo an internal change, so a wrong move is cheap to reverse.*

A 5–10 second undo on internal changes. A *sent* external action can't be un-sent — which is exactly why external actions are queued and never auto-sent. **Doc 7 tag:** FROM 7.1 / 7.9.
- **Benchmark (beat this):** Sierra [how it works: deterministic guardrails plus instant rollback of an agent action] — https://sierra.ai/blog/agent-development-life-cycle ; Gmail — undo send [how it works: the short cancel window, and its hard limit — once it is gone it is gone, which is exactly why external actions are queued and never auto-sent] — https://support.google.com/mail/answer/2819488 .

---

## Group E — Close & learn

## Journey 7c.24 — Auto-close when the thing you waited for happens
*As a rep, I want a loop to close itself the moment the thing I was waiting for happens.* — Matched on **who the person is** (a reply on any channel counts, not just one email thread); marks it done with a short reason note; keeps a 7-day undo/reopen. **Doc 7 tag:** RETHOUGHT of 7b.3's auto-complete (we keep the nice "reason note + undo" behavior; we replace the fixed-condition matching with person-matching + AI judgment).
- **Benchmark (beat this):** Superhuman — "Remind me if no reply" [how it works: the reminder cancels the moment a reply lands] — https://new.superhuman.com/remind-me-regardless-30768 ; HubSpot — auto-unenroll on reply or meeting booked [how it works: "handled" as a state, not a manual tick] — https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent . *We beat both by matching on contact identity across channels, and by keeping a 7-day reopen.* Benchmarks doc, Factor 4.

## Journey 7c.25 — Hand back at a dead end or budget

*As a rep, when the AI runs out of good moves, I want it to ask me what to do, so it never chases forever or gives up silently.*

The soft stop (7c.15) asks a real question: "3 touches, 2 weeks, no reply — keep nudging monthly, try another contact, or mark it cold?" **Doc 7 tag:** NEW.
- **Benchmark (beat this):** Intercom Fin [how it works: "ask a human" is the guaranteed fallback — the agent never dead-ends silently] — https://www.intercom.com/help/en/articles/9929230-the-fin-ai-engine ; UserGems [how it works: an explicit touch/day budget per signal, so a chase has a defined end] — https://www.usergems.com/blog/track-job-changes . **Open gap to beat:** these stop; none of them hands back with a *choice* of next moves.

## Journey 7c.26 — Learn from what the rep accepts, edits, and rejects
*As the company, I want the AI to improve from what reps accept, tweak, and reject.*
- 1. Every accept / edit / reject (plus every "needs you" answer, and every AI-created loop the rep deletes) is saved with the proposal and context.
- 2. How often each kind of action gets edited or rejected feeds the "earn autonomy" ramp (7c.30) and the test set (Doc 7a); a rejected value can be added to that test set so the same mistake can't return (Journeys 7f.8 / 7.9).
- **Doc 7 tag:** RETHOUGHT/extended from 7.1 + 7.9 (we already save accept/edit/reject; this turns it into the learning and graduation signal).
- **Benchmark (beat this):** Superhuman [how it works: after auto-drafts made embarrassing calls, the fix was treating every user **rejection as a durable preference** — and never defaulting to commitments like prices, dates, or terms] — https://techcrunch.com/2026/07/14/superhumans-new-auto-draft-feature-almost-makes-me-like-ai-replies/ ; Ada — AI coaching [how it works: refine by reviewing past conversations, and corrections auto-apply forward] — https://www.ada.cx/blog/how-ai-coaching-transforms-your-ai-agent-into-a-customer-service-powerhouse/ . Benchmarks doc, Factor 3.

---

## Group F — Configure

## Journey 7c.27 — Set the permission grid (auto / ask / never) ⭐
*As an admin, I want to decide what the AI may do on its own, what it must ask about, and what it may never do — like Claude Code's settings.*
- **Where:** Settings → Intelligence → AI permissions.
- 1. Rows = **kinds of action** (write a field, create a task, draft an email, **send** an email, send a text, change a deal stage, change to Won/Lost, run enrichment, do a bulk action, change a setting…). Columns = **auto / ask / never**.
- 2. **"Never" wins over "ask" wins over "auto,"** and it's layered: **the admin owns the "never" list** (nobody can override it); a rep can make their own things *stricter* (auto→ask) but can't loosen past the admin's floor.
- 3. Where useful, a threshold ("auto below 20 records or $X; ask above").
- **Guard:** the "auto" list is never trusted as a security wall for irreversible actions — those always go through the approve-queue. (A lesson from the research: an allowlist is convenience, not security.)
- **Doc 7 tag:** NEW. This is the single biggest new concept.
- **Benchmark (beat this):** Claude Code [how it works: a `permissions` object with `allow` / `ask` / `deny` arrays in `Tool(specifier)` syntax] — https://code.claude.com/docs/en/settings + permission modes — https://code.claude.com/docs/en/permission-modes ; Devin [how it works: a tiered ACL evaluated **deny → ask → allow**, scoped (`Read`/`Write`/`Exec`/`Fetch`) and layered org / team / session / project / user, where an **org-level deny cannot be overridden** — the exact layering our admin floor needs] — https://docs.devin.ai/cli/reference/permissions ; Vercel AI SDK [how it works: `needsApproval` as a **function of the tool input**, not a flat toggle — this is how the "auto below 20 records or $X" threshold is expressed] — https://ai-sdk.dev/cookbook/next/human-in-the-loop ; Cursor [how it works: the honest caveat that an allowlist is "best-effort, not a security boundary"] — https://cursor.com/docs/agent/security/run-modes . **Open gap to beat (no visual benchmark):** all four are config files. Nobody ships this as a readable grid — the grid UI is ours to draw. Benchmarks doc, Factor 3.

## Journey 7c.28 — Write or edit a "what good looks like" skill
*As an admin/rep, I want to shape the AI's judgment with a skill, and have the AI treat it as a model to follow — free to deviate — not a rigid script.*
- 1. Skills are **plain-language instructions** (sometimes with a small attached script), loaded only when relevant so they don't bloat the AI's context. Our internal "good follow-up" skills live in our own instructions (hidden from users); users add their own on top.
- 2. A skill is a **model the AI may deviate from** using judgment (your note) — not a template it must fill in exactly.
- 3. Editing a skill runs it against its test set and blocks the change if quality drops ([7f.5](7f-skills.md)).
- **Doc 7 tag:** RETHOUGHT of 7b.4's "templates" — templates become *examples fed to the AI*, and the skills library ([7f](7f-skills.md)) is the home for them.
- **Benchmark (beat this):** Anthropic — Agent Skills [how it works: **progressive disclosure** — only each skill's name and description sit in context until the model judges it relevant, then the body loads, then bundled files load at point of use; this is how we hold many skills without bloating the wake prompt] — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills ; Cursor — rule files [how it works: four typed scopes — Always Apply / Apply Intelligently (by description) / Apply to Specific Files (by glob) / Apply Manually (@-mention) — a model for how a skill declares *when* it applies] — https://cursor.com/docs/context/rules ; the skills library itself is [7f](7f-skills.md). Benchmarks doc, Factor 5.

## Journey 7c.29 — Turn a behavior on or off
*As an admin, I want to switch any AI behavior on or off, so I can stop one that isn't working without touching the rest.*
Each skill/recipe has an on/off + a condition filter (Settings → Intelligence → Skills), per the Doc 7b design note. **Doc 7 tag:** FROM 7b.
- **Benchmark (beat this):** Lindy — triggers and filters [how it works: a behavior is switched off at its trigger, with a condition filter, without touching the rest] — https://docs.lindy.ai/fundamentals/lindy-101/triggers ; Intercom Fin [how it works: each side-effecting behavior is separately wired and separately gated — the agent takes *no* action an admin has not enabled] — https://www.intercom.com/help/en/articles/9929230-the-fin-ai-engine .

## Journey 7c.30 — Let an action "graduate" from ask to auto (earn autonomy)
*As a rep, once the AI has proven it's good at something, I want to let it act without asking.*
- 1. The system tracks how often each kind of action gets accepted vs. edited vs. rejected (7c.26).
- 2. When accept-rate stays high for a while, it **offers** to flip that action to "auto" (the rep confirms). Per-workspace default, rep-adjustable within the admin's floor.
- **Doc 7 tag:** NEW. (Modeled on Lindy's ~30-day trust ramp and Ada's "earn autonomy by proving quality.")
- **Benchmark (beat this):** Ada — Automated Resolution score [how it works: an explicit quality metric — Relevant / Accurate / Safe / Contained — that autonomy is *earned against*, rather than a vibe] — https://docs.ada.cx/docs/generative/measure-success/understand-and-improve-your-ai-agent-s-automated-resolution-rate/ ; HubSpot — prospecting agent [how it works: draft-and-notify first, then the user lifts the gate once the edit-rate proves quality] — https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent . **Open gap to beat:** the ramp is manual everywhere; a system that *offers* the graduation off measured accept-rate is ours. Benchmarks doc, Factor 3.

---

## Group G — Audit

## Journey 7c.31 — The rep sees a loop's history and *why*
*As a rep, I want to see every check and action on a loop, and why the AI did each thing.* — A per-loop timeline: each wake, what changed, what it decided and why, what it queued or did. **Doc 7 tag:** RETHOUGHT/narrowed of 7b.2 (the "AI runs" view), scoped to one loop, with a plain-English reason on each action.
- **Benchmark (beat this):** Zapier — review your agent's activity [how it works: a per-run history with a standing "Needs action" section] — https://help.zapier.com/hc/en-us/articles/33336184962573-Review-your-agent-s-activity ; Attio — automation run history [how it works: per-run logs against the automation that produced them] — https://attio.com/blog/introducing-attio-automations . **Open gap to beat:** these show *what ran*; a plain-English **why** on each decision is ours. Benchmarks doc, Factor 3.

## Journey 7c.32 — The super-admin sees full traces
*As a super-admin at our company, I want the full inference trace to debug and evaluate.* — The 7b.2 "AI runs" view with the complete trace (the event, the exact instructions used, the tools and data touched with inputs/outputs, the model and cost, and a re-run button). **Doc 7 tag:** FROM 7b.2. (Your note: end-users get the narrow 7c.31; we as super-admins get the full 7c.32.)
- **Benchmark (beat this):** Langfuse [how it works: OTel-based traces with per-feature and per-user cost attribution, and a re-runnable view of the exact call] — https://langfuse.com/docs ; Braintrust [how it works: a versioned experiment per run, diffable against the previous one] — https://www.braintrust.dev/docs/evaluate ; Manus [visual: the "Manus's Computer" replay of everything the agent touched] — https://manus.im/blog/manus-sandbox . Benchmarks doc, Factor 6.

---

## Three worked examples (how a loop actually plays out)

These replace the flat "20 example reminders" table from 7b.3 with real timelines. (The full set of ~20 lives as test fixtures in Doc 7a.)

**1. The proposal chase (the Dana example, done right).**
- Jun 1, on a call: Dana says "send the proposal, I'll respond by Monday." → the AI opens a loop (intent: "waiting on Dana re: proposal, she said Monday"; next check: Tuesday morning).
- Tue AM: the gate sees no reply. The full think re-reads the account — no reason to hold, nothing inbound → it drafts a light nudge, **queues** it, and sets the next check for Jun 5.
- Jun 5: still nothing → drafts a second nudge + a "call Dana" task; queues them.
- Jun 8: the budget (3 touches) is hit → **hand back**: "3 touches, no reply — try [the other contact you emailed], call, or mark cold?" The rep picks "try the other contact" → the AI drafts an email to that person.
- If Dana replies at any point (any channel) → the loop **auto-closes** with a reason note.
- *This handles the judgment the old fixed rule couldn't: when to check, what counts as a reason to hold, when to escalate, when to switch targets, when to give up.*

**2. The people-change (fixing the CRM on its own).**
- On a call the rep hears "Jane and Bob don't work here anymore; talk to Priya." → the AI (7c.1) stages: mark Jane/Bob as departed (internal → automatic), **create Priya** as a contact, fill in her title/contact info, set her role — and opens a loop "connect with Priya." The outbound part (email Priya) is queued for approval.
- *Fixing our own database is automatic; reaching out is queued.* **Doc 7 tag:** RETHOUGHT of 7b.7.

**3. The condition that needs judgment.**
- The rep sets: "follow up in 3 days unless Dana replies to say John will be arriving."
- Day 3: Dana replied "John lands Thursday." The AI **reads that as satisfying the hold** → instead of nudging, it moves the loop to after Thursday, and only posts a "needs you?" if it's genuinely unsure.
- *This is the kind of condition the old fixed dropdown simply couldn't express.*

---

## Background jobs (what runs on its own, and when)

*(A "job" is a task the system runs in the background; these ride on our existing job runner.)*

- **DE-Gate** — the cheap "worth a full think?" check on every event/wake. Runs immediately where speed matters. Reads the short cached account summary.
- **DE-Wake** — the scheduled loop checks. A timer per loop's next-check date. **Only one job per loop runs at a time**, so an event and a scheduled check can't both fire and double-act.
- **DE-Event** — the event-driven re-checks (7c.3–7c.8), fed by the event engine (7b.1). Same one-job-per-loop rule.
- **DE-Escalate** — works out and queues the next escalation step (7c.15).
- **DE-Digest** — builds the twice-a-day away-digest (7c.17). Runs on a timer (e.g. 8am + 1pm, the workspace's timezone); collects queued items + what the AI did since the last digest.
- **DE-LiveExtract** — the live-call listener (runs on the streaming path, not the job runner — see below).
- **DE-Reconcile** — after a call, re-does the extraction over the recording and **updates (doesn't duplicate)** anything the live pass got wrong.

---

## Cost (summary; full math in the benchmarks doc, "Factor 6")

The gate on every event → **three model tiers** (cheap gate / mid decision / top for rare hard cases) → **reuse the "recently-read" discount deliberately** (batch an account's events to land inside the few-minute discount window; keep a short always-fresh summary for checks that wake days later, since the discount doesn't survive that long) → **half-price batch mode** for non-urgent nightly work → **per-customer cost tracking + budget caps** → **one job per loop** so a burst of events becomes one run. Modeled effect: ~$59k → ~$4k/month (a labeled estimate).

## Live-call architecture (summary; full detail in the benchmarks doc, "Factor 7")

Reuse the transcript feed we already have (**Deepgram** for phone calls, **recall.ai** for video meetings — recall.ai even streams us the live transcript). Build a small **listener** that runs a cheap model **once per speaking turn** to pull out structured items. Must-haves so it doesn't misbehave: only trust **finished** sentences (not half-heard ones), require a **matching quote** for every extracted item (so it can't invent one from hold music), **split the two call legs** instead of guessing who spoke, **fall back to a backup model** that returns the same shape, and **ask consent + hide sensitive data** before anything is stored. Safety net: a **6-rung fallback ladder** — worst case, it does the extraction *after* the call from the recording, so a call never loses its action items.

---

## Coverage & mapping — the WHOLE Doc 7 family

**Important:** this engine does **not** absorb all of Doc 7. It owns follow-ups and unprompted action. Enrichment, the skills library, the data-chat agent, provenance, qualification, AI summary fields, the Chrome extension, and coaching are **separate features** that this engine *uses* but does not replace — they have their own docs now. Here's the full picture.

### Doc 7 (the copilot) → disposition

| Doc 7 item | Disposition |
|---|---|
| 7.1 accept next actions / 7.2 talk-and-accept | **Used, not owned.** The post-call stack is the engine's main in-app surface (7c.16); it stays a copilot feature. |
| 7.3 / 7.3a qualification extraction + templates | **Separate feature** (call intelligence + copilot). The engine doesn't touch it. |
| 7.4 chat with your data (the agent) | **Moved to [7e](7e-agent-surface.md).** The engine reuses the same tools and can open loops from a prompt (7c.10). |
| 7.5 Q&A over a transcript/account | **Separate feature.** Unrelated to the engine. |
| 7.6 AI summary fields | **Separate feature.** But your 7.6.3 question ("what counts as relevant new activity?") is *answered here* by the gate (7c.12) — same problem, same cheap-check answer. |
| 7.7 enrichment (+ 7.7a–f) | **Moved to [7d](7d-enrichment.md).** The engine *calls* enrichment; it doesn't define it. |
| 7.8 skills library | **Moved to [7f](7f-skills.md).** Skills are how the engine's judgment is written (7c.28). |
| 7.9 provenance / trust layer | **Used, not owned.** The engine relies on it for every write; it stays its own feature in Doc 7. |
| 7.10 Chrome extension / page context | **Moved to [7g](7g-chrome-extension.md).** |
| 7.11 agent knows my screen + changes settings | **Split.** "Change a setting by chat" is a config action through the permission grid (7c.27); the rest is the agent surface ([7e](7e-agent-surface.md)). |
| 7.12 post-call coaching | **Separate feature** (backlog). |

### Doc 7a (eval fixtures) → disposition
- **Rewritten as [7a](7a-copilot-eval-fixtures.md).** The engine's worked examples (like the Dana chase) become fixtures there (7a fixtures #29/#30), plus the AI-jobs→fixtures map.

### Doc 7b (automations) → disposition

| 7b item | Disposition |
|---|---|
| 7b.1 event engine | **Split:** the trigger list + skill wiring stay (Group A's plumbing; see the trigger table above); the AI-decision half is this engine (Group B). |
| 7b.2 AI runs view | **Kept:** becomes 7c.31 (rep, narrow) + 7c.32 (super-admin, full). |
| **7b.3 conditional reminders** | **REPLACED by this doc.** Fixed conditions are DEPRECATED; the reason-note/undo behavior is kept (7c.24); the object becomes the open loop. |
| 7b.4 meeting-agreed auto-draft | **RETHOUGHT:** flows through the engine (7c.1→C); templates become models the AI may deviate from (7c.28). |
| 7b.5 call-me-back reminder | **RETHOUGHT:** an open loop from the call (7c.1/7c.14). |
| 7b.6 no-connect email | **FROM 7b.6** via 7c.6/7c.17. |
| 7b.7 wrong-person / gatekeeper | **RETHOUGHT:** worked example #2. |
| 7b.8 connected-number memory | **Stays separate** (a dialer-learning feature the engine uses). |
| 7b.9 dead-value pattern | **Stays separate** (a data-hygiene primitive the engine uses). |
| 7b.10 name pronunciation | **Stays separate** (a call feature). |
| 7b.11 company DBA capture | **Stays separate** (enrichment, now [7d](7d-enrichment.md)). |
| 7b.12 post-bad-call lift | **Stays separate** (candy). |
| 7b.13 calendar↔task sync | **Substrate kept**; the *decision* on a calendar change becomes 7c.7 (AI-judged). |

### New concepts this doc introduces (nothing like them in Doc 7)
The open-loop object; the gate; the five-move think; the permission grid (7c.27); the away-digest + "needs you" tray (7c.17/7c.19); "earn autonomy" graduation (7c.30); the escalation ladder + soft stop (7c.15); the cost/gate design; the live-extraction fallback ladder.

---

## Data model (Prisma) — the open loop

Extends the cumulative schema. The `OpenLoop` model (NEW) and the reuse of `Proposal` / `CopilotAction` / `Provenance` / `AiRun` (defined in [7](7-ai-copilot.md) and [7b](7b-copilot-automations.md)) back this doc.

```prisma
model OpenLoop {                 // NEW — the thing the rep is waiting on (Journey 7c.14)
  id            String   @id @default(cuid())
  workspaceId   String
  ownerId       String            // v1: only the owner's events act on it
  recordId      String            // the account/contact/deal it's about
  intent        String            // plain-language ("follow up unless Dana replies with a real reason")
  nextCheckAt   DateTime?         // the scheduled wake (the AI can move this)
  status        String   @default("open") // open | waiting | needs_rep | resolved | snoozed | handed_back
  touches       Int      @default(0)
  budgetTouches Int      @default(3)     // soft-stop budget (settings)
  budgetDays    Int      @default(14)
  createdBy     String            // "rep" | "ai" (autonomous creation is visible in 7c.31)
  originIntent  String            // the original words, carried forward to every wake
  createdAt     DateTime @default(now())
  @@index([workspaceId, nextCheckAt])
}

model AiPermissionRule {          // NEW — the auto/ask/never grid (Journey 7c.27)
  id            String  @id @default(cuid())
  workspaceId   String
  scope         String            // "workspace" | "rep:<id>"
  actionType    String            // field_write | create_task | draft_email | send_email | send_sms | stage_change | won_lost | enrich | bulk | config_change
  mode          String            // auto | ask | never
  threshold     Json?             // e.g. { maxRecords: 20 } or { maxAmount: 5000 }
  adminLocked   Boolean @default(false) // a "never" the admin sets that reps can't loosen
  @@unique([workspaceId, scope, actionType])
}
```

## Open decisions still to settle
- **The gate's design** — rules vs. a tiny classifier vs. a cheap model, and exactly what it decides. (Start with rules + a cheap model.)
- **The double-check step** — settled: only on big/irreversible actions, not on everything.
- **How we bill customers** — pay-per-result vs. credits. *A business call, parked* — but build so we can meter per-action from day one.
- **The exact list of permission-grid rows**, and where thresholds apply.
- **Cross-rep action** — v1 is owned-records-only; widen to shared later (needs a sharing model first).
- **Where the "needs you" tray lives** — its own tray vs. woven into the post-call stack and digest.

## Open research still worth doing
- The structured "ask the rep a question" UX (the Claude-Code/Codex form-style ask) as the model for 7c.19.
- The short "always-fresh account summary" — what's in it and how we keep it current cheaply. It's load-bearing for both the gate and the day-later checks.
