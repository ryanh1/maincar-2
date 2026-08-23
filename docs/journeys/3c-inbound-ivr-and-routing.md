# Doc 3c — Inbound Calling, IVR & Routing

Same journey format as the rest of the doc-3 family. This is the **inbound** side of the phone system — what happens when someone **calls one of our numbers** — plus the **outbound phone-tree navigation** that helps a rep punch through a callee's IVR.

**Why this doc exists (the change of mind).** Earlier we deferred IVR / inbound transferring / redirecting. **We're building it now.** The near-term product is outbound-heavy, but a sales team also *receives* calls — a prospect calls back the number on their caller ID, a deal calls the main line — and today those calls have nowhere structured to land. This doc gives every inbound number a **menu, a routing brain, business hours, ring groups, and voicemail**, and it leans on the one thing generic phone systems can't do: **we know who's calling and whose deal it is**, so we can route the caller straight to their account owner.

**What already exists (we build on, don't redo):**
- **A direct inbound call to a rep's own number** already screen-pops the caller's CRM record and can ring the rep's cell — **doc 2 Journey 2.1** and **2.15**. This doc handles the **shared / main-line** case and *hands off* to that same answer experience once a call is routed to a rep.
- **Warm/cold transfer between reps** is **doc 3a Journey 3.13** (+ presence 3.13a). Inbound calls reuse it; we don't redefine transfer here.
- **Numbers, number health, local presence** are **doc 3a (B)**. **Voicemail greeting + inbox** are **doc 2** (2.13-ish) and voicemail **transcription** is **doc 3a Journey 3.5a** — inbound voicemail reuses both.
- **Consent / recording announcement** by state is **doc 2 Journey 2.3** — inbound recording obeys it.

**Journey numbers** continue the family: this doc is **3.15–3.20**.

Under each journey: **Benchmark (beat this)** = the product to match, with a link. **Build docs** = the page that tells the coding agent how to build it. Telephony is **Twilio**; TwiML verbs are named exactly so a coding agent can wire them.

---

## New surfaces this doc adds

- **Settings → Phone numbers → [a number] → Inbound** — per-number inbound config: greeting, business hours, what the number does (ring a rep, an IVR menu, a ring group, or forward out).
- **The IVR builder** — a simple visual menu editor ("Press 1 for Sales → ring the Sales group").
- **Routing rules editor** — the brain that decides who an answered inbound call goes to (account owner first).
- **Ring groups** — named sets of reps with a ring strategy.
- **An inbound-call banner/pop** — the same screen-pop as doc 2.1, now reached via the menu/route.
- **Outbound "navigate the phone tree"** — a quiet assist during power/manual dialing.

---

# A. Inbound: receive, route, and answer

## Journey 3.15 — Configure an inbound number (greeting, hours, what it does)

*As an admin, I want to decide what each of our numbers does when someone calls it, so that inbound calls are answered the way we want instead of ringing into nothing.*

1. **Entry point.** **Settings → Phone numbers** lists the workspace's Twilio numbers (from doc 3a). Clicking a number opens its detail; a new **Inbound** tab holds this config. (A number with no inbound config falls back to today's behavior: if it's a rep's personal number, ring that rep per doc 2.1; otherwise straight to voicemail.)
2. **Pick what this number does (the top-level choice, a segmented control):**
   - **Ring a person** — one rep (their app + optional cell, doc 2.15).
   - **Ring a group** — a ring group (Journey 3.18).
   - **Play a menu (IVR)** — an auto-attendant (Journey 3.16).
   - **Forward out** — redirect to an external number (e.g. an answering service or a personal cell that isn't in the app), via TwiML `<Dial><Number>` with `callerId` set so the rep sees the *original* caller. A **whisper** ("call for {workspace} from {caller}") plays to the rep first so a forwarded call is recognizable.
3. **Greeting.** A per-number greeting played before anything else: **record/upload** (TwiML `<Play>`) or **type for text-to-speech** (`<Say>`). Optional — skip straight to ring/menu if empty.
4. **Business hours + holidays.** A weekly schedule (per number, in the workspace timezone) with a holiday list. **Open** → run the chosen action (ring/menu/group). **Closed** → a closed-hours branch: a "we're closed" greeting then **voicemail** (Journey 3.19 step 5), or a fallback forward. *There is no Twilio verb for hours — we branch in our webhook by checking the current time against the schedule before returning TwiML.* An explicit **override** ("Closed now" / "Open now") for a one-off.
5. **Recording toggle.** Whether inbound calls on this number are recorded — obeys the consent posture (doc 2 Journey 2.3); when on, an announced-recording greeting is added to the open-hours flow.

- **Benchmark (beat this):** Aircall — building a support IVR in Smartflows [how it works: Time Rule widget for hours, then the keypad menu] — https://support.aircall.io/hc/en-gb/articles/16756868505245-How-to-Build-a-Simple-Support-IVR-in-Smartflows ; Aircall — configuring numbers, voicemail, music and messages — https://support.aircall.io/hc/en-gb/articles/10375395294109-Configuring-Numbers-Voicemail-Music-and-Messages ; Kixie — manage business hours and after-hours voicemail [how it works: hours set per agent / ring group / IVR / queue, global overrides] — https://support.kixie.com/hc/en-us/articles/18787546339995-Manage-Business-Hours-and-Voicemails-for-After-Hours-Calls
- **Build docs:** Twilio `<Dial>`/`<Number>` (forward, callerId, answerOnBridge) — https://www.twilio.com/docs/voice/twiml/dial ; `<Say>`/`<Play>` greetings — https://www.twilio.com/docs/voice/twiml/say ; business-hours logic lives in our webhook (no verb).

## Journey 3.16 — Build an IVR / auto-attendant menu (config)

*As an admin, I want a "press 1 for Sales, 2 for Support" menu, so that callers route themselves to the right place.*

1. **Entry point.** On a number set to **Play a menu** (3.15), an **Edit menu** button opens the **IVR builder**.
2. **The builder (kept deliberately simple).** A **greeting/prompt** (record or TTS: "Thanks for calling Acme — press 1 for Sales, 2 for Support…") plus a list of **options**. Each option row: a **key** (0–9, `*`, `#`), a **label**, and a **destination** — ring a person, ring a group, another (nested) menu, forward out, or go to voicemail. Add/reorder/delete option rows; a menu can nest one or two levels deep (guardrail: warn on deeper trees — long mazes are the #1 caller complaint).
3. **Input mode.** DTMF by default; optionally **speech too** ("say 'sales' or 'support'"). We use Twilio `<Gather input="dtmf speech">` with `numDigits=1`, `finishOnKey`, a `timeout`, `hints` (the option labels) and a `speechModel` (`deepgram_nova-2`) pinned for reproducibility.
4. **No-input / invalid-key handling (defensive).** On timeout or an unmapped key: **re-prompt once**, then fall to a **default destination** (a "0 or stay on the line for an operator" style catch-all) — never a dead end or a silent hang-up. Configurable retry count and default.
5. **Preview.** A **Test call** button dials the admin so they can hear the menu before it goes live.

- **Benchmark (beat this):** Kixie — set up an IVR (phone tree) [how it works: plan the options, then layer sub-menus] — https://support.kixie.com/hc/en-us/articles/4402428065435-How-to-Set-Up-an-IVR-Phone-Tree- ; Aircall — building a support IVR in Smartflows [how it works: widget-by-widget] — https://support.aircall.io/hc/en-gb/articles/16756868505245-How-to-Build-a-Simple-Support-IVR-in-Smartflows ; Aircall — the Input IVR widget — https://support.aircall.io/en-gb/articles/30244205707421
- **Build docs:** Twilio `<Gather>` (dtmf+speech, numDigits, finishOnKey, hints, speechModel) — https://www.twilio.com/docs/voice/twiml/gather ; keypad-input tutorial — https://www.twilio.com/docs/voice/tutorials/how-to-gather-user-input-via-keypad

## Journey 3.17 — Route an inbound call to the right rep (the routing brain)

*As a rep, I want an inbound call from one of my accounts to come straight to me, so that my prospects reach their actual contact instead of a random queue.*

This is the CRM-native advantage. When a call reaches a **ring-a-person/group destination** (directly, or via a menu option), the router decides **who** it should reach. Evaluated top-down; first rule that applies wins (all rules optional/orderable in the routing editor):

1. **Match the caller to a CRM record** (by inbound caller-ID number → `ContactPhone`, the doc-2 screen-pop match). If matched:
   - **Route to the account owner** (the matched Person/Company/Deal's owner, doc 11) if they're **available** (presence, doc 3a 3.13a). This is the headline behavior — *your prospect reaches you.*
   - If the owner is **unavailable**, fall to the next rule (their team/ring group, then a general group).
2. **Sticky routing (optional).** Route to the **rep who last spoke with this caller** (from call history) even if not the formal owner — continuity over org chart, admin's choice.
3. **Group fallback.** No CRM match, or owner+team unavailable → the destination's **ring group** (Journey 3.18) with its strategy (simultaneous / round-robin).
4. **Everyone unavailable / no answer** → **voicemail** (Journey 3.19 step 5), attached to the matched record if we have one. We **never** ring into dead air.
5. **Blocked/DNC caller** (doc 3a 3.14a) → still answerable, but flagged on the pop; a workspace can choose to send known-spam numbers straight to voicemail.

**How it's built:** the router runs in our inbound webhook — it resolves the record + owner + presence, then returns TwiML that `<Dial>`s the chosen `<Client>` (the rep's softphone) / `<Number>` (cell) / ring group, with `answerOnBridge` so the caller hears ring-back, an `action` callback to catch no-answer and fall through to the next rule, and `record` per 3.15.

- **Benchmark (beat this):** Aircall — call routing with Smartflows: FAQs [how it works: how a call is distributed] — https://support.aircall.io/hc/en-gb/articles/10375552874141-Call-Routing-with-Smartflows-FAQs ; HubSpot/Dialpad — route inbound to the record owner — https://www.dialpad.com/app-marketplace/hubspot/ (owner-routing is our differentiator vs. generic PBX)
- **Build docs:** Twilio `<Dial>` with `<Client>`/`<Number>`, `answerOnBridge`, `action` fallthrough — https://www.twilio.com/docs/voice/twiml/dial ; presence = doc 3a 3.13a; owner = doc 11; caller match = doc 2 Journey 2.1.

## Journey 3.18 — Ring groups (config + behavior)

*As an admin, I want a named group of reps that inbound calls can ring together or in turn, so that a call gets picked up fast without me hand-picking a person each time.*

1. **Entry point.** **Settings → Phone numbers → Ring groups** → **New group**. A group = a **name**, a **member list** (reps), and a **strategy**.
2. **Strategy (choose per group):**
   - **Simultaneous** — ring all available members at once, first to answer wins (Twilio `<Dial>` with multiple `<Client>`/`<Number>` nouns).
   - **Round-robin** — ring members in rotation, spreading load (chain via `<Dial action>` fallthrough, advancing the rotation cursor).
   - **Sequential (linear)** — a fixed order (escalation: rep → manager).
3. **Per-member ring time + skip-if-unavailable.** Each ring attempt honors presence (skip Away/DND, doc 3a 3.13a) and a per-attempt `timeout`; the group's overall timeout falls to voicemail (3.19 step 5).
4. **No-one-available fallback.** If every member is unavailable, the group goes straight to its **fallback** (voicemail or another group) — configurable, never dead air.

- **Benchmark (beat this):** Kixie — setting up a ring group [how it works: Manage → Inbound → Ring Groups; simultaneous / linear / linear round-robin] — https://support.kixie.com/hc/en-us/articles/4402351318939-Setting-up-a-Ring-Group ; ring-group behavior FAQ — https://support.kixie.com/hc/en-us/articles/17237680413339-Inbound-Ring-Group-FAQs
- **Build docs:** Twilio `<Dial>` multi-noun (simultaneous) + `action` chaining (sequential/round-robin) — https://www.twilio.com/docs/voice/twiml/dial ; queueing at scale (later) — `<Enqueue>`/TaskRouter — https://www.twilio.com/docs/voice/queue-calls

## Journey 3.19 — The caller's runtime journey (menu → route → answer / transfer / voicemail)

*As the system, I want a caller's inbound call to flow cleanly from greeting to a person or a voicemail, so that no inbound call is ever dropped or lost.*

This ties 3.15–3.18 together into the chronology a real inbound call takes.

1. **Call arrives** at a Twilio number → Twilio hits our **inbound webhook** (the number's Voice URL). We look up the number's config (3.15).
2. **Business-hours check.** Closed → play the closed greeting → **voicemail** (step 5) or a forward. Open → continue.
3. **Recording announcement** (if recording on) and **greeting** play (`<Say>`/`<Play>`).
4. **Action runs:**
   - **Ring a person/group** → the **router** (3.17) picks the target; TwiML `<Dial>`s it with `answerOnBridge`. On the rep's side this is the normal **doc 2.1 screen-pop** — caller's name, company, deal, and history are already on screen when they answer, plus the **transfer** controls (doc 3a 3.13) and **"People at this account"** (doc 3a/doc 3.4b) if they want to hand off.
   - **Menu** → `<Gather>` the choice (3.16), then route per the chosen option.
   - **Forward out** → `<Dial><Number>` with whisper.
5. **No answer / all unavailable / caller chose voicemail** → play the voicemail greeting → **`<Record>`** (with `transcribe`, `playBeep`, `maxLength`, `recordingStatusCallback`). The recording lands in the **voicemail inbox** (doc 2), is **transcribed** (reuse doc 3a Journey 3.5a / Deepgram), **attached to the matched record's timeline** (doc 5 matcher), and **notifies** the owner (job E3). A missed inbound call itself logs as a `Call` activity (disposition = missed/voicemail) so it shows on the timeline and can feed deal-risk (doc 9) and the AI event engine (doc 7b, `call.missed`).
6. **In-call transfer.** At any point after answer, the rep can **warm/cold transfer** the live inbound call to another rep or an external number — exactly doc 3a Journey 3.13 (the Conference-based warm-transfer pattern), no new mechanism.

**Edge cases (broken out):**
- **Caller hangs up mid-menu / mid-ring** → the `Call` logs as missed with the furthest state reached; no orphan voicemail.
- **Two reps grab a simultaneous ring** → Twilio bridges the first; the loser's leg ends cleanly (their pop closes).
- **Caller is an existing open deal but owner is on another call** → router falls to team/group, and the pop still shows full deal context so whoever answers is informed.

- **Benchmark (beat this):** Aircall — call routing with Smartflows: FAQs [how it works: the runtime path] — https://support.aircall.io/hc/en-gb/articles/10375552874141-Call-Routing-with-Smartflows-FAQs ; Aircall — managing callback requests — https://support.aircall.io/en-gb/articles/10375395488541-Managing-callback-requests ; Gong-style logged missed call on the timeline — doc 5 matcher
- **Build docs:** Twilio `<Record>` (transcribe, playBeep, recordingStatusCallback) — https://www.twilio.com/docs/voice/twiml/record ; warm transfer via `<Conference>` — https://www.twilio.com/docs/taskrouter/contact-center-blueprint/call-control-concepts ; screen-pop = doc 2 Journey 2.1; vm transcription = doc 3a 3.5a.

---

# B. Outbound: navigate the callee's phone tree

## Journey 3.20 — Punch through a callee's IVR / dial-by-name (outbound assist)

*As a rep, I want the dialer to get me past the prospect's "press 1 for…" maze and gatekeeper menus, so that I spend my time talking to people, not pressing buttons.*

This is the outbound counterpart, graduating the backlog's "AI phone-tree navigation" + "dial-by-name." It's built **quality-first** and layered so we can ship the safe parts first.

1. **Answer classification (the foundation).** Every outbound call runs Twilio **Answering Machine Detection** (`MachineDetection`), preferably **async** (`AsyncAmd=true`, result at `AsyncAmdStatusCallback`) so the call isn't delayed. `AnsweredBy` tells us **human / machine / fax / IVR-ish / unknown**:
   - **human** → bridge the rep instantly (the connect the dialer already does, doc 2/3.4).
   - **machine (voicemail)** → offer voicemail-drop (doc 3a 3.6) — `DetectMessageEnd` waits for the beep.
   - **a menu/dial-tree or an operator** → the navigation assist below.
2. **Known tree — pre-programmed digits.** When we've stored the path for a number/company ("press 2, then dial ext 415"), we send it automatically: TwiML `<Number sendDigits="wwww2wwww415">` at dial time, or `<Play digits="…">` on the live leg (`w` = 0.5s pause, `W` = 1s, to wait out the prompt). The rep is bridged once a human is reached.
3. **Unknown tree — listen, then decide.** For a menu we haven't seen: `<Gather input="speech" hints="press one for sales, dial by name, …" speechModel="deepgram_nova-2">` transcribes the prompt; a **cheap, fast model decides which option matches the rep's goal** and we `<Play digits>` it. **Model: Claude Haiku 4.5** (`claude-haiku-4-5`) — this is short, structured, latency-sensitive ("given this menu text and the goal 'reach a human in sales', which key?"), so a small model is right; backend-selectable (doc 13). A **keyword/rules pass runs first** (match "sales"/"representative"/"operator"/"0") and the model is the fallback, to keep cost near-zero. Low confidence → **hand control to the rep** with the transcript on screen, never guess into a wrong branch.
4. **Dial-by-name.** When an operator/IVR asks for a name or extension, we use the stored extension (known tree) or surface a **"say the name"** prompt to the rep. We do **not** fake a synthesized voice saying a person's name in v1 — the rep speaks; the assist is the detection + digit-pressing, which is the tedious part.
5. **Guardrails (quality-first — this is where these features go wrong).** Never trap a live human in an automated loop: the moment `AnsweredBy=human` or the classifier is unsure, **the rep is in control**. A visible **"IVR navigation" chip** on the call screen shows what the assist is doing and a one-tap **Take over**. Digit-pressing is rate-limited and bounded (max N presses) so we can't machine-gun a phone tree. We log the navigation path so a wrong turn is inspectable and the "known tree" for that number improves over time.
6. **Parallel dialing note.** The competitors that market this hardest (Orum, Nooks, Salesfinity) pair it with **parallel dialing** (many lines at once, connect the rep to whoever a human answers first). Parallel dial stays **[LATER]** and quality-gated in the [backlog](14-backlog.md) — the navigation assist here is valuable on our single-line dialer today and is a prerequisite for doing parallel well later.

- **Benchmark (beat this):** Orum — dial-tree FAQs [visual + how it works: the "dial tree — no directory" / "name not found" outcomes and the 5-step manual programming screen] — https://support.orum.com/en-US/orum/article/ART-361-dial-tree-faqs ; Orum — dialer basics — https://support.orum.com/en-US/orum/article/17quk_5h-dialer-basics ; Nooks — remembering dial trees (learn the path once, replay it after) [how it works] — https://support.nooks.ai/articles/3362579510-remembering-dial-trees (match their *outcome* — reps skip the maze — on our single line first)
- **Build docs:** Twilio AMD (`MachineDetection`, `AsyncAmd`, `AnsweredBy`) — https://www.twilio.com/docs/voice/answering-machine-detection ; send DTMF `<Play digits>` — https://www.twilio.com/docs/voice/twiml/play ; `<Number sendDigits>` — https://www.twilio.com/docs/voice/twiml/number ; read a menu via `<Gather input="speech">` — https://www.twilio.com/docs/voice/twiml/gather ; classifier model = doc 13 routing.

---

## Background jobs (this doc)

Most inbound flow is **synchronous TwiML** answered in the webhook (real-time — a caller is on the line), not queued. The queued/durable pieces:

- **K1 — Inbound voicemail post-processing.** **Trigger:** Twilio `recordingStatusCallback` after an inbound `<Record>` (3.19 step 5). **Steps:** store the recording (S3/MinIO), transcribe (reuse doc 3a 3.5a / Deepgram), run the doc-5 matcher to attach to a record, write the `Call`/voicemail activity, notify the owner (E3). **pg-boss:** queue `inbound-voicemail`, `retryLimit: 3`, verify the Twilio signature, **idempotent per `RecordingSid`**.
- **K2 — Inbound call logging.** **Trigger:** Twilio call `statusCallback` on completion. **Steps:** upsert the `Call` with direction=inbound, the resolved route/owner, disposition (answered / missed / voicemail / forwarded), and duration; attach to the matched record. **pg-boss:** queue `inbound-log`, `retryLimit: 3`, idempotent per `CallSid`.
- **Learned-tree update** (from 3.20) is a small write on call end, not its own queue.

*The inbound webhook itself follows doc 12's rule: verify signature, respond fast (TwiML), push heavy work (transcription, matching) to K1/K2.*

---

## Decisions for you (inbound & IVR)

**1. Owner-routing as the headline. Decided (my pick): route a matched inbound caller to their account owner first, then team/group, then voicemail** (Journey 3.17). It's the CRM-native thing generic PBXs can't do and it's what a prospect expects. *Alternative — always a round-robin queue — is simpler but throws away the relationship; rejected as the default (still available as a group fallback).*

**2. IVR depth. Decided: a simple 1–2 level menu builder, with a warning on deeper trees.** Long IVR mazes are the top caller complaint; we make the easy case easy and gently discourage the maze. TaskRouter skill-based queues stay **[LATER]** (Journey 3.18 build-docs note) — a ring group covers 2–30 reps fine.

**3. Outbound navigation aggressiveness. Decided: quality-first, layered — AMD classify → known-tree auto-digits → unknown-tree rules-then-Haiku → hand to rep on any doubt** (Journey 3.20). We never trap a human; the rep is one tap from control. Parallel dialing stays deferred.

**4. Forwarding vs everything-in-app. Decided: support "forward out" for the real cases** (answering service, a cell not in the app) with a whisper so it's recognizable — but owner-routing to an in-app softphone is the preferred path (full context + logging).

---

## Data model (Prisma) — additions in this doc

Extends the doc-3a dialer schema. Reuses `Call`, `ContactPhone`, `Recording`, presence, and the doc-5 matcher.

```prisma
model InboundNumberConfig {   // NEW — per-number inbound behavior (Journey 3.15)
  id            String  @id @default(cuid())
  workspaceId   String
  numberId      String  @unique   // -> the workspace Twilio number (doc 3a)
  action        String            // ring_person | ring_group | ivr_menu | forward_out
  targetId      String?           // userId | ringGroupId | ivrMenuId | external E.164
  greetingKind  String?           // say | play | none
  greetingValue String?           // TTS text or recording storage key
  recordCalls   Boolean @default(false)
  businessHoursId String?         // -> BusinessHours (null = always open)
}

model BusinessHours {         // NEW — weekly schedule + holidays (Journey 3.15)
  id          String @id @default(cuid())
  workspaceId String
  timezone    String
  weeklyJson  Json            // [{ day, openMin, closeMin }] in workspace tz
  holidaysJson Json           // [{ date, closed | hours }]
  overrideState String?       // "open" | "closed" | null (one-off manual override)
}

model IvrMenu {              // NEW — auto-attendant (Journey 3.16)
  id           String @id @default(cuid())
  workspaceId  String
  promptKind   String         // say | play
  promptValue  String
  inputMode    String @default("dtmf") // dtmf | dtmf_speech
  retryLimit   Int    @default(1)
  defaultDest  Json           // {type, targetId} catch-all (never a dead end)
  optionsJson  Json           // [{ key, label, destType, destId }]  destType: person|group|menu|forward|voicemail
}

model RingGroup {            // NEW — Journey 3.18
  id          String @id @default(cuid())
  workspaceId String
  name        String
  strategy    String          // simultaneous | round_robin | sequential
  memberIds   String[]        // ordered (order matters for sequential)
  ringSeconds Int    @default(20)
  fallbackJson Json           // {type, targetId} when no one answers
  rrCursor    Int    @default(0) // round-robin position
}

model RoutingRule {          // NEW — the routing brain (Journey 3.17)
  id          String @id @default(cuid())
  workspaceId String
  position    Int             // evaluation order, first match wins
  kind        String          // account_owner | sticky_last_rep | ring_group | voicemail
  targetId    String?         // for ring_group
  isEnabled   Boolean @default(true)
}

model PhoneTreePath {        // NEW — learned/known outbound IVR path (Journey 3.20)
  id          String @id @default(cuid())
  workspaceId String
  matchKind   String          // number | company_domain
  matchValue  String          // the E.164 or domain this tree belongs to
  digits      String          // e.g. "wwww2wwww415"  (w/W pauses)
  note        String?         // "press 2 for sales, ext 415"
  source      String          // manual | learned
}
```

`Call` gains inbound-routing context:

```prisma
model Call {
  // ...existing (doc 1/2/3/3a), plus:
  routeVia     String?   // added: "owner" | "sticky" | "group:{id}" | "menu:{key}" | "forward" (inbound)
  ringGroupId  String?   // added: which group handled it, if any
}
```

---

## Technology choices (this doc)

Builds on the doc-2/3a telephony stack (Twilio, Deepgram). New here:

- **Inbound = real-time TwiML in the webhook, heavy work queued.** The caller is live, so menu/route/answer are answered synchronously with TwiML; transcription, matching, and logging go to pg-boss (K1/K2) per doc 12's webhook rule (verify signature, respond fast, process async).
- **Business hours in our code, not a Twilio feature.** No verb exists; we branch on the schedule in the webhook. One schedule object per number, workspace-tz aware (reuses the doc-3b timezone handling).
- **Routing reuses the doc-2 caller match + doc-11 ownership + doc-3a presence.** The router is glue over things we already have, not a new matching engine — the same discipline as the shared doc-5 matcher.
- **Outbound navigation: Twilio AMD + DTMF verbs, with a cheap model only on unknown trees.** Rules-first, **Claude Haiku 4.5** fallback for reading an unfamiliar menu, Deepgram `nova-2` for the speech capture in `<Gather>`. Quality-gated: any doubt hands the rep control.
- **Queues/TaskRouter deferred.** `<Enqueue>` + TaskRouter (skill/priority queues, hold music, wait-time) is the scale-up path for a real call center; ring groups cover 2–30 reps now. Flagged as the drop-in later.

---

## Technical decisions, trade-offs & edge cases

- **Never dead air.** Every path — no answer, all-unavailable, invalid menu key, closed hours — ends in voicemail or a fallback, never a dropped or endlessly-ringing call. This is the defensive rule that shapes each journey.
- **Inbound recording obeys consent (doc 2.3).** All-party-consent posture as default; the announced-recording greeting is added when recording is on. Consent state is logged with the recording.
- **Owner-routing degrades gracefully.** Owner unavailable → team → group → voicemail, and the pop always carries full deal context so whoever answers is informed. A wrong-person answer is never a context-less answer.
- **Idempotent webhooks.** Inbound status/recording callbacks can fire twice; K1/K2 dedupe on `CallSid`/`RecordingSid`, and the TwiML webhook is safe to re-request (it reads config, doesn't mutate).
- **Outbound navigation is assist, not autopilot.** The rep is always one tap from taking over; classification doubt hands control back; digit-pressing is bounded and logged. We optimize for *never annoying a human*, accepting that we'll sometimes hand a tree back to the rep — the opposite failure (machine-gunning a person's phone) is the one that damages the brand.
- **Missed inbound calls are first-class activities.** A missed/voicemail inbound logs a `Call` on the timeline, feeding deal-risk (doc 9) and the AI event engine (doc 7b, `call.missed`/`call.received`) exactly like an outbound call — so an inbound callback isn't invisible to the rest of the app.
