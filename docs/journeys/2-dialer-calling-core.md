# Doc 2 — Dialer: Calling Core

Same format as P0. This covers everything around handling **one** phone call, after P0's basic outbound works.

**Phase note:** phase tags here are a draft. We re-sequence together later. For now they only show rough "sooner vs later."

**Covers (from your list):** inbound calls, DTMF, recording, transcription, consent by state, dispositions, call history, call record, AI call summary, click-to-call, call screen, battlecards, voicemail greeting, voicemail inbox, outbound caller ID.

Under each journey: **Benchmark (beat this)** = the product to match, with a link where you can see how it works. **Build docs** = the page that tells the coding agent how to build it.

> **Split note (manual vs AI).** The **AI** parts of one call — the AI-recommended disposition, its eval, the AI call summary, and the summary/extraction template config — now live in **doc 2a (Dialer: Call AI)**. This doc keeps the **manual / phone** journeys. **Journey numbers are unchanged** across the split (e.g. Journey 2.7 is the template editor, physically in doc 2a; the AI-disposition journeys are 2.4c / 2.4d), so every existing cross-reference still resolves.

---

## A note on terminology ("connected" the phone state vs "reached DM" the disposition)

We were sloppy with the word "connect." Three precise terms, used consistently across this doc and doc 2a:

- **Connected** — the far end's line opened; **a person *or* a machine** (an answering machine connects too). This is a **phone-state event**, reported by Twilio. *(We considered "answered" but dropped it — "answered" sounds like a human picked up, and a machine connects too.)*
- **Live** — the call is in progress and both sides can talk.
- **Reached DM (a disposition)** — the rep reached the actual **decision maker** ("DM"). This is an **outcome the rep records by hand**, not a phone event. It is one option in the disposition bar (Journey 2.4).

So the phone event is **"the call connected"**; the human outcome "I got the actual decision maker" is the separate disposition **"Reached DM."**

---

## New surfaces this adds

- **Dialer popover gains tabs:** Info, Notes, Transcript (live during the call).
- **Disposition bar:** appears as soon as the call starts (dialing), so the rep can log an outcome the instant it is known. Below it, a **next-step row** for what should happen next (Journey 2.4 (step 4)).
- **Calls page** in the navbar: the call history list.
- **Call record page:** one call, with its recording, transcript, summary, and fields.
- **Voicemail** area under Calls: greeting setup + inbox.
- **Settings additions:** Recording, Dispositions, Next steps, Voicemail greeting, Caller ID.

---

## Journey 2.1 — Receive an inbound call

*As a rep, I want to receive an inbound call with the caller's context on screen, so that I pick up already knowing who it is.*

1. Someone calls the user's number. The dialer popover pops open and rings (in-browser sound + a browser/desktop notification).
2. The user sees the caller's number and caller-ID name.
3. **Screen-pop the caller (your ask).** We look up the inbound number against the CRM (by `ContactPhone`, doc 3.14c) and, if it matches, the ringing popover **shows who it is + their account** — name, company, persona, last touch — right there, before he answers. **He can click through to the full person/account record in one click** while it's still ringing, so he picks up already knowing the context. **No match → the popover just shows "Unknown caller" and the raw number.** We do **not** offer "create person" from the ring — creating a contact blind, before he even knows who it is, is wrong. Adding or linking a person happens *after* he answers, from the live call panel or the call record.
4. He clicks **Accept** (or **Reject**).
5. On accept, the call goes **live** with the same in-call controls as an outbound call (timer, mute, hang up), and the record is open beside it (the core loop, Journey 2.5).
6. On reject (or no answer), the caller is sent to voicemail (Journey 2.11's greeting plays).
7. **Answer from your phone instead.** The inbound call can also ring **your cell** so you can answer away from the computer — see Journey 2.15.

> **Note — notification settings are their own journey.** *How* the ring and pop happen (in-browser sound, browser notification, OS/desktop notification, do-not-disturb) is a separate concern the user must control. That configuration lives in **Journey 2.14 — Configure call notifications** later in this doc. Journey 2.1 just assumes the user's chosen notifications fire.

- **Benchmark (beat this):** Dialpad — receive a call — https://help.dialpad.com/docs/receive-a-call
- **Build docs:** Twilio.Device — https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice

## Journey 2.2 — Press digits during a call (DTMF)

*As a rep, I want to press digits during a call, so that I can move through automated phone menus.*

**DTMF** = "Dual-Tone Multi-Frequency" — the touch-tones a phone sends when you press keypad keys. It is how you move through automated phone menus ("press 1 for sales") while already on a call.

1. While on a call, the user clicks the keypad icon in the dialer.
2. He presses digits (e.g. to move through a phone menu).
3. Each press sends a tone to the other side, and he hears the tone.

- **Benchmark (beat this):** Aircall — send digits on a call — https://support.aircall.io/en-gb/articles/21534383206685
- **Build docs:** Twilio.Call (sendDigits) — https://www.twilio.com/docs/voice/sdks/javascript/twiliocall

## Journey 2.3 — Record and transcribe a call (with consent)

*As a rep, I want my calls recorded and transcribed within consent law, so that I keep an accurate record without breaking the rules.*

**Defaults:** recording is **on by default** for a new workspace, and **"Auto-disable in two-party-consent states" is on by default** too. Either can be turned off in **Settings → Recording**. *(Both seed with the workspace — same seed/backfill pattern as default dispositions; doc 4.)*

1. **Entry / config.** The rep opens **Settings → Recording**. Recording is already **on**; "Auto-disable in two-party-consent states" is already **on**. He can toggle either off.
2. **He starts a call — and before any audio is captured, the server decides record-or-not for this call.** This is **not a pgboss background job.** It is a **synchronous step in the call-setup path on the server** (when we build the outbound call / TwiML), because recording has to be configured on the Twilio call *before* media starts. The logic:
   1. Take the dialed number (E.164) and read its **area code (NPA)**.
   2. Look the NPA up in a **static NPA → US-state table** we ship (in-process, no network call).
   3. Check that state against a **static "two-party-consent states" list.**
   4. If the workspace setting is on **and** the state is two-party → set **record = off** for this call; otherwise **record = on**.
   5. **Store the decision on the call** (`Call.recordingConsent = allowed | blocked-2party | unknown`) so the record shows why.
   All of this runs server-side in milliseconds; the browser only receives "recording on/off" to draw the indicator.
3. **The recording indicator is a single small dot in the call bar, and the reason lives in a tooltip on it — not as inline text on the screen:**
   - **Recording** → a **red dot**. Tooltip on hover: "Recording this call."
   - **Not recording for consent** → a **gray dot** (or no dot). Tooltip on hover: "Based on the area code, this number looks like a two-party-consent state. Recording is off."
   Keeping the copy in a tooltip stops the consent explanation from cluttering the call screen: the rep sees a calm dot and only hovers if he wants the reason.
4. Transcription runs **live** during the call (**Background job C2**) so the AI can suggest a disposition and extract fields as he talks. On hang up, **Background job C1** uploads the audio, and a high-accuracy pass (**Background job C2b**) re-transcribes with speaker labels for the summary/extraction (doc 2a).

- **Benchmark (beat this):** Gong — call recording — https://help.gong.io/docs/understanding-call-recording ; consent greeting: Dialpad — https://help.dialpad.com/docs/two-party-consent-greeting
- **Build docs:** Twilio recording settings — https://www.twilio.com/docs/voice/recording-settings ; US recording-law reference — https://en.wikipedia.org/wiki/Telephone_call_recording_laws

## Journey 2.4 — Disposition a call by hand

*As a rep, I want to log what happened on a call by hand in near-zero clicks, so that I can move to the next call fast.*

*(The **AI** version — where the app pre-picks the likely disposition for you — is **Journey 2.4c in doc 2a**. This journey is the by-hand path and the shared bar mechanics.)*

The disposition loop repeats hundreds of times a day, so it is built for **near-zero clicks**.

1. **Entry.** A **disposition bar** appears as soon as the call starts (dialing) and stays through the live call and the after-call screen until he picks one. He can disposition the instant the outcome is known — mid-call or after hang up.
2. **The bar UI** (chosen after comparing Dialpad, Apollo, Salesloft, Outreach, Orum, Nooks, Aircall, Gong):
   - A fixed **horizontal button bar** of the 5–7 most-used dispositions, large targets, in the same spot every call so muscle memory forms. Not a dropdown — a dropdown costs an extra open-scan-click on every single call.
   - **Number-key shortcuts:** each button shows a numeric badge (1–7); pressing the digit dispositions and auto-advances. Goal: 1 keystroke, 0 clicks.
   - **Color + icon system:** green = positive (**Reached DM** = reached the decision maker, Interested, Meeting booked); amber = neutral/retry (No answer, Left voicemail); red/gray = negative/dead (Not interested, Bad number, Do-not-call). Each carries a small glyph (phone, voicemail, calendar, X) for instant pre-read. *(Callback is a next step, not a disposition — step 4.)*
   - **Custom + rare dispositions, no clutter:** only the top few sit on the bar; a trailing **"More ▾" (key `0`)** opens a searchable command-palette overlay of every custom/rare disposition — type to filter, Enter to pick. The admin pins which ones show on the bar (Journey 2.4a).
   - **AI can pre-highlight one (optional):** if the AI recommendation is turned on, the likely disposition is highlighted and bound to **Enter**. That flow — and its granular human-confirm steps — is **Journey 2.4c (doc 2a)**. With it off, the rep just picks by key or click.
   - **Notes never block:** dispositioning fires immediately; the note field (Journey 2.5) is available but never gates advancing to the next call.
3. **Dead calls auto-disposition (deterministic, not AI).** When the call never became a real conversation — **no-answer, busy, failed, or answering-machine detected (AMD)** — the outcome comes straight from **Twilio's call status + AMD**, not from any model. Because it is a certain phone event with no human to judge, we **auto-apply** the matching disposition (no keypress) and move on, so he only hand-dispositions real conversations. He can still change it later from the call record. *(This is deterministic automation, so it needs no eval — unlike the AI recommendation, Journey 2.4c. AMD accuracy is Twilio's config, not our model.)*
4. **Disposition vs next step — two different questions, two different rows (your point).** We were conflating them:
   - **Disposition = what happened** (the outcome of *this* call): Reached DM, Interested, Not interested, No answer, Left voicemail, Bad number, Do-not-call.
   - **Next step = what should happen next**: Schedule a callback, Create a task, Add to a sequence, Send a follow-up. A **callback is a next step, not a disposition** — scheduling it says nothing about what happened on the call.
   - **UI:** the **disposition bar** is the primary row (number-keys, one pick). A thinner **next-step row** sits just under it. After he dispositions, the next-step row is where he (optionally) sets what happens next: picking **"Schedule callback"** opens a small date + time picker, re-queues the person at that time, and creates a task/reminder. Some dispositions **pre-suggest** a next step (e.g. "No answer" → suggests Callback; "Interested" → suggests Schedule follow-up), but next steps **never block Save & Next**.
5. **One disposition per call, many next steps (your multi-select question).** A call has exactly **one** disposition — this keeps reporting clean and preserves the single-keypress fast path — so we do **not** allow multi-select on the disposition itself. It can have **zero or more** next steps. If a rep feels two dispositions apply, it is almost always one disposition + one next step, which the two-row model already covers.
6. The chosen disposition and any next steps save to the call record. Custom dispositions are configured in **Settings → Dispositions** (Journey 2.4a); next-step types in **Settings → Next steps** (Journey 2.4b).

**Decision — too many dispositions to fit one row (your question).** Options: (a) a **"More ▾" command-palette** for the overflow; (b) **spill to a second line**; (c) **shrink the buttons**; (d) fully configurable. **Pick: (a) "More ▾" + a capped pinned count.** The pinned buttons stay one row at full size in a fixed spot — big hit targets + muscle memory are the whole point. Everything else lives behind **"More ▾" (key `0`)**, the searchable palette from step 2. The admin chooses which pin (Journey 2.4a) up to a cap that always fits one row (start: **7**); beyond that, extras auto-move to "More." We reject spill-to-second-line and shrink-buttons because both move buttons around and kill muscle memory.

- **Primary benchmark — function (beat this):** Nooks — single-click / auto disposition — https://www.nooks.ai/ai-dialing-assistant ; Nooks — changing dispositions on a logged call [how it works: the disposition list + the re-disposition path] — https://support.nooks.ai/articles/3013057164-changing-dispositions-on-a-logged-call . This is the one to beat for near-zero-click dispositioning.
- **Secondary — look & config:** Salesloft — disposition + sentiment — https://support.salesloft.com/hc/en-us/articles/360025661192-Manage-Dispositions-and-Sentiments (the look of the bar) ; Outreach — dispositions + auto-map — https://support.outreach.io/hc/en-us/articles/217567348-Managing-Call-Dispositions-and-Call-Purposes (the config model).
- **Build docs:** Twilio Call resource (status/labels) — https://www.twilio.com/docs/voice/api/call-resource ; Twilio — Answering Machine Detection (AMD) — https://www.twilio.com/docs/voice/answering-machine-detection

> **Moved to doc 2a:** the **AI-recommended disposition** (rep-facing) is now **Journey 2.4c**, and its **eval fixtures & pipeline** (engineer-facing) is now **Journey 2.4d**. Both live in doc 2a so the manual and AI paths are separated.

## Journey 2.4a — Configure the disposition bar

*As an admin, I want to configure the disposition bar, so that reps see the right outcomes in the right order.*

The admin controls which dispositions exist, how they look, and which sit on the bar. Because the bar is the most-used control in the app, config is a **live WYSIWYG editor** (a real preview of the bar), not a plain form.

1. He opens **Settings → Dispositions**.
2. At the top he sees a **live preview of the disposition bar exactly as reps will see it**; the full list of dispositions sits below.
3. **Per disposition he can set:**
   - **Label** (shown text) and **value** (the stable key used in reporting/automations — editing the label never breaks reports).
   - **Color** — from the semantic set (green / amber / red / gray), so meaning stays consistent.
   - **Icon** — a glyph (phone, voicemail, calendar, X, …).
   - **Category** — positive / neutral / negative (drives reporting).
   - **Pinned to bar, or in "More"** — a toggle.
4. **Order by drag-and-drop.** He drags pinned dispositions left-to-right; the **number-key badge (1–7) follows the order automatically**. The preview updates live as he drags.
5. **Overflow is enforced in the editor** (see the overflow decision above): pinning more than fit one row at full size makes the editor warn and spill the extras into "More ▾" — it never shrinks buttons or wraps to a second row.
6. He clicks **Save**; reps get the new bar on their next call.

- **Benchmark — function (match this):** Outreach — managing call dispositions — https://support.outreach.io/hc/en-us/articles/217567348-Managing-Call-Dispositions-and-Call-Purposes
- **Build docs:** the `Disposition` model already carries label, color, icon, category, isPinned, sortOrder; we add a `value` key (below). Drag-order writes `sortOrder`.

## Journey 2.4b — Configure next-step types

*As an admin, I want to configure next-step types, so that reps can set the right follow-up in one keypress.*

Same editor idea, for the **next-step row** (Journey 2.4 (step 4)).

1. He opens **Settings → Next steps**.
2. He sees a **live preview of the next-step row**, with the list of next-step types below.
3. **Per next-step type he can set:** label + value, icon, color, whether it needs a **date/time** (like Callback) or opens a **task**, and whether it is pinned to the row or in an overflow menu.
4. **Suggestion rules:** he can map "when disposition = X, pre-suggest next step Y" (e.g. No answer → Callback), so the right next step is one keypress.
5. **Order by drag-and-drop**, same as the disposition bar; **Save** publishes.

- **Benchmark — function (match this):** Salesloft — complete dialer guide (next steps / cadences) — https://support.salesloft.com/hc/en-us/articles/115005905266-Complete-Dialer-Guide
- **Build docs:** new `NextStepType` and `CallNextStep` models (below); suggestion rules stored as a `{ dispositionValue → nextStepValue }` map.

## Journey 2.5 — Work the call screen: the core loop

*As a rep, I want notes, disposition, and next step on one screen, so that I never mode-switch mid-call.*

This is the loop the rep runs hundreds of times a day — call → take notes → disposition → next. It must be the fastest path possible. The design below was chosen after comparing Orum, Salesloft, Apollo, Nooks, and Dialpad and reading rep reviews of what feels fast vs. frustrating.

**L1 — Info shows immediately.** The moment he starts dialing — **not** after the other side answers, because we already know the number — the **Info** tab shows the number and any details we already have (name, company, timezone, once CRM exists). The old rule (show the number only after the call was "connected") was wrong and is fixed.

**L2 — Notes + keypad + disposition on one screen (no mode-switching).** Three layouts we considered:

- **A. Persistent side panel (our pick).** The notes box is always visible, the disposition bar is a sticky footer, and the keypad hides behind an icon that opens as an overlay only when DTMF is needed. One screen, nothing to switch. Matches Orum / Salesloft.
- **B. Stacked single column.** Call bar on top, big notes in the middle, disposition + "Save & Next" in a sticky footer. Works on any width, but pushes account context off-screen.
- **C. Tabbed (Notes / Keypad / Disposition).** Each gets full space, but tab-switching is the #1 rep complaint — you cannot take notes while dispositioning. Rejected as the primary loop.

**We pick A**, borrowing B's sticky "disposition + Save & Next" footer. Why: reviews agree the killer is mouse travel and mode-switches between "log" and "next." A docked panel keeps notes, disposition, and the prospect card all visible at once; the keypad is on-demand because DTMF is a minority of calls and should not eat the space notes need. Details:

- **Notes:** auto-focus the note field the instant the call goes live; notes auto-save as he types; advancing to the next call never clears the screen.
- **Keyboard-first, and where each key goes (your edge case):** number keys pick dispositions (Journey 2.4) and one key = **Save & Next** — but **only when no text field is focused**. **If the notes field is focused and he types a digit, the digit goes into the note text and does *not* fire the disposition shortcut** (same for any text input). So a rep mid-note never dispositions by accident; to use the number-key shortcuts he clicks out of notes first (or presses Esc/Tab to blur it). The **mouse always works regardless of focus.**
- **Keypad interaction:** the keypad icon sits in the call bar; opening it overlays the note area, then closes back to notes. Tones send as in Journey 2.2.
- **Disposition interaction:** the disposition footer is always present; picking one (or an auto-disposition) plus Save & Next moves to the next call.

**L3 — Past notes and activity.** He sees prior notes and the activity feed for this number/person. Two options:

- **A. Inline in the Info tab, expandable (our pick).** Past activity expands in place (Orum's pattern), so the next call loads instantly and he never navigates away mid-loop.
- **B. A separate history tab.** Cleaner, but adds a mode-switch. Rejected for the same reason as tabs above.

*(Until CRM exists, this shows whatever we have stored.)*

> **This refines the P0 dialer decision.** P0 chose a small bottom-right popover. The core loop needs room for notes + disposition + prospect card + live transcript, which a small corner popover cannot hold. So **during an active call the popover expands into a docked right-side call panel**, then collapses back to the small corner popover when idle. The "one screen" thesis still holds — it never navigates away.

- **Primary benchmark — the fast core loop (beat this):** Orum — AI Dialer redesign [visual: the redesigned single-screen dialer] — https://www.orum.com/product-updates/inside-the-new-design-of-orums-ai-dialer ; Aircall — Workspace: in-call view and actions [how it works: every control available while the call is live] — https://support.aircall.io/hc/en-gb/articles/21534383206685-Aircall-Workspace-In-Call-View-and-Actions ; Nooks — custom fields for note-taking in the dialer [how it works: typed notes taken without leaving the call] — https://support.nooks.ai/articles/8334690375-leverage-custom-fields-to-supercharge-note-taking-in-the-nooks-dialer . Beat these for notes + disposition + prospect card on one no-mode-switch screen.
- **Secondary — dialer completeness:** Salesloft — complete dialer guide — https://support.salesloft.com/hc/en-us/articles/115005905266-Complete-Dialer-Guide
- **Build docs:** Twilio.Call — https://www.twilio.com/docs/voice/sdks/javascript/twiliocall

> **Journeys 2.6 and 2.7 moved to doc 2a (Dialer: Call AI).** The **AI call summary** (Journey 2.6) and the **AI summary/extraction template config** (Journey 2.7) are now in doc 2a — their journey numbers are unchanged, so links from docs 5, 6, 7, 7b to "Journey 2.7" still resolve. Background job **C3** and the data models (`CallSummary`, `SummaryTemplate`, `ExtractionField`, `CallExtractedValue`) remain in this doc's schema; doc 2a references them.

## Journey 2.8 — Review call history

*As a rep, I want to browse my call history, so that I can find and reopen any past call.*

1. The user clicks **Calls** in the navbar.
2. He sees a list: direction (in/out), connected or not, time and date, duration, disposition.
3. He clicks a row to open the call record.

- **Benchmark (beat this):** Dialpad — conversation history — https://help.dialpad.com/docs/using-conversation-history
- **Build docs:** Twilio — retrieve call logs — https://www.twilio.com/docs/voice/tutorials/how-to-retrieve-call-logs

## Journey 2.9 — Open a call record

*As a rep, I want a single call's full record in one place, so that I can review the whole call without hunting.*

From the Calls list he opens one call. Layout chosen after comparing Attio, Gong, Dialpad, Avoma, and Fireflies. Three options we considered:

- **A. Two-column — transcript left, summary right.** Both high-value artifacts visible at once (Gong / Attio model). Best on wide screens.
- **B. Tabbed body (Summary | Transcript | Notes).** Clean and mobile-friendly, but hides the transcript while reading the summary.
- **C. Single scroll.** Simplest, but the transcript ends up far down the page.

**We pick a hybrid of A:** a sticky header + two columns, with a small tab toggle on the right column.

1. **Top (sticky):** a compact **audio player** with click-to-seek, plus a metadata strip — date/time, duration, direction, to/from number, owner, linked contact/deal. The player stays pinned so he can scrub while reading anything below. A **participants** chip row sits just under the player.
2. **Left column (~60%):** the **transcript** — speaker-labeled, timestamped, searchable, click-to-seek. This is the source of truth.
3. **Right column (~40%), tabbed:** **Summary** (default) | **Notes**. The **disposition** is an inline editable field pinned at the top of this column, above the fold, because it is the action that closes the loop.
4. He can edit disposition, notes, and any extracted field here; his edits win over the AI.
5. On mobile it degrades to a single scroll (option C) with the same Summary / Transcript / Notes toggle.

**Resizable split (your question — worth it, kept simple).** The two columns are separated by a **draggable divider**; the rep can widen the transcript or the summary. We **persist the width per user** (a small UI-prefs value) with sensible **min/max** so a column can't vanish, and **double-clicking the divider resets** to the 60/40 default. That is the whole feature — **one splitter**, not full drag-and-drop column reordering (that belongs to the CRM table views, doc 4b) — so it adds real value without the messy edge cases of a general column system. On mobile (single scroll) the splitter does not apply.

- **Primary benchmark — call-page layout (beat this):** Gong — intro to the call page — https://help.gong.io/docs/intro-to-the-call-page .
- **Secondary — recording UX:** Attio — view and manage call recordings — https://attio.com/help/reference/productivity-collaborating/call-intelligence/view-and-manage-call-recordings
- **Build docs:** Twilio Call resource — https://www.twilio.com/docs/voice/api/call-resource

## Journey 2.10 — Click to call

*As a rep, I want to click any number or name to start a call, so that I dial without retyping.*

1. Anywhere a phone number shows, the user clicks it → the dialer opens and starts calling.
2. Anywhere a person's name shows, he clicks it → a dropdown lists that person's numbers → he clicks a number to call.

- **Benchmark (beat this):** RingCentral — click-to-call — https://www.ringcentral.com/office/features/click-to-call/overview.html
- **Build docs:** MDN — the `<a href="tel:">` element — https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a

## Journey 2.11 — Set your voicemail greeting

*As a rep, I want to set my voicemail greeting, so that missed callers hear the right message.*

1. The user goes to Settings → Voicemail (or Calls → Voicemail).
2. He picks **Default greeting** or **Personal greeting**.
3. For personal: **before recording, a mini mic check runs** — the same green-room idea as P0 Journey 1.4, but lighter. He picks the input mic and watches the level meter move, so he never records a greeting on the wrong or dead mic. Then he **records** in-app (start, stop, trim, play) or **uploads** a file.
4. He confirms before it replaces the old greeting.
5. Now, when he misses a call, this greeting plays to the caller.

- **Benchmark (beat this):** Quo (OpenPhone) — voicemail setup — https://support.quo.com/core-concepts/administration/call-flows/voicemail
- **Build docs:** Twilio — `<Record>` TwiML — https://www.twilio.com/docs/voice/twiml/record

## Journey 2.12 — Listen to voicemail

*As a rep, I want a voicemail inbox with transcripts, so that I can triage messages fast.*

1. The user opens the **Voicemail** inbox.
2. He sees a list: caller, time, date, length, read/unread.
3. He clicks a message to play it, with a scrub bar.
4. He sees the message transcript (a post-call transcription pass, like **C2b**, made it).
5. Playing a message auto-marks it read; he can also mark read/unread or delete it.

- **Benchmark (beat this):** Dialpad — manage your voicemail — https://help.dialpad.com/docs/manage-your-voicemail
- **Build docs:** MDN — HTMLAudioElement (player/scrub) — https://developer.mozilla.org/en-US/docs/Web/API/HTMLAudioElement ; transcription: Deepgram — https://developers.deepgram.com/docs/pre-recorded-audio

## Journey 2.13 — Outbound number and caller-ID name

*As a rep, I want to choose my outbound number and caller-ID name, so that recipients see the right line.*

Calling all of this "Caller ID" was wrong. There are **three distinct choices**, set in **Settings → Outbound**:

1. **Outbound number** — which owned number places the call (the "from" number the recipient sees on their screen).
2. **Show caller-ID name? (on / off)** — whether the recipient's phone shows a *name* at all (CNAM). Some reps want just a number; some want their name or company shown.
3. **Caller-ID name text** — the actual name that shows when (2) is on (e.g. "Ryan @ Maincar"). Registering a CNAM name is a Twilio/carrier step and can take time to propagate.

On his next call, the chosen number places the call; if "show name" is on, the registered name shows too.

**Own several numbers, pick the primary outbound (your ask).** He can **buy multiple numbers** (doc 1's buy flow, repeated) and they all live in **Settings → Outbound → My numbers**. One is the **primary outbound** — the default "from" for new calls. Because switching is a moment-to-moment decision (a local-area number for this call, the main line for that one), the **primary toggle also lives in the dialer widget itself**: a small number-picker in the widget flips the outbound number for the next call without opening Settings. Any owned number can be outbound instantly (no verification needed — it's yours); a *non-Twilio* number can only be a verified caller ID, not a receiving line. US numbers used for outbound should be 10DLC/voice-registered to avoid spam-labeling (doc 3 number health).

*Why split: "which number," "show a name at all," and "what the name says" are independent. Bundling them under one "Caller ID" label hid two of the three decisions.*

- **Benchmark (beat this):** Dialpad — customize your caller ID — https://help.dialpad.com/docs/customize-your-caller-id ; Aircall — manage numbers
- **Build docs:** Twilio — `<Dial callerId>` TwiML — https://www.twilio.com/docs/voice/twiml/dial ; Twilio — CNAM / caller name — https://www.twilio.com/docs/voice/caller-id ; Twilio — outbound caller IDs — https://www.twilio.com/docs/voice/api/outgoing-caller-ids

## Journey 2.15 — Route an inbound call to my cell phone

*As a rep, I want inbound calls to reach my cell, so that I can answer away from the computer.*

The user isn't always at the computer. He wants inbound calls to his business number to reach his **cell**, while still knowing the call came **through the app**.

1. In **Settings → Inbound**, he turns on **"Also ring my cell"** and enters his mobile. He picks **simultaneous** (ring browser + cell together, first to answer wins) or **fallback** (ring the cell only if the browser doesn't pick up in N seconds).
2. **What he sees on his cell (your two asks, in priority order):**
   - **Priority 1 — "it's the app":** the forwarded call's caller ID is set to **his app/Twilio number**, so his phone shows the business line — he instantly knows it's a work call through the app, not a personal call.
   - **Priority 2 — who's calling:** because a phone can show **only one** caller ID, the real caller's number can't *also* be on the display — so we announce it with a **whisper**: when he answers, before the caller is connected, the app says *"Call from 415-555-1234 for your business line — press any key to accept."* He hears who it is and presses a key to take it. (This keypress also stops the call from going to his voicemail by accident.)
   - He also gets a **text and/or in-app screen-pop** with the caller's number + CRM record, so the full context is on his phone too.
3. On accept, it's a normal call; it still records/transcribes and logs to the CRM like any other (subject to consent, Journey 2.3).

*The one-caller-ID limit is a hard carrier constraint, not a choice — the whisper + screen-pop is how we deliver both facts.*

- **Benchmark (beat this):** Dialpad / Aircall — ring on mobile + desktop ; Twilio — call forwarding with caller ID — https://www.twilio.com/code-exchange/call-forwarding-caller-id
- **Build docs:** Twilio — `<Dial>` with `<Client>` + `<Number>` (simultaneous ring) — https://www.twilio.com/docs/voice/twiml/dial ; Twilio — `<Number url>` whisper/announce — https://www.twilio.com/docs/voice/twiml/number

## Journey 2.14 — Configure call notifications

*As a rep, I want to control how the app alerts me, so that I never miss a call or get spammed by alerts.*

The user controls exactly how the app alerts him, in **Settings → Notifications**. (Referenced from Journey 2.1 — inbound calls assume these settings.)

1. Per event (incoming call, missed call, new voicemail), he toggles the channels: **in-browser sound (ring)**, **in-app popover**, **browser notification**, and **OS / desktop notification**.
2. He picks the ring sound and volume, and can send a **test ring**.
3. A **Do-not-disturb** toggle (with an optional schedule) silences rings and pops without taking him offline.
4. If browser or desktop notifications are not yet granted, the app shows a one-click "Enable notifications" prompt that asks the browser/OS for permission.
5. **Get notified even when the app tab is closed (your ask), and the honest limit.** With **web push + a service worker**, an inbound-call notification fires even when **no app tab is open** — as long as the **browser is still running in the background** (Chrome/Edge keep a background process). **If the browser is fully quit, no web notification can fire** — that's a hard platform limit, not a setting. So for true "reach me when I'm away from the computer," the reliable path is **ringing your cell (Journey 2.15)**, which needs nothing running. A **lightweight desktop companion app** (a menu-bar/tray app that stays resident) is the planned **[LATER]** way to alert when the browser is closed; until then, web-push covers "at my desk" and the cell fallback covers "away."

- **Benchmark (beat this):** Dialpad — notification preferences — https://help.dialpad.com/docs/notifications
- **Build docs:** MDN — Notifications API — https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API ; MDN — Push API (service-worker background) — https://developer.mozilla.org/en-US/docs/Web/API/Push_API

> **Journey 2.14 (live battlecards) is deferred to a later phase and removed from the calling core.** Its live-detection background job (**C4**) is removed here too. The deferral is recorded in the master feature list.

---

## Background jobs (what happens on its own, and when)

- **C1 — Upload recording.** On hang up, the audio uploads to cloud storage and the file URL saves to the call record. ~1–5 seconds after the call.
- **C2 — Live transcribe.** During the call, streaming speech-to-text produces a rolling transcript so the AI can disposition and extract fields as he talks and within a second or two of hang up. Runs on every call (subject to consent, Journey 2.3).
- **C2b — High-accuracy diarized pass (every recorded call).** After hang up, the recording is re-transcribed with **speaker labels (diarization)** and cleaned text. **Why "when needed" is gone (your question):** the summary and structured extraction (doc 2a) run on this pass for *every* call, and field accuracy needs to know who said what — so C2b runs on **every recorded call**, not only sometimes. Post-call, usually seconds to ~1 minute by call length.
- **C3 — AI summary + extraction.** After C2b, an AI writes the summary and pulls the structured fields, using the applied template (Journey 2.7, doc 2a). Usually a few seconds. The user did nothing to trigger it. *(Kept in this doc because it is part of the shared call pipeline; the journeys it feeds live in doc 2a.)*

---

## Decisions — your answers (calling core)

All six are decided. Your answers folded in:

**1. When can the rep disposition a call? — Decided: during and after, shown at the earliest.** The disposition bar appears as soon as the call starts (dialing) and stays until he picks one. Ties to the terminology fix: **"Connected"** is the **phone state** (line opened); the disposition for reaching the actual decision maker is **"Reached DM."**

**2. When does transcription happen — live or after? — Decided: both.** Live transcription (**C2**) runs on every call for the in-call AI. A post-call high-accuracy pass with **speaker labels** (**C2b**) runs when a feature needs the granularity — which the summary + extraction do.

**3. When does the AI summary show? — Decided: auto, seconds after hang up**, with a Regenerate button. Your "granularity / who the speakers are" point is handled by C2b feeding C3. *(Flagging: I read your comment on #3 as being about transcript granularity, not about changing the auto-summary pick. Tell me if you meant otherwise.)*

**4. Recording consent default? — Decided: auto-disable in two-party-consent states, with an override.** State is guessed by **area code** (Journey 2.3), and the UI copy says so.

**5. Where does call history live? — Decided: its own "Calls" page** in the navbar, plus recent calls inside the dialer.

**6. Where does voicemail live? — Decided: a "Voicemail" area under Calls.**

---

## Technology choices (where it is not obvious)

Builds on the P0 stack (React + Vite SPA + TS API, Firebase Auth, Twilio, Postgres+Prisma). New choices here:

- **Recording storage — our own object storage (Cloudflare R2 or S3), not Twilio-hosted.** *Options:* keep recordings on Twilio (simplest) vs copy to our own bucket. **Pick: our own bucket**, for cost (cheap egress on R2), control, and retention rules. We copy the file off Twilio after the call (job C1) and serve it via short-lived signed URLs.
- **Transcription — Deepgram for both live and post-call.** *Options:* Deepgram vs AssemblyAI vs Whisper-self-host. **Pick: Deepgram** — it does streaming (C2) *and* prerecorded with speaker diarization (C2b) behind one vendor. **Model (default, swappable behind our provider boundary):** Deepgram's **latest Nova** model — **Nova streaming** for C2 (low latency for in-call cues) and **Nova pre-recorded + diarization** for C2b (accuracy + speaker labels). *Speed/cost/accuracy:* Nova is the latency/accuracy sweet spot; we can drop to a cheaper Deepgram tier for very high volume, or fail over to **AssemblyAI** (strong diarization) — all without touching call code.
- **Live audio path — Twilio Media Streams → our server → Deepgram.** Twilio forks the call audio over a WebSocket to our server, which relays to Deepgram's streaming API and pushes the rolling transcript to the browser. *Alternative (browser-side capture) is rejected: it misses the far-end audio.*
- **AI summary + extraction — a provider-agnostic layer; the model is chosen by the super-admin on the backend** (your global edit). **Default: Claude Sonnet 5** — it runs once per call (latency lenient) and needs solid accuracy for structured extraction, so the Sonnet tier is the cost/accuracy balance; **Opus 5** for max accuracy on complex orgs, **Haiku 4.5** for high-volume cost saving. Structured fields come back via the model's JSON-schema / tool-calling mode so output is typed, not parsed from prose. *(Every AI inference in these docs names a default model like this; the super-admin can change any of them later.)*
- **Rich-text notes — TipTap** (same editor the CRM doc uses, so notes are one component everywhere).

## Data model (Prisma) — additions in this doc

Extends the P0 schema. **New models and added fields are marked.** Unmarked relations point at P0 models.

```prisma
model Call {
  // ...all P0 fields, plus:
  recordingConsent   String?   // added: allowed | blocked-2party | unknown (Journey 2.3)
  isRecorded         Boolean   @default(false) // added
  callerNumberId     String?   // added: which PhoneNumber placed it (Journey 2.13 #1)
  disposition        Disposition? @relation(fields: [dispositionId], references: [id]) // added
  dispositionId      String?   // added
  predictedDispositionId String? // added: AI recommended disposition (Journey 2.4c / 2.4d, doc 2a)
  predictionModel    String?   // added: provenance for the recommendation (model + prompt version)
  appliedTemplateId  String?   // added: which summary/extraction template ran (Journey 2.7b, doc 2a)
  nextSteps          CallNextStep[]  // added: what-should-happen-next (Journey 2.4 (step 4))
  recording          Recording?      // added
  transcripts        Transcript[]    // TWO: the live pass (C2) and the diarized one (C2b), see Transcript.pass
  summary            CallSummary?    // added
  extracted          CallExtractedValue[] // added
}

model Recording {          // NEW
  id         String   @id @default(cuid())
  call       Call     @relation(fields: [callId], references: [id])
  callId     String   @unique
  storageKey String            // key in our bucket (served via signed URL)
  durationS  Int?
  createdAt  DateTime @default(now())
}

model Transcript {         // NEW — one row; segments hold speaker labels from C2b
  id        String             @id @default(cuid())
  call      Call               @relation(fields: [callId], references: [id])
  callId    String             @unique
  pass      String   @default("live") // live (C2) | final (C2b, diarized)
  segments  TranscriptSegment[]
}

model TranscriptSegment {   // NEW
  id           String     @id @default(cuid())
  transcript   Transcript @relation(fields: [transcriptId], references: [id])
  transcriptId String
  speaker      String?    // "rep" | "prospect" (from diarization)
  startMs      Int
  text         String
}

model Disposition {        // NEW — workspace-defined; pinned ones show on the bar (Journey 2.4 / 2.4a)
  id          String  @id @default(cuid())
  workspaceId String
  label       String
  value       String        // stable key for reporting/automations (editing label never breaks reports)
  color       String        // semantic: green | amber | red | gray
  icon        String?
  category    String        // positive | neutral | negative
  isPinned    Boolean @default(false) // shown on the fixed bar vs in "More"
  sortOrder   Int     @default(0)
}

model NextStepType {       // NEW — Journey 2.4b — what-should-happen-next, distinct from disposition
  id            String  @id @default(cuid())
  workspaceId   String
  label         String
  value         String        // stable key for reporting/automations
  color         String
  icon          String?
  needsDateTime Boolean @default(false) // e.g. Callback opens a date/time picker
  createsTask   Boolean @default(true)  // spawns a task/reminder when chosen
  isPinned      Boolean @default(true)
  sortOrder     Int     @default(0)
}

model CallNextStep {        // NEW — a next step attached to a call (zero or more per call, Journey 2.4 (step 4))
  id        String    @id @default(cuid())
  call      Call      @relation(fields: [callId], references: [id])
  callId    String
  typeId    String              // -> NextStepType
  dueAt     DateTime?           // set when the type needs a date/time (Callback)
  createdAt DateTime  @default(now())
}

model CallSummary {        // NEW — output of C3
  id          String   @id @default(cuid())
  call        Call     @relation(fields: [callId], references: [id])
  callId      String   @unique
  templateId  String?          // which SummaryTemplate produced it (provenance)
  modelUsed   String?          // which AI model (super-admin-set) — provenance
  body        Json             // rendered sections
  createdAt   DateTime @default(now())
}

model CallExtractedValue {  // NEW — one structured field pulled from a call
  id           String  @id @default(cuid())
  callId       String
  fieldId      String          // -> ExtractionField
  valueJson    Json            // typed value; null-able for "not mentioned"
  editedByUser Boolean @default(false) // user edit wins over AI
}

model SummaryTemplate {    // NEW — Journey 2.7 (doc 2a)
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  sections    Json     // ordered [{title, prompt, format, length}]
  isDefault   Boolean  @default(false)
  origin      String   @default("user") // seed | user — supports "Restore default templates" (Journey 2.7a)
  appliesWhen Json?    // rules: direction / campaign / stage / participants
}

model ExtractionField {    // NEW — Journey 2.7 field set (doc 2a)
  id           String @id @default(cuid())
  workspaceId  String
  name         String
  type         String  // yesno | select | multiselect | number | date | range | shorttext | longtext
  prompt       String
  guidanceJson Json?   // options + 5+ example sentences
  origin       String  @default("user") // seed | user — supports "Restore defaults" (Journey 2.7a)
  crmObject    String? // mapping target (once CRM exists)
  crmField     String?
  writeRule    String  @default("write-if-empty") // confirm | write-if-empty | overwrite
}

model VoicemailGreeting {  // NEW — Journey 2.11
  id          String  @id @default(cuid())
  workspaceId String
  kind        String  // default | personal
  storageKey  String?
  isActive    Boolean @default(false)
}

model VoicemailMessage {   // NEW — Journey 2.12 (inbound voicemail left for us)
  id          String   @id @default(cuid())
  workspaceId String
  fromE164    String
  storageKey  String
  transcript  String?          // post-call transcription pass
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
}

model NotificationSetting { // NEW — Journey 2.14
  id            String  @id @default(cuid())
  workspaceId   String
  event         String  // incoming_call | missed_call | new_voicemail
  browserSound  Boolean @default(true)
  inAppPopover  Boolean @default(true)
  browserNotif  Boolean @default(false)
  desktopNotif  Boolean @default(false)
  dndUntil      DateTime?
}

model OutboundSetting {    // NEW — Journey 2.13 (three distinct fields)
  id             String  @id @default(cuid())
  workspaceId    String  @unique
  defaultNumberId String?        // #1 which number
  showCallerName Boolean @default(false) // #2 show a name at all (CNAM)
  callerNameText String?         // #3 the name text
}
```

## Technical decisions, trade-offs & edge cases

- **Empty means null, never an empty string (your data-model question).** On every field write — AI-extracted values, notes, disposition/next-step config, and CRM fields once they exist — the server **normalizes on save**: trim whitespace; an empty, whitespace-only, or cleared value is stored as **null (unset)**, never `""`. A cleared multi-select → **null** ("not set"), not `[]`. This matches **Attio** and **HubSpot**, which both treat a cleared field as *unset*, so "is empty" / "has any value" filters and required-field checks work correctly. It also keeps AI extraction honest: **"not mentioned" is null**, and the model is instructed to return null (never `""`) when a value is absent. Per type: text / long-text → null; number / date / range → null (never `0` or epoch); yes/no → null when unstated (not `false`); select / multiselect → null.
- **Consent-by-area-code is a heuristic, not truth.** Area code ≠ real location (VoIP, ported, and traveling numbers break it). So the default is the *safe* side (auto-disable in two-party states) with a manual override, the UI copy says "based on the area code" (Journey 2.3.3), and we **store the consent decision on the call** for the record.
- **Two transcription passes on purpose** (C2 live, C2b diarized). Live is noisy and has no reliable speaker labels; summary + extraction wait for the clean, speaker-labeled pass so "who said the budget" is correct.
- **Provenance is stored** on summaries and extracted values (which template, which model, which transcript pass, and whether the user edited). This matters because the model is super-admin-set and can change over time.
- **Inbound needs server wiring** (Journey 2.1): a Twilio TwiML app + incoming webhook routes the call to the registered browser Device. Handle "browser closed / not registered" → straight to voicemail.
- **Disposition auto-advance + focus:** picking a disposition (or a number-key) fires immediately and moves on; the note field auto-focuses on answer and never blocks advancing. Keyboard handling must not steal the digit keys while the DTMF keypad overlay is open.
- **This doc refined the P0 dialer placement** (see Journey 2.5 note): the corner popover expands to a docked call panel during an active call. Recorded here so the P0 "bottom-right popover" decision is not read as final.
