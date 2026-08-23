# Doc 7b — Copilot Automations & the AI Event Engine

A companion to [7-ai-copilot.md](7-ai-copilot.md). The copilot's real differentiator is that the AI **runs on every event** — a call streaming, an email arriving, a meeting booked, a cron tick — and quietly keeps the CRM correct while proposing the next action. This doc defines that **event engine**, its **runs view**, and the **automation recipes** built on it (drawn from your own usage notes). Every recipe is a **skill** (toggleable), and each proposes/acts through the same **accept + provenance** path as doc 7 — nothing here writes silently. Same format; benchmarks where they exist.

> **This doc was reworked (Doc-7 family split).** The **thinking half of the event engine — deciding what to do on an event, and conditional "follow-up unless…" reminders (was 7b.3) — moved to the decision engine [7c](7c-ai-decision-engine.md).** The **AI-runs view (7b.2)** becomes 7c's audit journeys (G1 rep / G2 super-admin). The recipes below (7b.4–7b.13) are either **rethought to run through 7c** (meeting-agreed, call-me-back, wrong-person, reminders) or stay as their **own standalone features** (connected-number memory, dead-value, name pronunciation, DBA, calendar↔task) that 7c *uses*. Each recipe is also an **eval fixture** in [7a](7a-copilot-eval-fixtures.md).

**Phase note:** most of this is [P2]/[P3] and rides on the CRM, calling core, and copilot. Some recipes are "candy" — nice, not essential — and marked so.

---

## Design note — skills vs templates, and where to toggle (Idea #22)

Your question: where is the AI designed around **skills** vs **templates**, and where can you turn things off? The rule we use:

- **A template is a *shape* the AI fills** — a summary layout, an extraction field-set, an email/invite body, a qualification framework. Templates answer *"what should the output look like?"* (docs 2.7, 5.5, 7.3a).
- **A skill is an *action* the AI performs** — "find a mobile," "reconcile reminders," "draft the follow-up." Skills answer *"what should the AI do?"* (doc 7.8). A skill often *uses* a template to shape its output.
- **The event engine (below) binds skills to events** — "when a call ends, run these skills."

**Where you toggle:** each skill has an on/off (and a condition filter) in **Settings → Intelligence → Skills**; each template is enabled/edited in its own settings area. So "turn this behavior off" = disable the skill; "change what it writes" = edit the template. The recipes in this doc are all skills, each individually toggleable.

---

## Journey 7b.1 — The AI event engine (when the AI runs, and on what)

*As an admin, I want to know when and on what events the AI runs, so I understand and control its behavior.*

The backbone. Modeled **Trigger → Conditions → Skills → logged**, like Zapier/HubSpot/Attio automations but AI-native. (Your Idea #21.2/#21.3.)

1. **Trigger events (the AI runs on each):**

| Event | Fires when |
|---|---|
| `call.transcript.chunk` | streaming partial transcript — live, during the call |
| `call.ended` | the call completes, full diarized transcript ready |
| `email.received` / `email.sent` | inbound / outbound email logged to a contact |
| `sms.received` | inbound SMS |
| `voicemail.received` | a voicemail is transcribed |
| `calendar.event.created` / `.updated` | a meeting is booked, or accepted/declined/rescheduled/deleted |
| `schedule.cron` / `due_date.reached` | time-based (a follow-up due, a renewal offset) |

2. **Skills attach to events in two modes (your Idea #21.3):**
   - **Global skills — run on ALL events:** always-on housekeeping, e.g. **Reconcile open reminders** (did this event close/snooze one? — Journey 7b.3), entity/contact matching, timeline logging, deal-health re-scoring, next-best-action, data hygiene/enrichment, dedupe check, and consent/DNC flagging.
   - **Scoped skills — run on some,** gated by a condition (pipeline, deal stage, keyword, record filter). E.g. "objection roll-up" only on `call.ended` where stage = Negotiation.
3. **During-call vs end-of-call (your Idea #21.3.3):** a live call runs a **continuous** set during the stream (name-pronunciation capture, live objection/competitor alerts, wrong-number/gatekeeper detection, talk-ratio coaching) and a **one-shot** set at `call.ended` (full summary, action-item extraction, follow-up drafting, qualification fill, disposition). The engine knows which set is which.
4. Each skill declares: the **event(s)** it listens to, its **condition**, its **prompt/instructions** (or template), and the **tools/data it may touch** (CRM read/write, enrichment, web, messaging). One event fans out to many skills.

- **Benchmark (beat this):** HubSpot — AI in workflows — https://knowledge.hubspot.com/workflows/use-ai-assistants-in-workflows ; Attio — workflows/agents — https://attio.com/platform/workflows ; Gong — smart trackers/signals
- **Build docs:** internal — an event bus + skill registry; skills run on pg-boss (durable), live-call skills run inline for latency.

## Journey 7b.2 — See when the AI ran (the "AI runs" view, Idea #21.4)

*As a superadmin, I want to see every time the AI ran, what fired, and what it touched, so I can trust, debug, and replay it.*

You asked for a way to see *when the AI ran, what skills it evaluated, and what tools it touched.* This is its own view.

1. **Settings → Intelligence → AI runs** — a **list**: status (Success / Error / Skipped-by-condition / Running), when it ran (start + duration), the **triggering event** + the record/call it ran on, which **skill(s)** fired, and the model/cost.
2. **Filters:** by event type, by skill, by status, by record/contact/deal, by time range.
3. **Drill into one run** — an ordered **trace**: the event + its payload; each skill evaluated with **why it ran or was skipped** (which condition matched); the **exact instructions / prompt version** used; the **tools + data touched** (records read, fields written, enrichment/web calls, messages sent), each with input → output; the AI output; and any error with the failing step. A **Re-run** control replays the event through the same skills.
4. This is the audit trail that answers *"did the AI run, what fired, what did it change, can I trust/replay it"* — and it feeds evals (doc 7.9).

- **Benchmark (beat this):** Zapier — task history — https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details ; n8n — executions — https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow
- **Build docs:** internal — the `AiRun` model (below).

## Journey 7b.3 — Conditional reminders that auto-complete ("follow up unless…", Idea #21)

**→ Replaced by the decision engine [7c](7c-ai-decision-engine.md).** A reminder is no longer a fixed rule with an enum of conditions; it is an **open loop** — a cue for the AI to re-read the account on its scheduled check (or on a matching event) and pick a move (resolve / wait / act / ask / hand back). Natural-language conditions are first-class and AI-judged. The good "reason-note + undo" auto-complete UX is kept ([7c.24](7c-ai-decision-engine.md)).

## Journey 7b.4 — Meeting agreed on a call → auto-draft invite, email, reminder (Idea #11)

*As a rep, when I agree a meeting on a call, I want the invite, confirmation email, and a reminder drafted for me, so I don't set them up by hand.*

When the transcript detects a meeting agreed with a **date + time**, the copilot proposes (in the 7.1 stack — never auto-fires):

1. A **calendar invite draft** — attendees, time, and a **template** you set, e.g. Location: *"Ryan to call {{person}} at {{phone}}"*.
2. A **confirmation email draft** to the prospect.
3. A **reminder task** scheduled for **the day before** — *provided the meeting is ≥ X days away* (a setting), so you don't get a same-day reminder for a same-day meeting.
4. Templates for all three live in **Settings → Intelligence → Meeting automation**; the behavior has an **on/off** (or is just text in the skill's prompt).

- **Benchmark (beat this):** Attio / HubSpot meeting scheduling ; the doc-7 proposal stack (7.1) is the delivery surface
- **Build docs:** reuses the calendar draft (doc 5.6), the composer (doc 5.5), the task (doc 4.14).

## Journey 7b.5 — "Call me back at X" (no meeting) → internal reminder (Idea #12)

*As a rep, when someone says "call me back Thursday at 2," I want a reminder set for then, so I don't forget.*

If the transcript hears *"call me back Thursday at 2"* but **no formal meeting is agreed**, the copilot proposes an **internal calendar reminder / task** at that time (a **customizable event template**), with an **on/off** setting. It's a reminder for the rep, not an invite to the prospect.

- **Benchmark (beat this):** the 7b.3 reminder engine ; the 7.1 proposal stack
- **Build docs:** reuses the task/reminder model (doc 4.14) + 7b.3 conditions.

## Journey 7b.6 — Didn't connect → draft a "tried to reach you" email (Idea #16)

*As a rep, when a call doesn't connect, I want a short "tried to reach you" email drafted, so I follow up without thinking about it.*

When a call **doesn't connect** (no answer / voicemail), the copilot proposes a short follow-up email from a **customizable template/skill** — *"Tried you just now, will try again — or grab a time here."* It can reference call context: *"you'd asked me to call back,"* or *"I'll try again {{when}}."* Proposed in the 7.1 stack, editable, never auto-sent.

- **Benchmark (beat this):** Superhuman auto-drafts ; the 7.1 stack
- **Build docs:** reuses the composer (doc 5.5) + a "no-connect" email template.

## Journey 7b.7 — Reached a gatekeeper / the wrong person → upsert, persona, research (Ideas #10, #14)

*As a rep, when I reach a gatekeeper or the wrong person, I want them saved and researched, so I know who I talked to and who to reach next.*

When the AI on the transcript detects you reached **someone other than the intended target** (a gatekeeper or a different person), and this **skill is toggled on**:

1. **Upsert that person** as a contact on the account, **link them to this call**, and **mark their persona** (`gatekeeper`, or the right value — doc 4).
2. **Enrich** their **title** and, where possible, email/phone (waterfall, doc 7.7).
3. **Quick web research (Idea #14):** run a fast lookup to show you their **title / department + a link to their details**, right on the call screen, so you know who you're talking to.

- **Benchmark (beat this):** Gong account/contact capture ; doc 6 call-matching (6.7)
- **Build docs:** reuses upsert (doc 8.1a), enrichment (doc 7.7), call-matching (doc 6.7); persona field (doc 4).

## Journey 7b.8 — Learn which numbers and extensions connect (Ideas #17, #18)

*As a rep, I want the dialer to remember which number and extension actually connect, so next time it picks the good one.*

The dialer learns from outcomes and makes next time easier.

1. **Connected-number memory (#17):** when a call **connects to a human**, we bump `connectCount` + `lastConnectedAt` on that **ContactPhone** (doc 3.14c). **Next time**, the dialer **defaults to that number** and marks it with a small **"usually connects"** chip in the number list — so "prompt me" means the good number is pre-selected and badged, not a text nag.
2. **Extension memory (#18):** when you dial an **IVR extension** to reach someone, we save it on the ContactPhone; with a setting on, the AI **auto-dials the saved extension at the right point** in the call. We track whether it was **confirmed correct** (`extConfirmed`) and show the same "usually works" badge; a wrong extension is cleared.
3. **The dead side (your "same for dead numbers?"):** yes — a number/extension that **repeatedly fails** is marked dead (Journey 7b.9), so it's de-prioritized, not re-tried. This "dead" concept is universal (Journey 7b.9).

**The UI journey (record it, use it next time):** *record* — on connect/disconnect, the dialer writes the outcome to the ContactPhone silently. *Use* — next dial, the number picker shows numbers ranked with "usually connects" / "dead" chips, and the top one is pre-selected.

- **Benchmark (beat this):** PhoneBurner / Orum number preferences ; internal
- **Build docs:** ContactPhone (doc 3.14c) `connectCount`/`lastConnectedAt`/`autoDialExt`/`extConfirmed`.

## Journey 7b.9 — Wrong number / bad email → mark dead, and offer a better one (Ideas #1, #2, #19)

*As a rep, when a number or email is clearly wrong, I want it marked dead and a better one offered, so I stop wasting dials on it.*

The **dead-value pattern** (doc 3.14c) applied at the moment of failure, on every channel.

1. **On a wrong-number call (Idea #1):** the AI (transcript) and the rep both can act. **Auto-mark wrong** when the signal is clear — *the person who answered has a different name, the answering-machine names a different person, the number is out of service, or they say "wrong number."* Expose a **"Mark wrong number"** button too. When marked: **save the number as dead** (won't be used again), **save the reason**, and offer **"Find a better number"** (enrich). **Iffy signals do NOT auto-mark** — a **repeatedly-full mailbox** or **rings forever** is flagged "iffy," not dead (probably not wrong).
2. **On an email bounce (Ideas #2, #19):** **auto-mark the email dead with the bounce reason**, expose a **"Mark wrong"** button, offer **"Find a better email"** (enrich), and if the person signals they prefer a **different address**, record that preference and use it next time.
3. **The "dead" concept is universal (your question):** the same `{value, status, reason, source, checked_at}` shape covers **phone, email, and even a stale title** — so a re-import or a future enrichment **skips known-dead values** and continues the waterfall (doc 7.7). Nothing is deleted; it's marked, with provenance (who/when/why).

- **Benchmark (beat this):** custom (dead-value pattern) ; doc 3.14c number hygiene
- **Build docs:** ContactPhone / EmailAddress status + reason (docs 3.14c / 4); the AI wrong-number skill runs on `call.ended`.

## Journey 7b.10 — Capture the prospect's name: spelling and pronunciation (Ideas #8, #20)

*As a rep, I want to see and hear how to say a prospect's name before I call, so I don't get screened out.*

1. **Nickname / preferred name (Idea #8):** when a prospect (or a web source) uses a **nickname or diminutive** ("call me Matt"), the AI saves it to the person's **preferredName** field and keeps the formal name in **legalName** (doc 4). Since **display name = preferredName**, the next time you call you'll see and say the name they actually use.
2. **Pronunciation clip (Idea #20 — helps you not get screened out):** when the AI hears the **prospect or gatekeeper say their own name** in the transcript, it **clips that audio** from the recording, saves it, and associates it with the person. On the **next call**, just **before the ring**, the dialer plays **"Calling …"** (a recorded AI voice) **+ the clip of their name in their own pronunciation** — so the rep hears how to say it. *(Precedent: NameCoach does clip-before-call in Salesforce — this is table-stakes done better, sourced from your own recordings.)*

- **Benchmark (beat this):** NameCoach (pronunciation clip before a call) — https://cloud.name-coach.com/
- **Build docs:** doc 6 (transcript + audio clip) + doc 2 (dialer plays the clip pre-ring); preferredName (doc 4).

## Journey 7b.11 — Capture a company's DBA from LinkedIn/enrichment (Idea #9)

*As a rep, I want the company shown by the name it actually goes by, so I sound like I know them.*

When we run a LinkedIn/enrichment lookup for a company and the **name they go by (DBA) differs** from the legal name we have, we grab the **DBA** and store it in the company's `dba` field. Since **display name = dba if set, else legalName** (doc 4), we refer to the company by the name **they** use, not the legal entity.

- **Benchmark (beat this):** doc 5.13 LinkedIn extension + doc 7.7 enrichment
- **Build docs:** Company `dba`/`legalName` (doc 4).

## Journey 7b.12 — A lift after a tough call (candy, opt-in — Idea #15)

*As a rep, I want a small lift after a rough call (if I opt in), so I keep my energy up for the next dial.*

After a rejection/bad call, optionally show a short **motivational message** in text (Call-of-Duty-death-screen energy), with a **chevron** to cycle a **carousel** of more. We keep a **library** of messages and rotate through them. **Opt-in**, because reactions to being "gamified after failure" vary. Placement: a small card in the **copilot rail** (or the agent chat) on a negative disposition; dismissible; never blocks the next call. *(Novelty check: gamification exists — Nooks/Outreach leaderboards — but a consoling post-rejection message is genuinely novel; that's the point.)*

- **Benchmark (beat this):** custom (no direct precedent; Nooks gamification is the nearest neighbor) — https://www.nooks.ai/ai-dialer
- **Build docs:** internal — a `MotivationalMessage` library + a disposition-triggered card.

## Journey 7b.13 — Calendar ↔ task sync, and the model (Idea #13)

*As a rep, I want my tasks and calendar meetings linked and kept in sync, so nothing falls through when a meeting moves.*

**Your question — should the calendar event be its own record and the source of truth, replacing tasks/reminders? My recommendation: no — keep them separate but linked.** Every mature CRM (HubSpot, Salesforce, Attio) keeps **Task and CalendarEvent as distinct objects and links them**, because (a) many action items aren't meetings ("send the contract", "call back"), and (b) a slot can move without losing the "prep for this" action. Making the event the *sole* record loses a home for non-meeting to-dos and churns them on every reschedule. So:

1. **Two objects, two-way linked:** `Task.eventId` (nullable) and the event lists its tasks; `Task.origin = manual | calendar` so calendar-derived tasks are distinguishable.
2. **Which event states change the task (the sync rules):**

| Calendar event state | Effect on the linked task |
|---|---|
| accepted / confirmed | no change (stays open) |
| tentative | no change; optionally flag "unconfirmed" + a nudge reminder |
| **rescheduled** | move the task's due date / reminder to the new time; keep open |
| **declined** | do **not** auto-complete → prompt "re-propose or cancel?" (+ deal-risk flag) |
| **cancelled / deleted** | cancel a calendar-*derived* task; leave a user-authored task open |
| time passes / meeting happens | do **not** auto-complete on the clock → prompt **"did this happen? log the outcome"** |

3. **Auto-completion is explicit** — driven by **logging a call/meeting outcome** (or the 7b.3 reminder conditions), never by the clock or an accept. This matches all three CRMs and avoids silently marking work done. *(This answers your #13.4 — the AI proposes "mark done / reschedule" as a next step when an event state changes, but the human confirms.)*
4. **Links both ways (your #13.3):** open a task from its event and the event from its task.
5. **The unified view (your #13.7):** one **"Today / What's due"** view is a **union of real tasks + read-only calendar-derived rows** (rendered with a calendar glyph, showing RSVP state, not directly completable — you act on the event or its prep task). Group **Overdue → Today → Upcoming**, with a pinned "Meetings today" strip. Filter by `origin` to hide calendar items. Reminders are a **field on the task**, not a third object, so nothing double-counts.

- **Benchmark (beat this):** Salesforce Task/Event model — https://www.salesforceben.com/salesforce-activities-everything-you-need-to-know/ ; Attio — connect any record to meetings — https://attio.com/changelog/connect-any-record-to-your-meetings
- **Build docs:** Task (doc 4.14) + CalendarEvent (doc 5.6) with `eventId`/`origin` links.

---

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. **New models `// NEW`; `// added` extends existing.**

```prisma
model Task {                 // existing (doc 4.14) — extended for calendar sync + conditions
  // ...existing, plus:
  eventId       String?      // added: linked CalendarEvent (7b.13)
  origin        String  @default("manual") // added: manual | calendar (7b.13)
  condition     Json?        // added: "auto-complete when {reply|meeting|accept|...}" (7b.3)
  autoClosedBy  String?      // added: the event id that auto-completed it (with reason)
}

model SkillBinding {         // NEW — binds a skill to event(s) with a condition (7b.1)
  id          String  @id @default(cuid())
  workspaceId String
  skillId     String        // -> Skill (doc 7.8)
  events      String[]      // call.ended, email.received, schedule.cron, ...
  scope       String  @default("global") // global | scoped
  conditionJson Json?       // pipeline/stage/keyword/record filter for scoped skills
  phase       String  @default("post") // during | post  (live-call vs end)
  isEnabled   Boolean @default(true)    // the per-skill toggle (Idea #22)
}

model AiRun {                // NEW — one execution of the engine on an event (7b.2)
  id          String   @id @default(cuid())
  workspaceId String
  event       String        // the trigger event
  eventRefJson Json         // the payload / record it ran on
  status      String        // success | error | skipped | running
  skillsFired Json          // [{skillId, ranOrSkipped, why, promptVersion, toolsTouched, io}]
  durationMs  Int?
  cost        Float?
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
}

model MotivationalMessage {  // NEW — the library for the post-bad-call lift (7b.12, candy)
  id          String  @id @default(cuid())
  workspaceId String
  text        String
  isEnabled   Boolean @default(true)
}
// Pronunciation clip (7b.10) rides on the call recording: a NamePronunciation row
// { personId, clipStorageKey, capturedFromCallId } the dialer plays pre-ring.
// preferredName/legalName/persona (Person) and dba/legalName (Company) are in doc 4.
```
