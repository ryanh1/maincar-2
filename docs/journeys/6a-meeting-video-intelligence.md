# Doc 6a — Meeting (Video) Intelligence

Same journey format. **[doc 6](6-call-intelligence.md) is the intelligence experience for phone calls.** This doc gives **recorded video meetings** (Zoom / Google Meet / Microsoft Teams, via Recall.ai) the **same** experience — and hardens the one thing video adds that phone doesn't: matching a **calendar event** to its **recording**.

**Why this doc exists (your under-spec flag).** We already **record** meetings — [doc 5, Journeys 5.10/5.11, job F5](5-comms-email-and-calendar.md) send a Recall.ai bot into Zoom/Meet/Teams, store the recording+transcript, and reuse the calling-core extraction path. But everything *downstream* — the synced player, live in-meeting next-action, structured extraction review, and the recording's playback inside the deal timeline — was written **for phone calls in doc 6** and never spelled out for video. Video meetings are where the biggest deals happen, so the intelligence layer must cover them explicitly. This doc closes that gap.

**The three things you named, mapped:**
- **(a) AI during the call → next action** → **Journey 6a.4** (live in-meeting assist, on Recall's real-time transcript, feeding the same doc-7 copilot loop).
- **(b) Extraction of structured insights** → **Journey 6a.3** (meeting summary + MEDDPICC/field extraction, reusing calling-core Journey 2.7 with multi-party specifics).
- **(c) Calls in the deal timeline, playback & navigation** → **Journey 6a.6** (the meeting's player+transcript inside the doc-6.9 timeline panel).

Plus the design-principle checklist: the synced player (6a.1), speaker identity (6a.2), analytics + comments (6a.5), and the **bulletproof calendar↔recording matching** you asked about (6a.7). Benchmark throughout is **Gong** (meetings) + **Recall.ai** (the bot/media).

**What this doc does NOT redefine.** Recording + the recording rules + the bot lifecycle state machine (doc 5, F5); the summary/extraction *templates* and the diarization/summary *jobs* (calling-core Journey 2.7, C2b/C3); the transcript↔audio player mechanics, comments model, analytics definitions, and the account timeline (doc 6). This doc references them and specifies the **video deltas**.

Journeys are numbered **6a.1–6a.7**.

---

## New surfaces this doc adds

- **Meeting record page** — the video sibling of the call record (doc 2.9 / doc 6.1): a **video player** (not just audio) + synced transcript + diarization ribbon + comments + analytics.
- **Live meeting assist panel** — an in-meeting copilot rail on the real-time transcript (opt-in), the video twin of the on-call assist.
- **Meeting detail panel** — the recording playing inline inside the deal/account timeline (doc 6.9) and the record activity feed.
- **"Needs match" review for meetings** — the same review banner as doc 6.7, extended to the calendar↔recording + attendee-match cases.

---

## Journey 6a.1 — Watch a recorded meeting, synced to the transcript

*As a rep, I want to replay a meeting with the transcript following the video and each speaker named, so that I can review a multi-party call as easily as a phone call.*

This is doc 6.1 + 6.2, with **video** instead of audio and **more speakers**.

1. **Entry point.** The meeting's **Ready** notification (doc 5.10) or its timeline entry opens the **meeting record page** — the two-column layout of doc 2.9, left column now a **video player** (Recall gives us video, not just audio).
2. **Player.** Play/pause, 10s skip, playback speed, current-time / total read-out (as doc 6.1), plus a **video surface** and a **speaker-view vs gallery** note deferred (we render Recall's composited recording; per-participant tiles are a later nicety). Screen-share segments are marked on the ribbon (step 4).
3. **Synced transcript + click-to-seek + in-transcript search** — identical mechanics to doc 6.1/6.2 (active-line highlight, word-level highlight from timing, click a line to seek, search box with hit count and ribbon ticks). One transcript component serves calls and meetings.
4. **Diarization ribbon** — the doc-6.1 ribbon, but built for **N participants** (a meeting has more speakers than a 1:1 call): one hue per participant, our-side vs their-side by hue family. A thin lane above the ribbon marks **screen-share** spans (Recall reports them) so "when did they demo" is one glance.
5. **Responsiveness** — same explicit breakpoint QA as doc 6.1 step 7; the video reflows, the ribbon keeps 1:1 time alignment.

- **Benchmark (beat this):** Gong — the call/meeting page (synced player + transcript) — https://help.gong.io/docs/intro-to-the-call-page ; Recall.ai — meeting bot media/transcript — https://www.recall.ai/product/meeting-bot-api
- **Build docs:** reuses doc 6.1/6.2 player + ribbon (swap `<audio>` for `<video>`, same `timeupdate` sync); Recall recording/transcript fetch — https://docs.recall.ai/docs/async-transcription

## Journey 6a.2 — Know who each participant is (identity, the video way — better than phone)

*As a rep, I want each meeting speaker named correctly, so that the transcript, analytics, and CRM attach are right without me relabeling.*

Video identity is **stronger than phone**, and we exploit that. On a phone call we *guess* the outside speaker from the linked record (doc 6.1a); in a meeting Recall gives us the **participant list with names, join/leave times, active-speaker timeline, and — when the calendar integration is on — participant emails** attached to speaker segments.

1. **Seed from Recall participants (deterministic).** Map each Recall participant to a speaker lane using their reported **name**; where a **participant email** is present (calendar-linked), resolve it to a CRM Person via the **doc-5 matcher** — so a speaker becomes a real linked contact, not a guess. Our-side participants (internal domain) are labeled with the user's own name (doc 6.1 rule).
2. **Email is the key signal (spec note).** Recall exposes participant **email only when its calendar integration is enabled** (on Zoom especially, the meeting SDK alone doesn't reliably expose email). We enable it — email is what makes speaker→Person deterministic. Where email is missing (guest dialed in, personal account), we fall back to the doc-6.1a **name-extraction pass** (a name only if stated on the call) and the seed-from-linked-record logic.
3. **The user always wins.** Manual rename/reassign overrides and is marked confirmed; AI never re-labels a confirmed speaker (doc 6.1 rule). A rename recomputes analytics (job G1).
4. **Unknown attendee → auto-create (optional).** A meeting attendee with an email that matches no Person can auto-create one (doc 5a 5.3a, if enabled) — the doc-5 "unknown meeting attendee" behavior, surfaced here as the identity source.

- **Benchmark (beat this):** Recall.ai — meeting participants & events (names, speaker timeline) — https://docs.recall.ai/docs/meeting-participants-events ; participant emails — https://www.recall.ai/blog/recall-ai-announces-participant-emails
- **Build docs:** reuses doc 6.1a fallback + the doc-5 matcher; Recall participant events endpoint (above).

## Journey 6a.3 — Meeting summary + structured extraction (your "(b)")

*As a rep, I want a meeting to produce the same summary and MEDDPICC/field extraction a call does, so that a video meeting updates the deal without me typing notes.*

Doc 5.10 step 5 already says a meeting runs the **calling-core Journey 2.7** extraction; this journey specifies the **video-specific** parts so it's build-ready.

1. **Same pipeline as a call.** On Recall's `recording.done`, the transcript runs the **same C3 summary + extraction templates** (Journey 2.7) — Overview, pain points, next steps, extracted fields, MEDDPICC/BANT/CHAMP (doc 7). Model = super-admin backend choice (doc 13). Meetings and calls share **one** summary/extraction path — no second implementation.
2. **Multi-party specifics (what differs from a 1:1 call):**
   - **Attribute statements to the right person.** Extraction uses the diarized, email-resolved speakers (6a.2), so "the economic buyer raised pricing" is tied to a **named contact**, not "the other side." This is richer than a 2-party phone call.
   - **Agenda + screen-share context.** The event's title/description (from the calendar) and screen-share spans are available as extra context to the summary prompt ("they demoed the reporting module at 22:10").
   - **Longer, higher-stakes.** Meetings run long; the summary template can be a meeting-specific variant (a longer, sectioned recap) selectable per workspace, reusing the template config of Journey 2.7 — not a new editor.
3. **Review & accept.** The extracted fields and next actions flow into the **doc-7 accept/edit/reject** stack exactly like a call's, each value carrying provenance back to the transcript moment.

- **Benchmark (beat this):** Gong — meeting spotlight / AI recap — https://help.gong.io/docs/save-time-with-call-spotlight ; reuses calling-core Journey 2.7 extraction
- **Build docs:** reuses C3 + Journey 2.7 templates (no new job for post-call extraction); provenance = doc 7 Journey 7.9.

## Journey 6a.4 — Live in-meeting assist / next action (your "(a)")

*As a rep, I want the AI to surface cues and pre-stage next actions during a live meeting, so that the action stack is ready the moment the meeting ends — just like on a call.*

The video twin of the on-call live assist (doc 2a / doc 7 job H1). It runs on **Recall's real-time transcript**.

1. **Real-time transcript from Recall.** With the bot configured for **real-time transcription** (Recall pushes `transcript.data` webhooks every ~1–3s, sub-second latency), we stream the meeting transcript server-side as it happens — the same input the live-call assist consumes, from a different source.
2. **Same copilot loop.** The streaming transcript feeds **job H1** (doc 7): it pre-stages commitments, follow-ups, and field diffs *during* the meeting, so the accept-stack is **ready the instant the meeting ends** (doc 7.1 question 4), then finalizes on the clean post-call diarized pass (accuracy).
3. **In-meeting rep cues (opt-in, unobtrusive).** An optional **live assist panel** (in the app, on the rep's second screen — not injected into the meeting UI) can surface battlecards / next-question hints on tracked-term or objection detection (doc 6.6). Off by default; this is the "AI during the call" experience for video.
4. **Accuracy note (reused decision).** Live runs on the streaming transcript for **speed**; the authoritative extraction re-runs post-meeting on the clean diarized transcript for **accuracy** — the same during-vs-after tradeoff already decided for calls (doc 2a). Fully-live structured extraction stays the [backlog](14-backlog.md) "live in-call extraction" item.

- **Benchmark (beat this):** Recall.ai — real-time transcription — https://docs.recall.ai/docs/bot-real-time-transcription ; the on-call assist parity — doc 2a / doc 7 job H1
- **Build docs:** Recall real-time endpoints + `transcript.data` webhooks (above); feeds doc-7 H1 (no new copilot model).

## Journey 6a.5 — Comment, and see meeting analytics

*As a manager, I want timestamped comments and talk-time analytics on a meeting, so that I can coach on multi-party calls the same way I do phone calls.*

Reuses doc 6.4 (comments) and doc 6.5 (analytics) wholesale — the models and UI are identical; only the multi-party framing differs.

1. **Comments** — the doc-6.4 timestamp-anchored, threaded `CallComment` rail, pinned to a **ms offset** so a re-transcription keeps anchors (doc 6.4 edge case). Comments attach to the meeting record; @-mentions notify (job E3).
2. **Analytics (job G1) — per participant.** Talk-ratio, longest monologue, interactivity, and question counts, computed off the diarized transcript — but with **N participants**, the headline is **our side vs. their side** with a **per-person breakdown** (which of the 3 buyers spoke, who was silent — a signal a 1:1 call can't give). Tracked-term/competitor mentions (job G2) work identically.
3. **Every number links into the transcript** (doc 6.5) — never a black box.

- **Benchmark (beat this):** Gong — talk-to-listen + per-speaker analytics — https://www.gong.io/blog/talk-to-listen-conversion-ratio
- **Build docs:** reuses doc 6.4 `CallComment` + doc 6.5 job G1/G2 verbatim (a meeting is a `Call`-like source for these jobs).

## Journey 6a.6 — The meeting in the deal timeline: playback & navigation (your "(c)")

*As a rep, I want a meeting recording to play inline inside the deal timeline with full navigation, so that I can review it in the flow of the account without leaving for a separate page.*

Doc 6.9 step 8 already defines a **Meeting** detail panel that shows "the recording + transcript inline… same call-style card." This journey makes that build-ready for video.

1. **On the account/deal timeline (doc 6.9),** a meeting event opens the **detail panel** with: title, attendees (resolved to linked People, 6a.2), time, agenda, and — because it's recorded — an **inline video player + transcript** (the 6a.1 experience in miniature): diarization ribbon, click-to-seek, in-panel search, and a **"Open full meeting"** deep-link to the meeting record.
2. **Navigation parity with calls.** The ‹ › chevrons, keyboard shortcuts (←/→ items, Esc close), and "drill-ins open a panel, not a full-page jump" of doc 6.9 step 8 apply — a meeting navigates exactly like a call in the timeline, so the account view has one grammar.
3. **One source, two views.** The meeting is the same `MeetingRecording`/activity the record feed and the account timeline both read (doc 6.9 step 11) — it never appears twice or drifts between the record timeline (doc 4.11) and the account timeline (doc 6.9).

- **Benchmark (beat this):** Gong — the account page timeline with inline media — https://help.gong.io/docs/intro-to-the-account-page
- **Build docs:** reuses doc 6.9 timeline + detail-panel + the 6a.1 mini-player; reads the doc-4 `CompanyActivity` feed (job E5).

## Journey 6a.7 — Bulletproof calendar-event ↔ recording matching (your bulletproof question)

*As the system, I want every meeting recording tied to the right calendar event and the right CRM deal, or held for review — never wrongly attached, so that the timeline and analytics are trustworthy.*

**Your question — "is our spec bulletproof on calendar event → meeting recording matching, benchmarked to Gong?"** Honest answer: doc 5 got the **happy path** right (schedule a bot per event, attach via the shared matcher) but did **not** spell out the edge cases that break naive matching. This journey closes that, benchmarked to how Gong actually does it. **Matching is two independent layers — we harden each, and hold rather than guess on any doubt** (the doc-5 ≥98%-precision bar: a wrong attach is worse than a miss).

### Layer 1 — recording ↔ calendar event (mostly deterministic, because *we* scheduled the bot)

Unlike Gong (which finds the event after the fact), **we schedule a bot *for a specific event instance*** (doc 5, F5), so the recording is bound to the event we scheduled it for. The edge cases and how we handle them:

1. **Recurring meetings / a shared join URL (the classic breaker).** A weekly sync and every instance can share one Meet/Zoom URL, so URL alone is ambiguous. **Fix:** we bind the recording to the **specific event instance** (event id + start time), and we set Recall's **`deduplication_key` = `{event.start_time}-{meeting_url}`** so exactly **one bot** joins a given meeting even if several reps have the same invite — no duplicate recordings, no cross-instance confusion.
2. **Meeting rescheduled after the bot was scheduled.** On each **calendar delta (doc 5, F1)** we diff upcoming events: a **time change** re-schedules the bot (Recall takes the **full `bot_config`** on reschedule — no partial update — retry on `409/507` for changes <10 min out); a **deleted/cancelled event** cancels the bot (Recall auto-unschedules on event delete). So the bot always tracks the event's *current* time.
3. **Starts late / early / runs long.** We key off the **event we scheduled the bot for**, not a strict clock window, so ordinary drift is tolerated (as Gong tolerates it). The recording's actual start/stop come from Recall; the *event binding* is unchanged by drift.
4. **Back-to-back meetings sharing a Personal Meeting ID (same URL, adjacent times).** The dedup key includes **start_time**, and we bind to the instance whose scheduled window the bot joined. If two events genuinely share a URL **and** overlap in time (a true tie), we **do not guess** — the recording is **held for review** (step below) rather than attached to the wrong one.
5. **Ad-hoc / instant meeting with no calendar event.** The **paste-a-link flow** (doc 5.10 ad-hoc): the recording has **no `eventId`**; on Ready we **prompt the rep to link it** to a Deal/Person (there's no event to infer from). Never silently attached.
6. **Bot couldn't capture (waiting room, host blocked, Teams CAPTCHA, no recording).** Recall's **status webhooks** report "couldn't join / no recording"; we surface **"Couldn't record" with the reason** (doc 5.10 state machine) and a "record manually" fallback — we **never** attach an empty/failed recording as if it were a real meeting.

### Layer 2 — calendar event ↔ CRM record / deal (the shared matcher, same as email)

Once we know the event, attaching it to the right **Person/Company/Deal** is the **same problem as email/meeting matching** — so it runs the **one shared doc-5 matcher (Journey 5.2c)**, not a second engine. Signals and edge cases (mirroring Gong's priority order):

7. **Participant list = invitees ⊕ actual attendees.** Merge the calendar invitees with **who actually joined** (Recall participant events) — Gong does this because invitees ≠ attendees. Run each through the matcher.
8. **Match order:** exact attendee **email** → **email domain** → **open-Deal** heuristic (Gong's "closest-activity open opportunity" is our open-Deal proximity rule) → unmatched hold. **Rep attribution** = the internal participant (our-side user on the event).
9. **Personal-email / no-email guest.** Exact-email match on a `gmail.com`/`outlook.com` address still attaches to a **Person** if it exactly matches one (doc 5.2c public-domain rule), but a personal domain **never** creates/guesses a Company. A guest with no email → not matched by email; falls to domain/open-deal or is **held**.
10. **Multiple open deals / ambiguous account.** The matcher's open-Deal heuristic picks by participant-owner + activity-date proximity (doc 5.2c); a genuine tie is **held for review**, not guessed — same as Gong being configurable and Fireflies putting deal-selection in front of a human.

### The unified fallback — hold & review (never a wrong attach)

Anything Layer 1 or Layer 2 won't resolve cleanly surfaces in the **"Needs match" review banner + Unmatched-activity queue** (doc 6.7) — the exact same review UX as calls/emails, extended to the two meeting-specific cases (ambiguous event tie; ambiguous deal). A confirmed choice writes a **`MatchOverride`** (doc 6.7) so we never re-ask about that identifier. A manual link always wins and is marked confirmed.

**So: is it bulletproof now?** Layer 1 is near-deterministic because we own the scheduling (our advantage over Gong's after-the-fact search), hardened with the dedup key + instance binding + reschedule tracking + the couldn't-record guard. Layer 2 reuses the ≥98%-precision matcher and **holds on any tie**. The design guarantees **no wrong auto-attach** — the failure mode is a few "please confirm" prompts, which is the correct trade (a wrong attach pollutes the deal; a held item is one click).

- **Benchmark (beat this):** Gong — associating accounts/opportunities to calls/meetings — https://help.gong.io/docs/associating-salesforce-accounts-and-leads-to-calls ; Recall.ai — scheduling + `deduplication_key` — https://docs.recall.ai/docs/scheduling-guide ; Fireflies human-in-the-loop deal select — https://guide.fireflies.ai/articles/3882093831-autofill-crm-hubspot-sync-meeting-data-to-contacts-company-and-deals
- **Build docs:** reuses the doc-5 matcher (5.2c) for Layer 2 + doc-6.7 review UX/`MatchOverride`; Recall calendar scheduling — https://docs.recall.ai/reference/calendar_events_bot_create

---

## Background jobs (this doc)

Video meeting intelligence **reuses the existing jobs** — it does not add a parallel pipeline. Mapping:

- **Recording lifecycle + attach** = doc 5 **job F5** (`recording-pipeline`), extended only with the **Layer-1 hardening** above (dedup key on schedule; reschedule/cancel on calendar delta; bind to event instance; couldn't-record guard). *(Small additions to F5 / `MeetingRecording` are cross-referenced in doc 5 — see below.)*
- **Diarized transcript, summary, extraction** = calling-core **C2b / C3** (a meeting is a recorded-media source into the same passes).
- **Metrics, term detection, record match, brief** = doc 6 **G1 / G2 / G3 / G6** (a `MeetingRecording` is a `Call`-like source for these; G3 invokes the shared matcher for Layer 2).
- **Live assist** = doc 7 **H1** on Recall's real-time transcript (Journey 6a.4).
- **New, tiny:** **K-meet — bind & dedup on schedule.** **Trigger:** F5 scheduling a bot. **Steps:** compute `dedupKey = {eventInstanceStart}-{meetingUrl}`, store the event-instance binding, pass the key to Recall. Folded into F5, not a separate queue.

*(Cross-doc note for doc 5: add `dedupKey` and `calendarEventInstanceId` to `MeetingRecording`, and add the reschedule/cancel-on-calendar-delta step to F5 — small, additive, referenced from here so the two docs don't drift.)*

---

## Decisions for you (meeting intelligence)

**1. One experience for calls and meetings. Decided (my pick): video meetings reuse doc 6's player/transcript/comments/analytics + doc 7's copilot loop + calling-core extraction — not a parallel stack.** A meeting is a recorded conversation with more speakers and a video track; everything else is shared. This keeps one codebase and one mental model, and it's why this doc is deltas, not duplication.

**2. Matching. Decided: two explicit layers, both hardened, hold-on-doubt** (Journey 6a.7). Layer 1 (recording↔event) is near-deterministic because we schedule the bot; Layer 2 (event↔CRM) reuses the ≥98%-precision shared matcher. No wrong auto-attach; ambiguity is a review prompt.

**3. Identity via Recall calendar emails. Decided: enable Recall's calendar integration so participant emails attach to speakers** (Journey 6a.2) — video identity is deterministic where phone is a guess, and email is the key. Fall back to the doc-6.1a name-extraction pass where email is missing.

**4. Live assist. Decided: opt-in, on Recall's real-time transcript, feeding the same H1 loop** (Journey 6a.4); fully-live structured extraction stays backlogged (accuracy-vs-speed, same as calls).

---

## Data model (Prisma) — additions in this doc

Almost everything reuses doc 5 (`MeetingRecording`, `CalendarEvent`), doc 6 (`CallComment`, `CallMetrics`, `TermMention`, `CallMatch`, `MatchOverride`), and calling-core (`Transcript`, `TranscriptSegment`). The only additions are the Layer-1 hardening fields on doc-5's `MeetingRecording`:

```prisma
model MeetingRecording {      // doc 5 (Journey 5.10) — fields ADDED here for matching hardening (Journey 6a.7)
  // ...existing (id, workspaceId, eventId, recallBotId, platform, state, storageKey, transcriptId, relatedRecordId), plus:
  calendarEventInstanceId String?  // added: the specific recurring-instance bound (not just the series) — Layer 1
  dedupKey                String?  // added: "{eventInstanceStart}-{meetingUrl}" passed to Recall deduplication_key — Layer 1
  matchState              String  @default("auto") // added: auto | needs_review | manual | failed (Layer 1/2 outcome)
  captureFailReason       String?  // added: "waiting_room" | "host_blocked" | "no_recording" | ... (couldn't-record guard)
  hasVideo                Boolean @default(true)   // added: video vs audio-only capture
}
```

`MeetingRecording` is treated as a **`Call`-like source** by jobs G1/G2/G3/G6 and by the timeline — so comments (`CallComment`), metrics (`CallMetrics`), term mentions (`TermMention`), and the match link (`CallMatch`, with `sourceType = "meeting"`) all attach to it via the same `sourceType/sourceId` shape doc 6 already defines. No new comment/metrics/match models.

---

## Technology choices (where it's not obvious)

Builds on doc 5 (Recall.ai), doc 6 (Deepgram, the player/analytics), doc 7 (the copilot loop).

- **Recall.ai for the bot + media across all three platforms (doc 5's pick, unchanged).** One API for Zoom/Meet/Teams; we own event selection (doc 5.11). Alternatives (native per-platform recording; Fireflies/Otter/Fathom as products) were considered in doc 5 — Recall is infrastructure we build on, not a product we resell.
- **Real-time transcript for live assist = Recall streaming; authoritative transcript = post-call diarized (C2b).** Two transcripts, two jobs, one accuracy-vs-speed tradeoff already decided for calls (doc 2a). *Confirm Recall's current real-time config field names against live docs at build time — the API has been migrating toward a unified `recording_config`.*
- **Participant identity = Recall calendar emails first, name-extraction fallback.** Deterministic where possible (6a.2); the doc-6.1a AI name pass only fills gaps.
- **Matching = the one shared doc-5 matcher for Layer 2; our own scheduling for Layer 1.** No new matching engine — the deprecated points system stays dead (doc 6.7).
- **The player is `<video>` + `timeupdate`,** the same lightweight approach as doc 6's `<audio>` sync (our own SVG ribbon over segment times), not a heavy media library.

---

## Technical decisions, trade-offs & edge cases

- **No wrong auto-attach, ever (the precision bar).** Both matching layers hold on doubt (6a.7); a held meeting is a one-click confirm, a wrong-attached meeting pollutes a deal's timeline and analytics. We optimize for precision, accepting occasional review prompts.
- **We own event selection, so Layer 1 is our advantage.** Because *we* schedule the bot per instance (doc 5.11), the recording→event binding is near-deterministic — stronger than Gong's after-the-fact search — provided we set the dedup key and track reschedules (6a.7). The failure Gong hits (shared/duplicate URLs) is designed out.
- **Couldn't-record is a first-class outcome.** A bot that can't join (waiting room, blocked, CAPTCHA) surfaces "Couldn't record" with a reason and a manual fallback (doc 5.10) — never a silent gap and never an empty recording on the timeline.
- **One pipeline, video-aware.** Meetings reuse C2b/C3/G1/G2/G3/H1 as a `Call`-like source; the only genuinely new work is the video player surface (6a.1), the participant-email identity (6a.2), the live assist wiring to Recall's stream (6a.4), and the Layer-1 hardening (6a.7). Everything else is shared code — which is the point.
- **Consent applies to meetings too.** Recording follows the doc-5.11 / doc-2.3 consent posture; external-meeting detection never overrides a consent block, and recording is off until an admin enables it and a rep opts in.
