# Doc 15 — Sequences & Campaigns (multi-step outreach)

A **sequence** (a.k.a. cadence) is a **multi-step, multi-day outreach plan** that enrolls a person and then, day by day, sends emails, drops call tasks, and sends texts on a schedule — some steps fully automatic, some landing in the rep's queue as a to-do. This is the tool that turns "I should follow up with these 40 people over the next two weeks" into a system that never forgets a touch.

This was the **top item on the backlog** (doc 14) — *"the #1 loved feature in Salesloft reviews"* — moved off the shelf and specced here at full depth. **Channels in scope: EMAIL + CALL-TASK + SMS. LinkedIn is explicitly out of scope this round** (it's a later channel; the model leaves room for it but no journey builds it).

**We reuse, we don't rebuild.** A sequence's email step reuses the **email composer, templates, merge fields, and send path** from doc 5 (Journeys 5.5 / 5.5a). Its text step reuses **SMS send, templates, and 10DLC** from doc 3a (Journeys 3.10 / 3.10a / 3.11). Its call step creates a **call task** that a rep works from the dialer, dispositioned exactly like any call (doc 2 Journey 2.4). Every send runs through the **same compliance gate** (quiet-hours, DNC, opt-out, 10DLC, deliverability caps) the rest of the app already enforces. This doc adds the *cadence* layer on top; it does not fork the channels.

**Benchmarks (the bar to beat), verified live:**
- **Salesloft Cadences** — the best-in-class cadence model and the one reviewers love; we want the **builder + day-offset model at least as good**. https://support.salesloft.com/hc/en-us/articles/360039954471-Cadence-Overview
- **Outreach Sequences** — the cleanest **step-type taxonomy** (Auto Email / Manual Email / Phone Call / Task) and per-step timing; we want **step semantics at least as clear**. https://support.outreach.io/hc/en-us/articles/115005009048-Sequence-Overview-Creating-a-Sequence-
- **Apollo Sequences** — the tightest **all-in-one** enroll-from-a-list + reporting loop; we want **enrollment UX + step analytics at least as good**. https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview

---

## How a sequence differs from a workflow (read this first)

We already ship a **workflow** engine (doc 10): *"when X happens to a record, do Y"* — event-driven, record automation, no human in the loop. A **sequence** is a different animal, and mixing them up causes bad designs. The line:

> **A sequence is a multi-day *outreach cadence* that enrolls *people* and drives *human + automated touches* (email/call/text) on a day-offset schedule.**
> **A workflow is event-driven *record automation* — a rule that fires the instant a field changes and does back-office work (set a status, create a task, add to a list).**

| | **Sequence (this doc)** | **Workflow (doc 10)** |
|---|---|---|
| Unit of work | An **enrollment** (one person walking a cadence over days) | A **run** (one record reacting to one event) |
| Time model | **Day offsets** from enrollment ("day 0 email, day 2 call, day 5 text") | **Instant** on the event, plus optional delays |
| Who acts | Rep (manual steps) **and** the app (auto steps) | The app only |
| Content | Outreach copy to a prospect (email/SMS body, call script) | Field writes, tasks, notifications |
| Exit | Reply, meeting booked, opt-out, DNC, finished, or manual removal | The run just finishes |

**They compose.** A workflow can **enroll into** or **exit from** a sequence as one of its actions (doc 10 Journey 10.4 already lists "Exit sequence"). Example: workflow "when disposition = not-interested → exit all sequences" (doc 10 use-case 3) reaches into *this* engine. And a sequence's auto-exit (Journey 15.8) can flip a record field that *triggers* a workflow. One seam, two engines, no overlap.

**Sequence vs Campaign.** A **Campaign** (doc 5) is a loose *grouping/label* for outreach (a push, a quarter, a segment); a **Sequence** is an *executable cadence*. A sequence can carry a `campaignId` so its sends roll up under a campaign, but the campaign doesn't *run* anything — the sequence does.

---

## New surfaces this doc adds

- **Sequences** — a top-level navbar item: the sequence **library** (list), the **builder** (canvas), and each sequence's **analytics** and **enrolled-people** tabs.
- **Today** (the work queue) — a rep's daily list of **due sequence tasks** (manual emails to approve, calls to make, texts to send). Lives in the navbar; also surfaces due tasks into the dialer's call list.
- **Enroll** entry points — a button on a **record**, in the **dialer**, and in the **bulk-action bar** of any CRM view (doc 5a Journey 5.1).

---

## Journey 15.1 — Create a sequence (the builder)

*As a rep, I want to build a multi-step cadence once, so that a whole follow-up plan runs on a schedule instead of living in my memory.*

1. **Entry point.** Navbar **Sequences** → the library (Journey 15.11) → **New sequence** (top-right primary button). He names it ("Inbound demo follow-up") in a small dialog and lands on the **builder canvas**.
2. **The canvas is a vertical timeline of step cards**, top to bottom, each pinned to a **day offset** from enrollment. A **+** between cards opens a typed step picker (Journey 15.2): Auto-email, Manual-email task, Call task, SMS, Wait/Delay, Condition-branch.
3. For each step he sets **when** (day offset + send window) and **what** (the email/SMS body or the call script), reusing the doc-5 composer and doc-3a SMS editor inline. Steps are **drag-to-reorder**; reordering re-computes day offsets (Journey 15.3).
4. He sets **sequence-level settings** (a right-hand panel): the **default send window** (e.g. 8am–5pm prospect-local, capped by quiet-hours 3.14b), the **sending mailbox** (doc 5 primary or a picked one), the **daily new-enrollment cap** per mailbox (deliverability, Journey 15.12), and **auto-exit rules** (Journey 15.8).
5. He clicks **Test on a record** (dry-run, mirrors doc 10.5) — picks one real person and sees the exact timeline: *"Day 0 09:00 → email 'Quick intro' to jane@acme.com; Day 2 → call task; Day 5 → SMS."* No sends happen. It flags anything that would be blocked (no mailbox connected, person on DNC, missing merge data).
6. He toggles the sequence **Live**. It's now enrollable. Editing a live sequence creates a **new version** (Journey 15.9).

**ASCII — the builder canvas.**

```
┌─ Sequences ▸ Inbound demo follow-up ───────────────── [ Test ] [● Live ▾] ─┐
│  Steps    Enrolled (12)    Analytics    Settings                            │
├──────────────────────────────────────────┬──────────────────────────────── ┤
│                                           │  SEQUENCE SETTINGS               │
│   ● Day 0   ✉  Auto-email                 │  Send from:  ryan@maincar.com ▾  │
│     "Quick intro — {{first_name}}"        │  Send window: 8:00a–5:00p        │
│     window 8a–5p · [A/B: 2 variants]      │    (prospect local, ≤ quiet-hrs) │
│     ─────────── + ───────────             │  New enrollments/day: 40 / mbx   │
│   ● Day 2   ☎  Call task                  │  ───────────────────────────     │
│     script "Ref the whitepaper…"          │  AUTO-EXIT WHEN:                 │
│     due window 9a–4p                       │   ☑ they reply                  │
│     ─────────── + ───────────             │   ☑ meeting booked              │
│   ● Day 2   ⧗  Wait 3 days                │   ☑ opted out / STOP            │
│     ─────────── + ───────────             │   ☑ on DNC                      │
│   ◇ Day 5   ⑂  If: opened any email?      │  ───────────────────────────     │
│       ├─ yes →  💬 SMS "Saw you looked…"   │  On finish → status: "nurture"   │
│       └─ no  →  ✉  Auto-email "Bumping…"   │                                  │
│     ─────────── + ───────────             │                                  │
│   ● Day 8   ✉  Manual-email task (review) │                                  │
│                    [ + Add step ]         │                                  │
└──────────────────────────────────────────┴──────────────────────────────── ┘
```

- **Benchmark (beat this):** Salesloft — Cadence Overview *(day-offset step model + per-step metrics; we want a builder at least this clear)* — https://support.salesloft.com/hc/en-us/articles/360039954471-Cadence-Overview ; Apollo — Create a Sequence *(inline step editing + settings panel)* — https://knowledge.apollo.io/hc/en-us/articles/4409231193101-Create-a-Sequence
- **Build docs:** internal — `Sequence` + `SequenceStep` (below); the canvas reuses the doc-10 block-card pattern; email/SMS editors are the doc-5.5 / doc-3a.11 components embedded.

## Journey 15.2 — The step types (what each does, auto vs. task)

*As a rep, I want each step type to be obvious about whether the app does it or I do it, so that I know what's automated and what's on my plate.*

Six step types. The dividing question for every step: **does the app act on its own, or does it drop a to-do in my queue (Journey 15.7)?**

1. **Auto-email** — *automatic.* At the step's due time the app sends the email through the doc-5 send path (real Sent folder), after the compliance gate (Journey 15.12). The rep sees it only if it fails or bounces. Best for top-of-cadence templated touches. Merge fields resolve per recipient (doc 5.5a); an **AI-drafted body** is possible (Journey 15.2a).
2. **Manual-email task** — *a task.* The app **drafts** the email (template + merge fields, optionally AI) and drops it in the rep's **Today queue** as *"Review & send."* The rep opens it in the composer, edits, and clicks **Send** — honoring the repo-wide rule *"sending email is always an explicit click"* (doc 5.5). Nothing sends unattended.
3. **Call task** — *a task.* Creates a **call `Task`** (doc 4d) due that day, pinned into the dialer's call list (doc 3 Journey 3.4) with the step's **script** shown as the on-call battlecard (doc 2). The rep dials, talks, and **dispositions** (doc 2 Journey 2.4). The disposition can drive branch/exit (Journey 15.8) — e.g. "not interested" exits the sequence.
4. **SMS** — *automatic or task (rep chooses per step).* Sends a text through the doc-3a send path from a **10DLC-approved** number (Journey 15.12). Default is **task** ("Review & send text") because texting is high-touch; a rep can set a step to **auto-send** for a simple confirmation. Plain text + merge fields (doc 3a.11); no rich text.
5. **Wait / Delay** — *automatic, invisible.* Pauses the enrollment for a duration ("wait 3 days") before the next step. This is how multi-day spacing is expressed between two touches on the same or different channels.
6. **Condition-branch** — *automatic, invisible.* An **If** / **Switch** that routes the enrollment down one of several paths based on the person's state (opened an email? disposition? a field value?). First-match-wins (Journey 15.8). Lets one sequence adapt instead of forcing a rep to build three.

**What the rep sees per type, at a glance:**

| Step type | App or rep? | Where it shows | Reuses |
|---|---|---|---|
| Auto-email | App sends | Nowhere (unless it fails) | doc 5.5 send |
| Manual-email task | Rep sends | Today queue → composer | doc 5.5 composer |
| Call task | Rep calls | Today queue + dialer call list | doc 2 / doc 3 |
| SMS | App or rep (per step) | Auto: nowhere; Task: Today queue | doc 3a.10 |
| Wait/Delay | App | Nowhere | — |
| Condition-branch | App | Nowhere | doc-4 filter grammar |

- **Benchmark (beat this):** Outreach — sequence step options (Auto Email / Manual Email / Phone Call / Task) *(the clearest auto-vs-task taxonomy; we match it and drop LinkedIn)* — https://support.outreach.io/hc/en-us/articles/115005009048-Sequence-Overview-Creating-a-Sequence-
- **Build docs:** internal — `SequenceStep.type` enum; call step writes a `Task` (doc 4d); email/SMS steps write `SequenceStepRun` rows that reference the resulting `EmailMessage` / `SmsMessage`.

## Journey 15.2a — AI-draft a step's email body

*As a rep, I want the app to draft a step's email from the prospect's context, so that a "personal" touch doesn't cost me ten minutes of writing.*

1. **Entry.** In a step's email editor, he clicks **AI draft** (the `/` menu, same control as doc 5.5a). He gives a one-line intent ("friendly bump referencing their recent funding") and picks the **CRM fields the AI may read** (grounding is explicit, like doc 5.5a).
2. **Draft.** The app generates a body with merge fields left intact where appropriate. For a **Manual-email task** step, the draft is what lands in the rep's queue to review. For an **Auto-email** step, AI copy is **generated and reviewed at build time** (a template), then merge-resolved per recipient at send — we **never send unreviewed per-recipient AI prose unattended** (doc 5.5a rule).
3. **Model.** Drafting uses **Claude Sonnet 5** (`claude-sonnet-5`) — a stronger model because copy quality matters and it runs at build time / once per queued task, not in a hot loop, so latency and cost are acceptable. Reply-intent classification for auto-exit uses a cheaper model (Journey 15.8). Both run through the **Vercel AI SDK** (provider-agnostic) and the exact model is **super-admin-set on the backend** (doc 13) — the names here are the defaults, swappable later.

- **Benchmark (beat this):** Apollo — AI-assisted sequence creation *(describe intent → drafted steps; we want drafting at least as helpful, with explicit field grounding)* — https://knowledge.apollo.io/hc/en-us/articles/4409231193101-Create-a-Sequence
- **Build docs:** reuse doc 5.5a AI merge-field path; model default `claude-sonnet-5`, super-admin-selectable (doc 13).

## Journey 15.3 — Add, edit, reorder, and time steps

*As a rep, I want to change steps and their timing after the fact, so that I can tune a cadence as I learn what works.*

1. **Add** — the **+** between any two cards inserts a step; it inherits a sensible default day offset (the previous step's day, or +1).
2. **Edit** — click a card to edit its body/script, its **day offset**, and its **send window**. The window is *"earliest–latest local time"* and is always **clamped by the quiet-hours setting** (doc 3a Journey 3.14b): if a rep sets 7am–10pm but quiet-hours is 8am–9pm, the effective window is 8am–9pm, shown as a small note.
3. **Reorder** — drag a card up/down. Day offsets **don't auto-shuffle destructively**: reordering asks *"keep each step's day, or re-space them evenly?"* so a rep isn't surprised by a collapsed schedule.
4. **Same-day steps** — two steps can share a day (e.g. day 2 email + day 2 call). They run in **card order**, each still gated by its own send window and the compliance gate.
5. **Delete a step** — confirm; if enrollments are mid-flight, past that step nothing changes, and enrollments **currently waiting on that step** advance to the next step (never orphaned — same guarantee as workflow versioning, Journey 15.9).

- **Benchmark (beat this):** Salesloft — Cadence step timing (days-since-start model) — https://support.salesloft.com/hc/en-us/articles/360039954471-Cadence-Overview ; Apollo — sequence sending schedule — https://knowledge.apollo.io/hc/en-us/articles/4409477927309-Configure-a-Sequence-Sending-Schedule
- **Build docs:** internal — `SequenceStep.dayOffset`, `sendWindowStart/End`; ordering by `(dayOffset, position)`.

## Journey 15.4 — A/B test a step (variant bodies, pick a winner)

*As a rep, I want to split-test two email versions in one step, so that I learn which subject/body wins without running two whole sequences.*

1. **Entry.** On an **Auto-email** (or SMS) step, he clicks **+ Add variant**. The step now holds **Variant A / Variant B** (up to N), each its own subject + body. A small badge shows **"A/B: 2 variants."**
2. **Split.** He picks the split — default **even (50/50)**; or "hold X% for the winner." Each new enrollment reaching the step is assigned a variant **round-robin/weighted**, recorded on the `SequenceStepRun` so results are attributable.
3. **Read results (feeds Journey 15.10).** The step's analytics show a per-variant row: **sent · open% · reply% · meeting%**, with a highlighted leader once each variant has enough sends for the difference to be meaningful (a simple min-sample guard — we don't crown a winner off 4 sends).
4. **Pick a winner.** He clicks **Promote A** (or B). Future enrollments all get the winner; in-flight ones already assigned keep theirs. Promoting creates a **new sequence version** (Journey 15.9) so the change is auditable.
5. **Edge — statistical honesty.** We show the raw rates and sample sizes, not a false-precision "significance" claim; the min-sample guard just prevents an obviously-premature auto-highlight. A rep can always promote manually.

- **Benchmark (beat this):** Salesloft / Outreach A/B on cadence email steps *(per-variant reply/open comparison; we want variant analytics at least as good and an explicit promote-winner action)* — https://support.outreach.io/hc/en-us/articles/115005009048-Sequence-Overview-Creating-a-Sequence-
- **Build docs:** internal — `SequenceStepVariant` (below); assignment recorded on `SequenceStepRun.variantId`; rollup by variant in job S4.

## Journey 15.5 — Enroll one person (from a record or the dialer)

*As a rep, I want to drop a single prospect into a cadence in one click, so that a good conversation immediately gets a systematic follow-up plan.*

1. **Entry point A — from a record.** On a Person record header (doc 4d), next to Call / Email / Text, an **Enroll ▾** button lists live sequences. He picks one.
2. **Entry point B — from the dialer.** Right after a call, the after-call bar (doc 2 Journey 2.4) has **Enroll in sequence ▾** — so a rep who just said "I'll send you some info" enrolls them without leaving the dialer. A disposition can also *auto-enroll* via a workflow (doc 10), but this is the one-click manual path.
3. **Pre-enroll check (the guardrail).** On pick, we validate before committing and show a one-line result:
   - Person **on DNC** for the sequence's channels → **block** with the reason (doc 3a 3.14a).
   - Person **already enrolled** in this sequence → offer **Restart** or **Cancel** (no silent double-enroll).
   - **Missing required merge data** (no email for an email-first sequence) → warn, let him proceed (steps for the missing channel will skip) or fix first.
4. **Confirm.** He picks the **start day** (now, or "start tomorrow 9am") and the **mailbox/number** if the sequence allows override. **Enroll** creates a `SequenceEnrollment` at step 0; the scheduler (job S2) takes over.
5. **Feedback.** The record timeline logs *"Enrolled in 'Inbound demo follow-up' — step 1 due today,"* and the record shows a small **sequence chip** ("In sequence · day 0/5") so its state is always visible.

- **Benchmark (beat this):** Apollo — Add Contacts to a Sequence *(one-click add from a contact, with a pre-add check)* — https://knowledge.apollo.io/hc/en-us/articles/4409396985741-Add-Contacts-to-a-Sequence
- **Build docs:** internal — `SequenceEnrollment` create; the pre-enroll check reuses the doc-3a D8 DNC lookup and the doc-5.5a merge-field resolver in "preview" mode.

## Journey 15.6 — Bulk-enroll from a list or view

*As a rep, I want to select a filtered set of people in a CRM view and enroll them all at once, so that I can launch outreach at volume in seconds.*

1. **Entry point.** In any CRM People view (doc 4c), he selects rows — checkbox per row, or **"Select all 1,240 across this filter"** — and the **bulk-action bar** (doc 5a Journey 5.1) slides up. It gains an **Enroll in sequence** action alongside Edit-field / Create-task / Export.
2. **Pick + preview.** He picks a live sequence. A dialog shows a **pre-flight summary computed before anything runs**: *"1,240 selected → 1,190 will enroll · 22 skipped (on DNC) · 18 skipped (already enrolled) · 10 skipped (no email)."* Each skip bucket is expandable so he sees who and why. This is the volume version of the single-enroll guardrail (Journey 15.5 step 3).
3. **Throttle honesty.** If the count exceeds the sequence's **daily new-enrollment cap** (deliverability, Journey 15.12), the dialog says so: *"Cap is 40/day on this mailbox — we'll enroll 40 today and stagger the rest over the next 30 days,"* and lets him raise the cap or add a mailbox. We **never** dump 1,190 emails into day 0 and torch the domain.
4. **Confirm → background enrollment.** Clicking **Enroll** hands off to **job S1** (the enrollment engine). A toast + a progress chip track it; the rep can leave. Each enrolled person gets the same timeline entry and chip as a single enroll.
5. **Edge — the selection is a saved List.** Enrolling from a **List** (doc 4c) can optionally be **"keep enrolling new members"**: anyone later added to that List is auto-enrolled (a thin standing rule, implemented as a workflow trigger "entered list → enroll", doc 10). Off by default — a one-time bulk enroll is the common case.

- **Benchmark (beat this):** Apollo — add a whole list/search to a sequence *(select → enroll at volume with a skip summary; we want the pre-flight skip breakdown to be at least as transparent)* — https://knowledge.apollo.io/hc/en-us/articles/4409396985741-Add-Contacts-to-a-Sequence
- **Build docs:** internal — the bulk-action bar (doc 5a) gains an Enroll action; job **S1** batches the create with the same idempotency as `bulk-mutate`.

## Journey 15.7 — Work today's sequence tasks (the daily queue)

*As a rep, I want one prioritized list of everything my sequences need from me today, so that I clear my human touches fast without hunting through records.*

1. **Entry point.** Navbar **Today**. It shows every **due sequence task** across all enrollments: manual emails to review-and-send, call tasks to make, texts to review-and-send — plus non-sequence tasks (doc 4d) in the same list, so it's the rep's one worklist.
2. **Grouped and ordered.** Default grouping is **by type** (Calls, Emails, Texts) so a rep can batch — do all calls in one focused block, then rip through emails. Within a group, order is **overdue first, then by due time**. He can switch to **by person** to do everything for one account together.
3. **Work in place.** Each row is actionable without leaving the queue:
   - **Manual-email** → **Review & send** opens the drafted email in the corner composer (doc 5.5); Send advances the enrollment.
   - **Call task** → **Call** opens the dialer with the script as battlecard; the disposition advances (or branches/exits) the enrollment.
   - **SMS task** → **Review & send** opens the SMS composer (doc 3a.10).
   - Each row also has **Skip this step** (advance without acting, logged) and **Remove from sequence** (Journey 15.8 manual exit).
4. **Auto-steps aren't here.** Auto-emails and auto-SMS never appear in Today — they just happen. Only steps that need a human show up, so the queue is a true to-do list, not a log.
5. **Compliance is visible in the queue.** A task whose person just hit **quiet-hours** shows *"Outside calling window — available 8am local"* and sorts down; a task for a person who **replied/opted out** since it was created is **auto-removed** (the enrollment already exited, Journey 15.8) so the rep never works a stale touch.

**ASCII — the Today queue.**

```
┌─ Today ─────────────────────────────────────  Group: [ Type ▾ ]  18 due ──┐
│                                                                            │
│  ☎  CALLS (7)                                                              │
│   • Jane Diaz — Acme          Inbound demo f/u · step 2   [ Call ] [Skip]  │
│   • Sam Roe — Umbrella        Reactivation · step 3       [ Call ] [Skip]  │
│   • Lee Park — Globex ⏰8a     Inbound demo f/u · step 2   outside window   │
│                                                                            │
│  ✉  EMAILS (8)   review & send                                            │
│   • Priya N — Initech         Inbound demo f/u · step 5   [Review & send]  │
│   • Tom Vale — Soylent        Reactivation · step 1       [Review & send]  │
│                                                                            │
│  💬  TEXTS (3)   review & send                                            │
│   • Dana Kim — Hooli          Inbound demo f/u · step 4   [Review & send]  │
│                                                          [ Clear all done ]│
└────────────────────────────────────────────────────────────────────────── ┘
```

- **Benchmark (beat this):** Salesloft — Run a Cadence *(the "do today's steps" workflow; we want a batched, group-by-type work queue at least as fast)* — https://support.salesloft.com/hc/en-us/articles/115005910986-Run-a-Cadence ; Outreach — sequence tasks in the Tasks tab — https://support.outreach.io/hc/en-us/articles/115005009048-Sequence-Overview-Creating-a-Sequence-
- **Build docs:** internal — the queue reads due `Task` rows (doc 4d) whose `sourceType='sequence_step'`, joined to their `SequenceStepRun`; call tasks pin into the doc-3 call list.

## Journey 15.8 — Auto-exit and branch logic (If X then Y)

*As a rep, I want people to drop out of a cadence the moment it's the wrong thing to keep doing, so that I never text someone who already replied or, worse, someone who opted out.*

**Auto-exit rules (sequence-level, set in the builder — Journey 15.1).** Each is an **If X → then exit** evaluated continuously by **job S3**:

- **If they reply** (email reply detected on the thread, or an inbound SMS, or an inbound call from them) → **exit** and notify the rep *"Jane replied — pulled from sequence."* Reply detection: an inbound `EmailMessage`/`SmsMessage`/`Call` matched to the enrolled person (doc 5.2 matcher / doc 3a inbound). A **reply-intent classifier** (below) suppresses auto-replies/OOO so a "I'm on vacation" bounce doesn't count as engagement.
- **If a meeting is booked** with them (a calendar event matched to the person, doc 5.6) → **exit**; the cadence's job is done.
- **If they opt out / send STOP** (email unsubscribe, or SMS STOP → doc 3a Journey 3.10b) → **exit immediately and hard-stop all channels**; write a DNC entry (doc 3a 3.14a). This is not optional and cannot be un-set on a sequence.
- **If they land on DNC** for any reason (doc 3a 3.14a) → **exit** the relevant channels; if all the sequence's channels are blocked, exit entirely.
- **If a call disposition says so** — e.g. **not-interested** or **do-not-call** (doc 2 Journey 2.4) → **exit** (this is doc 10 use-case 3, wired as an auto-exit).
- **On finish** — the last step completes → the enrollment ends with status **completed**; an optional **on-finish action** sets a field (e.g. status → "nurture"), which can trigger a workflow (doc 10).

**Reply-intent classification (the one AI bit here).** A raw "did an inbound message arrive?" check over-exits (auto-replies, "unsubscribe me", "wrong person"). So an inbound reply is classified into **{ genuine reply · auto-reply/OOO · negative/opt-out · not-the-person }**:
- **Model:** **Claude Haiku 4.5** (`claude-haiku-4-5`) — this runs **once per inbound reply**, must be **cheap and fast**, and the decision is low-stakes-reversible (worst case a rep re-enrolls), so a small model is the right call. It returns a typed JSON label (not parsed prose). Escalate to **Claude Sonnet 5** only if the eval shows Haiku mislabels. Provider-agnostic via the Vercel AI SDK; **super-admin-set** (doc 13).
- **How the label is used:** *genuine reply* → exit + notify; *negative/opt-out* → exit + DNC; *auto-reply/OOO* → **do not exit** (optionally pause a few days); *not-the-person* → flag for the rep, don't exit.

**Branch steps (mid-cadence If/Switch — Journey 15.2 type 6).** Distinct from exit: a branch **routes** an enrollment down a path without ending it. **If** splits true/false; **Switch** routes to named paths; **first-match-wins** (HubSpot/doc-10 semantics). Conditions reuse the **doc-4 filter grammar** (react-querybuilder) over the person's fields and sequence signals ("opened any email?", "call connected?", "field = X"). Example in the ASCII (Journey 15.1): *day 5 — If opened any email → SMS; else → bump email.*

**Manual removal.** A rep can **Remove from sequence** from the record chip, the Today queue (Journey 15.7), or the enrolled-people tab. Confirm; the enrollment ends with status **removed** and logs who/when. Bulk-remove works from the enrolled-people table's action bar.

- **Benchmark (beat this):** Outreach — sequence rulesets (opt-out / reply / bounce finish conditions) — https://support.outreach.io/hc/en-us/articles/217723638-Outreach-Sequence-Rulesets-Overview ; Apollo — manage sequence rulesets — https://knowledge.apollo.io/hc/en-us/articles/4409396858509-Manage-Sequence-Rulesets
- **Build docs:** internal — job **S3**; reply-intent default `claude-haiku-4-5` (super-admin-set); branches reuse react-querybuilder (doc 4c) and are stored in `SequenceStep.branchJson`.

## Journey 15.9 — Pause / resume, and edit a live sequence (versioning)

*As a rep, I want to pause a running cadence and edit it safely, so that a change I make today doesn't blow up the 40 people already mid-flight.*

1. **Pause the whole sequence.** A **Pause** toggle on the sequence stops **all** its enrollments from advancing — scheduled sends and tasks hold — and **blocks new enrollments**. Resume picks up where each left off (day offsets shift by the paused duration so nothing fires at 3am after a week's pause). Use: "we're at a conference, hold outreach."
2. **Pause one enrollment.** An individual person can be paused (record chip / enrolled table) — e.g. "they asked me to hold two weeks" — without touching the sequence. Auto-resumes on a date or manually. (For a true "call me back in 6 months," a backburner snooze is better — doc 3a 3.14a Situation 4.)
3. **Editing a live sequence = a new version (mirrors doc 10.6 exactly).** When he edits steps/timing/content on a Live sequence:
   - The edit creates a **new `SequenceVersion`**; **in-flight enrollments finish on the version they started on** (someone mid "wait 3 days" or on step 3 keeps the old plan), so a live edit never reshuffles people already walking the cadence.
   - **New enrollments** use the new version.
   - He can optionally **migrate in-flight enrollments** to the new version with an explicit *"apply to the 40 in-flight?"* choice — off by default, because silent migration is how people get double-sent. Migration maps each enrollment to the nearest equivalent step.
4. **Disabling / archiving with people in flight** never orphans them — same guarantee as Journey 15.3 step 5 and doc 10.6: in-flight enrollments either finish or are explicitly exited with a log entry.

- **Benchmark (beat this):** our own **doc 10.6 workflow versioning** is the binding model (in-flight runs pin their version); Salesloft/Outreach both version cadences on edit — https://support.salesloft.com/hc/en-us/articles/360039954471-Cadence-Overview
- **Build docs:** internal — `SequenceVersion` pinned on `SequenceEnrollment.versionId`; pause = a status on `Sequence` / `SequenceEnrollment`; job S2 respects both.

## Journey 15.10 — Read: per-sequence and per-step analytics

*As a rep, I want to see how a sequence and each of its steps is performing, so that I can cut the dead steps and double down on what books meetings.*

1. **Entry point.** A sequence's **Analytics** tab.
2. **Top-line (per sequence).** Active enrollments, and the funnel: **enrolled → delivered → opened → replied → meeting booked**, plus **opt-out%** and **bounce%** as guardrail metrics (a sequence with a climbing opt-out/bounce rate is hurting the domain — flag it red).
3. **Per-step table (the money view).** One row per step: **type · sent/attempted · delivered · open% · reply% · meeting% · opt-out% · bounce%**, and for **A/B steps** a sub-row per variant (Journey 15.4). This is where a rep sees "step 4 SMS gets 0 replies and 3 opt-outs — kill it."
4. **Step-level actions inline.** From a row he can **edit** the step, **promote a variant**, or **disable** the step (creating a new version, Journey 15.9).
5. **Rollups are pre-computed** by **job S4** (not live-aggregated on every page load), so the tab is instant even for big sequences. Numbers reconcile with the underlying `EmailMessage`/`SmsMessage`/`Call` activities (the same source doc-5b reporting reads), so sequence analytics never disagree with the CRM.

**ASCII — the per-step analytics table.**

```
┌─ Inbound demo follow-up ▸ Analytics ─────────  Enrolled 210 · Active 88 ──┐
│  Funnel:  Enrolled 210 → Delivered 198 → Opened 141 → Replied 34 →         │
│           Meetings 11    │  Opt-out 1.4%   Bounce 2.0%                      │
├──────────────────────────────────────────────────────────────────────────┤
│  Step            Type   Sent  Deliv  Open%  Reply%  Mtg%  Opt%  Bounce%    │
│  1 Quick intro   ✉auto   210   198    71%    9%      3%    0.5%  2.0%       │
│     ├ Var A "…?"  ✉        104    99    68%    7%      2%    —     —         │
│     └ Var B "…!"  ✉ ★win   106   99    74%   11%      4%    —     —         │
│  2 Call ref      ☎task    120    —     —     14%*     6%    —     —   *conn │
│  3 Bump          ✉auto    150   146    59%    5%      1%    0.7%  1.3%       │
│  4 SMS nudge     💬auto     90    88    —      0%      0%    3.1%  —  ⚠ high  │
│  5 Manual close  ✉task     60    58    62%   18%      7%    0.9%  —         │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Benchmark (beat this):** Apollo — Report on Sequences *(per-step + per-sequence funnel; we want step analytics at least as good)* — https://knowledge.apollo.io/hc/en-us/articles/9386141889549-Report-on-Sequences ; Outreach — sequence performance report — https://support.outreach.io/hc/en-us/articles/1260801927169-Outreach-Insights-Sequence-Performance-Report-Overview
- **Build docs:** internal — job **S4** rollups into `SequenceStepStat`; reads the same activity tables doc-5b reporting uses.

## Journey 15.11 — List, clone, archive, and delete sequences (CRUD)

*As a rep, I want one place to manage all my cadences, so that a growing library stays tidy and I can spin up a new one from a proven one.*

1. **List (read-many).** Navbar **Sequences** → a table: **name · status (Live / Draft / Paused / Archived) · active enrollments · reply% · meeting% · last edited · owner** (owner once teams land, doc 11). Sort/filter by any column. This is the home the **New** button (15.1) lives on.
2. **Clone.** Row action **Duplicate** → clones the latest version into a **Draft** named "Copy of …" — the fast path for "another one almost like this." Enrollments do **not** clone (a clone starts empty).
3. **Archive.** **Archive** hides a sequence from the live list and **blocks new enrollments**, but **in-flight enrollments finish** (never orphaned). Archived sequences stay readable for their analytics. Reversible (Unarchive).
4. **Delete.** **Delete** is soft (trash, 30-day recovery — doc 4/5a model) and **warns if enrollments are in flight** ("88 people are mid-sequence"). On confirm, in-flight enrollments are **exited with a log entry** (per Journey 15.9's no-orphan rule) before the sequence goes to trash. Hard-delete after 30 days.
5. **Row actions (⋯):** Open (builder), Duplicate, View analytics, Enrolled people, Pause/Resume, Archive, Delete.

- **Benchmark (beat this):** Apollo — Sequences Overview *(the library list + row actions)* — https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview ; our own doc-10.7 workflow-library model (soft-delete + in-flight warning) is the binding pattern.
- **Build docs:** internal — list reads `Sequence` + latest `SequenceStepStat`; soft-delete flag on `Sequence`; delete cascades an exit over in-flight enrollments via job S1.

## Journey 15.12 — Compliance & deliverability on every send (the gate)

*As an admin, I want every automated touch a sequence makes to obey the same compliance and deliverability rules as a hand-sent one, so that automation never creates a legal or domain-reputation problem.*

**This is not a separate feature — it's the gate every send/task passes through** (job S2), reusing the existing enforcement so a sequence can't route around it. Before any email/SMS sends or any call task surfaces, the gate checks, in a **fixed order** (mirroring the dial-time order in doc 3a 3.14a):

1. **DNC (doc 3a Journey 3.14a, job D8).** Person/number/account on Do-Not-Contact for this channel → **skip the step, exit the channel** (Journey 15.8). A real opt-out is never overridden by a sequence.
2. **Opt-out / unsubscribe (doc 3a 3.10b; doc 5 email unsubscribe).** An email step includes the workspace **unsubscribe** mechanism; an SMS step's first message honors the **STOP** posture. An inbound STOP/unsubscribe exits immediately and writes DNC.
3. **Quiet-hours (doc 3a Journey 3.14b).** Every send/task is clamped to the prospect's **local allowed window** (default 8am–9pm, workspace-configurable). A step due outside the window **holds until the window opens**, it does not send at the wrong hour. This is why every step has a send window (Journey 15.3) and the Today queue shows "available 8am" (Journey 15.7).
4. **SMS 10DLC (doc 3a Journey 3.10a).** An SMS step can only send from a **10DLC-approved** number. If the number isn't approved, the SMS step **holds and alerts** the admin ("register this number to text") rather than sending into a carrier block.
5. **Deliverability caps (doc 5 / Journey 5.4a).** Sends respect the **per-mailbox daily send cap** and the sequence's **new-enrollment cap** (Journeys 15.1 / 15.6), and a mailbox whose **health score** (SPF/DKIM/DMARC/warmup/blocklist, doc 5.4a) drops red can be set to **pause its sequence sends** — so we don't pour volume through a mailbox that's landing in spam. Warmup-stage mailboxes get lower caps automatically.

**Because the gate reuses D8, quiet-hours, 10DLC, and mailbox-health, there is exactly one implementation of each rule** — the sequencer calls them, it doesn't reimplement them. A held step is visible (the enrollment shows "waiting: quiet-hours" / "waiting: 10DLC"), never a silent no-op.

- **Benchmark (beat this):** Apollo / Salesloft honor unsubscribe + sending windows automatically *(we match, and add per-number 10DLC + mailbox-health gating)* — https://knowledge.apollo.io/hc/en-us/articles/4409477927309-Configure-a-Sequence-Sending-Schedule
- **Build docs:** internal — the gate is a shared pre-send function calling job D8 (DNC), the 3.14b quiet-hours check, the 3.10a 10DLC status, and the 5.4a health score; all already built in their home docs.

---

## Background jobs (trigger, algorithmic steps, pg-boss params)

*Queued jobs run on **pg-boss** (the Postgres-backed durable runner, doc 12) — the same engine as the workflow executor (doc 10 W2), so delays/retries/restart-survival come for free. Inbound reply detection rides existing webhooks (doc 5 mail sync, doc 3a SMS webhook).*

- **S1 — Enrollment engine.** **Trigger:** a single enroll (Journey 15.5), a bulk enroll (Journey 15.6), a workflow "enroll" action (doc 10), or a "keep enrolling list members" rule. **Steps:** for each person → run the **pre-enroll check** (DNC, already-enrolled, merge data) → skip with a bucketed reason or create a `SequenceEnrollment` at step 0 pinned to the live `SequenceVersion` → respect the **daily new-enrollment cap** (stagger overflow with `startAfter`) → schedule the first step via S2 → write the timeline entry. **pg-boss:** queue `sequence-enroll`, `retryLimit: 3`, **idempotent per `(sequenceId, recordId, enrollBatchId)`** so a retried bulk chunk never double-enrolls, `singletonKey = enrollBatchId` to keep one bulk run's chunks ordered, chunked ~500/job.
- **S2 — Per-step scheduler ("wake at day N, send or create the task").** **Trigger:** a scheduled resume per enrollment (self-rescheduling: each step schedules the next). **Steps:** wake for enrollment E's current step → **run the compliance gate (Journey 15.12)**; if a rule holds it, re-schedule for the window open (`startAfter`) → else: **auto-email/auto-SMS** → send via doc-5/doc-3a path, record `SequenceStepRun` + the `EmailMessage`/`SmsMessage`; **manual-email/SMS/call** → create a `Task` (doc 4d) in the rep's Today queue; **wait** → schedule the next step after the delay; **branch** → evaluate the condition and pick the path → advance to the next step and schedule it. **pg-boss:** queue `sequence-step`, **scheduled** per enrollment (`resumeAt`), `retryLimit: 3` with backoff, **idempotent per `(enrollmentId, stepId, versionId)`** so a retry never double-sends, `singletonKey = enrollmentId` to serialize one person's steps (no two touches racing).
- **S3 — Reply / signal detection → auto-exit.** **Trigger:** an inbound activity event — email reply (doc 5.2 matcher), inbound SMS/STOP (doc 3a), inbound call, meeting booked (doc 5.6), a DNC write, or a qualifying call disposition (doc 2.4). **Steps:** find active enrollments for the matched person → for a **reply**, run the **reply-intent classifier** (`claude-haiku-4-5`, Journey 15.8) → apply the auto-exit rules (exit / DNC-exit / ignore-if-OOO / flag) → on exit, cancel scheduled S2 jobs for that enrollment, set status, notify the rep, write the timeline entry. **pg-boss:** queue `sequence-exit`, `retryLimit: 3`, **idempotent per `(enrollmentId, triggerEventId)`** (a webhook can fire twice), `singletonKey = enrollmentId` so exit and a racing step can't both act.
- **S4 — Analytics rollups.** **Trigger:** pg-boss **cron** (every ~15 min) + an on-demand recompute when the Analytics tab opens stale. **Steps:** aggregate `SequenceStepRun` + linked `EmailMessage`/`SmsMessage`/`Call` outcomes into per-step and per-sequence counters (sent/delivered/open/reply/meeting/opt-out/bounce), split by variant → upsert `SequenceStepStat`. **pg-boss:** queue `sequence-stats`, `retryLimit: 2`, `singletonKey = sequenceId+window` so a sequence rolls up once per window, cron `*/15 * * * *`.

**Monitoring** for S1–S4 rides the shared runner (doc 12): queue depth, failure rate, and dead-letter count to Axiom with the standard "failed jobs > N in 10 min" alert. A **runaway guard** (like doc 10.9): a sequence exceeding a sends-per-hour ceiling pages the operator (doc 13) and can be killed workspace-wide — because unattended sends are a cost and reputation event.

---

## Decisions for you

**1. Manual-send steps — draft-and-queue, or true unattended send?** **Pick: draft-and-queue for email, per-step choice for SMS (my pick).** Email manual steps drop a reviewable draft in the Today queue and require an explicit Send, honoring the repo-wide *"sending email is always explicit"* rule (doc 5.5) — this is what keeps a sequence from silently blasting half-baked AI copy. SMS gets a **per-step auto/task toggle** because a "confirming our 2pm" text is safe to automate. *Alternative: fully-unattended auto-email everywhere (Salesloft/Apollo default) — faster at volume, but one bad template torches a domain and trust; flip individual steps to auto once the rep trusts them. Tell me if you want unattended auto-email on by default.*

**2. What counts as a "reply" for auto-exit — any inbound, or AI-classified?** **Pick: AI-classified with a cheap model (my pick).** A raw "any inbound message exits" rule over-exits on auto-replies and OOO, and under-serves on "unsubscribe me" (which should exit *and* DNC, not just exit). Classifying with **Claude Haiku 4.5** (cheap, once per reply) gets the four cases right for tenths of a cent. *Alternative: dumb "any inbound = exit" — zero AI cost and dead simple, but a vacation auto-reply pulls a hot lead out of the cadence. We can ship dumb first and layer the classifier.*

**3. Editing a live sequence — freeze in-flight, or offer migration?** **Pick: freeze in-flight, opt-in migration (my pick).** In-flight enrollments finish on the version they started on (mirrors doc 10.6 workflow versioning), with an explicit, off-by-default *"apply to the N in-flight?"* choice — silent migration is how people get double-sent. *Alternative: always migrate everyone to the newest version — simpler mental model, one live plan, but it reshuffles schedules and risks duplicate or skipped touches for people mid-cadence.*

---

## Technology choices (this doc)

Builds on the existing stack (React front end, Postgres+Prisma, pg-boss, Twilio, Gmail/Graph, TipTap, Vercel AI SDK — see [doc 12](../development-guidelines/12-devops-and-infrastructure.md) for the front-end/host choice).

- **Runs on pg-boss, not a new engine** — the sequencer is the **same durable runner** as workflows (doc 10) and the dialer jobs. Day-offset scheduling = a self-rescheduling `sequence-step` job per enrollment (`resumeAt`), so delays, retries, and restart-survival are free. No Temporal/n8n for the MVP.
- **Channels are reused, not rebuilt** — email = doc-5 composer + send path; SMS = doc-3a send + 10DLC; call = a doc-4d `Task` worked in the doc-2 dialer. The sequencer only orchestrates; each channel keeps its single implementation.
- **Compliance is a shared pre-send gate** (Journey 15.12) calling the existing D8 (DNC), quiet-hours (3.14b), 10DLC (3.10a), and mailbox-health (5.4a) code — exactly one implementation of each rule.
- **AI is provider-agnostic and super-admin-set** (doc 13) via the Vercel AI SDK: **`claude-sonnet-5`** for step-email drafting (quality, at build time), **`claude-haiku-4-5`** for reply-intent classification (cheap, per-reply). Defaults, swappable on the backend; no per-user model picker.
- **Analytics reuse the reporting source** — sequence rollups read the same `EmailMessage`/`SmsMessage`/`Call` activity tables doc-5b reporting reads, so sequence numbers and CRM numbers never disagree.

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. New models marked `// NEW`. **Reuses existing objects** — `Record`/`Person` (doc 1/4), `Task` (doc 4d), `EmailMessage` (doc 5), `SmsMessage` (doc 3a), `Call` (doc 1/2), `Campaign` (doc 5), `DncEntry` (doc 3a) — a sequence *references* these, it does not duplicate them.

```prisma
model Sequence {                 // NEW — a cadence definition (Journeys 15.1/15.11)
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  status        String   @default("draft") // draft | live | paused | archived
  campaignId    String?                     // optional rollup under a Campaign (doc 5)
  sendMailAccountId String?                 // default sending mailbox (doc 5 MailAccount)
  sendWindowStart Int    @default(480)      // minutes from midnight, prospect-local (8:00)
  sendWindowEnd   Int    @default(1020)     // 17:00; always clamped by quiet-hours (3.14b)
  dailyEnrollCap  Int    @default(40)       // new enrollments/day/mailbox (deliverability, 15.12)
  autoExitJson    Json                      // { onReply, onMeeting, onOptOut, onDnc, onFinishSetField } (15.8)
  liveVersionId   String?                   // published version pointer
  createdById     String?                   // owner (doc 11 perms, later)
  deletedAt       DateTime?                 // soft-delete → trash, 30-day (15.11)
  versions        SequenceVersion[]
  createdAt       DateTime @default(now())
}

model SequenceVersion {          // NEW — immutable snapshot of steps; in-flight enrollments pin it (15.9)
  id          String  @id @default(cuid())
  sequenceId  String
  version     Int
  steps       SequenceStep[]
  createdAt   DateTime @default(now())
  @@unique([sequenceId, version])
}

model SequenceStep {             // NEW — one step in a version (Journeys 15.2/15.3)
  id            String  @id @default(cuid())
  versionId     String
  position      Int                          // order within a day
  dayOffset     Int                          // days from enrollment (0 = day of enroll)
  type          String                       // auto_email | manual_email | call | sms | wait | branch
  sendMode      String? @default("auto")     // for sms: auto | task (15.2 type 4)
  waitDays      Int?                          // for type=wait
  sendWindowStart Int?                        // per-step override (else sequence default)
  sendWindowEnd   Int?
  subject       String?                      // email steps
  bodyJson      Json?                         // email/sms body (TipTap/plain) + merge fields (doc 5.5a)
  callScript    String?                       // call step battlecard (doc 2)
  branchJson    Json?                         // for type=branch: react-querybuilder condition + paths (15.8)
  variants      SequenceStepVariant[]         // A/B (15.4); empty = single body
  @@index([versionId, dayOffset, position])
}

model SequenceStepVariant {      // NEW — an A/B variant of an email/sms step (15.4)
  id          String  @id @default(cuid())
  stepId      String
  label       String                          // "A" | "B" | ...
  weight      Int     @default(50)            // split %
  subject     String?
  bodyJson    Json
  isWinner    Boolean @default(false)         // promoted (15.4 step 4)
}

model SequenceEnrollment {       // NEW — one person walking one sequence (Journeys 15.5/15.6)
  id            String   @id @default(cuid())
  workspaceId   String
  sequenceId    String
  versionId     String                        // pinned; live edits don't disrupt (15.9)
  personId      String                        // -> Person record (doc 4); reuse, don't duplicate
  status        String   @default("active")   // active | paused | completed | replied | removed | exited_dnc | exited_optout
  currentStepId String?
  resumeAt      DateTime?                      // next scheduled step wake (job S2)
  enrollBatchId String?                        // idempotency for bulk enroll (job S1)
  enrolledById  String?
  startedAt     DateTime @default(now())
  endedAt       DateTime?
  endReason     String?                        // reply | meeting | opt_out | dnc | disposition | finished | manual
  @@unique([sequenceId, personId])            // no silent double-enroll (15.5 step 3)
  @@index([status, resumeAt])                 // job S2 wake scan
}

model SequenceStepRun {          // NEW — one step executed for one enrollment (queue + history + analytics)
  id            String   @id @default(cuid())
  enrollmentId  String
  stepId        String
  variantId     String?                        // which A/B variant fired (15.4)
  status        String                         // scheduled | held | sent | task_open | done | skipped | failed
  heldReason    String?                        // quiet_hours | dnc | 10dlc | mailbox_health (15.12)
  taskId        String?                        // -> Task (doc 4d) for manual/call/sms-task steps
  emailMessageId String?                       // -> EmailMessage (doc 5) for email sends
  smsMessageId  String?                         // -> SmsMessage (doc 3a) for sms sends
  callId        String?                         // -> Call (doc 2) if a call step produced a call
  scheduledFor  DateTime?
  actedAt       DateTime?
  @@index([enrollmentId, stepId])
  @@unique([enrollmentId, stepId, variantId])  // idempotent send (job S2)
}

model SequenceStepStat {         // NEW — pre-computed rollups (job S4; Journey 15.10)
  id           String  @id @default(cuid())
  sequenceId   String
  stepId       String?                         // null = sequence-level top-line
  variantId    String?
  sent         Int     @default(0)
  delivered    Int     @default(0)
  opened       Int     @default(0)
  replied      Int     @default(0)
  meetings     Int     @default(0)
  optOuts      Int     @default(0)
  bounces      Int     @default(0)
  updatedAt    DateTime @updatedAt
  @@unique([sequenceId, stepId, variantId])
}
```

## Technical decisions, trade-offs & edge cases

- **One person, one enrollment per sequence** (`@@unique([sequenceId, personId])`) — re-enrolling offers Restart or Cancel (Journey 15.5), never a silent duplicate that double-sends.
- **`singletonKey = enrollmentId` on the step job serializes one person's touches** — the #1 way to avoid a race where a wait-resume and an exit both fire, or two steps send at once. Exit (S3) and step (S2) share the key so they can't both act on the same person concurrently.
- **The compliance gate runs at send time, not enroll time** — a person clean at enrollment can hit DNC or quiet-hours by the time a day-5 step wakes, so the gate re-checks on every step (Journey 15.12), and a held step shows *why* it's waiting rather than silently sending or silently dropping.
- **Auto-emails never appear in the Today queue** (Journey 15.7) — only human steps do, so the queue is a real to-do list. Conversely, a manual step that a rep ignores for days doesn't auto-send; it stays in the queue (overdue) — automation never sends what the rep was supposed to review.
- **Reply detection depends on the doc-5 matcher and doc-3a inbound webhook already resolving inbound activity to the enrolled Person.** If matching is wrong, exit is wrong — so the same ≥98%-precision bar the matcher carries (doc 5.2) protects the sequencer too.
- **Versioning pins in-flight enrollments** (Journey 15.9) — a live edit can't reshuffle or double-send people mid-cadence; migration is explicit and opt-in.
- **Deliverability is a first-class guardrail, not an afterthought** — new-enrollment caps, per-mailbox daily caps, warmup-aware limits, and health-based pausing (Journey 15.12) exist because the fastest way to kill a solo rep's outreach is to let a sequence burn their sending domain.
