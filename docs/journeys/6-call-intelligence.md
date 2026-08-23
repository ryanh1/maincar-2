# Doc 6 — Call Intelligence

Same format. This is the **analysis layer on top of a finished call**. The dialer already recorded the audio, ran live transcription (**job C2**), made a diarized post-call pass (**job C2b**), wrote the AI summary (**job C3**), and gave us the call-record page (**Journey 2.9**). This doc builds the *deep* experience on that raw material: a synced transcript+player, conversation analytics, comments, auto-matching, language, and the account timeline. Benchmark is **Gong**.

**Phase note:** phase tags are a draft. We re-sequence together later.

**Covers (from your list):** diarized transcript with speaker labels, a diarization visual, a timeline scrubber lined up with diarization, in-transcript text search, transcript↔audio sync, click-a-line-to-seek, active-word highlight, a Summary tab with regenerate, timestamped comments (CRUD + reply + deleted parents), @-mentions in comments, call metadata (duration, talk-ratio, longest monologue, interactivity), question counts per speaker, competitor-mention detection against a named list, auto-match of calls and emails to records, transcript language auto-detect, the account timeline, and a deal/account brief.

Under each journey: **Benchmark (beat this)** = the product to match, with a link where you can see how it works. **Build docs** = the page that tells the coding agent how to build it.

> **What this doc does NOT redefine.** Recording (job C1), live + diarized transcription (C2 / C2b), the summary generation (C3), the summary/extraction templates (Journey 2.7), and the two-column call-record page (Journey 2.9) already exist. This doc references them. **Q&A over a transcript or account lives in the AI Copilot pillar** — the timeline and brief here just cross-reference it.

> **Companion doc — [6a-meeting-video-intelligence.md](6a-meeting-video-intelligence.md).** This doc (6) is written for **phone calls**. **Recorded video meetings** (Zoom/Meet/Teams, via Recall.ai — recording specced in [doc 5](5-comms-email-and-calendar.md)) get the *same* experience — synced player, live in-meeting assist, structured extraction, comments/analytics, and timeline playback — plus the **bulletproof calendar-event ↔ recording matching** (doc 6a Journey 6a.7). Meetings reuse this doc's jobs (G1/G2/G3/G6) and the calling-core extraction as a `Call`-like source; 6a specifies only the video deltas.

---

## New surfaces this adds

- **Call record gains a real player+transcript UI:** the left transcript column (Journey 2.9) becomes interactive — synced highlight, click-to-seek, in-transcript search, and a diarization ribbon under the audio player.
- **Comments rail:** a Comments tab on the call record, each comment pinned to a timestamp.
- **Analytics strip:** a metrics panel on the call record (talk-ratio, monologue, interactivity, questions, competitors).
- **Account timeline tab** on a company/deal record: every call, email, meeting, SMS, note, task, and deal change in one stream, with a **Brief** button.
- **Briefs — a first-class object:** generated account/deal briefs (markdown body + metadata) get a per-account history **and** a global **Briefs** list view in the left navbar, plus a record view (Journey 6.10b).
- **Settings → Intelligence:** the call-intelligence settings home — **Tracked terms** (the vocabulary dictionary), **Language** (workspace default), and **Brief templates**.

---

## Journey 6.1 — Read the diarized transcript

*As a rep, I want to read a clean transcript with each speaker named, so that I can review who said what without listening to the whole call again.*

1. The user opens a call record (Journey 2.9). The left column shows the **final diarized transcript** (from job C2b).
2. **Speaker labels — we never call the other side "Customer"; they are a *Person*:**
   - **Our side** is labeled with **the user's own name** (the known user on that call leg — e.g. "Ryan"). **If we somehow don't have the user's name, the fallback label is "User"** (never "Rep", never "Customer").
   - **The other side** is labeled by **who we think they are** — usually knowable from the record the call is linked to (Journey 6.7). If we called Person A's number, the outside speaker is **Person A** by default (an educated guess from the linked record).
   - **Multiple outside speakers are supported.** If more than one person speaks on the other side, they start as **Person 1, Person 2, …**; the AI **upgrades a label to a real name when someone identifies themselves on the call** ("Hi, this is Dana from finance"), so labels sharpen as the conversation is understood. **The estimation algorithm is spelled out in Journey 6.1a below.**
   - A small avatar/initial sits in the gutter; the user can **rename or reassign** any speaker in one click — that re-labels the whole transcript and recomputes analytics (job G1).
3. **Where things sit on the page (left column of the two-column call record, Journey 2.9):**
   - **Top:** a pinned **audio player** — play/pause, a **10-second skip**, a **playback-speed** control, and a **numeric read-out** showing **current time / total duration** (e.g. `04:12 / 27:30`).
   - **Directly under the player:** the **diarization ribbon** (see step 4), spanning the full width of the column.
   - **Below the ribbon:** a **Search in transcript** box (step 6).
   - **Below that:** the scrolling **transcript body** — one turn per block: gutter avatar/initial + speaker name on the left, the turn's text on the right, a **turn timestamp** at the block's start.
4. The **diarization ribbon** is a thin horizontal band — **one color per speaker** (not just two). With many speakers, use distinct hues plus **shades of one hue for same-side people** (the user in green; all outside people in blues), so the shape stays readable. It spans the whole call so he sees who talked when.
5. The ribbon **is** the scrubber: it lines up 1:1 with the audio timeline, and clicking anywhere on it seeks (Journey 6.2). **On hover it shows a seek-time tooltip** (the timestamp under the cursor, e.g. `12:04`); a **playhead marker** rides along it during playback. The ribbon and player both show **hard numbers** — total call duration and the current seek/hover time — never just a bare bar.
6. He types in the **Search in transcript** box → matches highlight inline, a count shows ("3 of 12"), and Enter jumps between hits; each hit is also ticked on the ribbon.
7. **Responsiveness (must be tested at each breakpoint):** the ribbon, player, and transcript reflow for narrow widths. At **desktop** width the comments rail (Journey 6.4) sits to the right; at **tablet/narrow** widths the ribbon stays full-width and the comments rail collapses to a toggle; at the **smallest** width the player and ribbon stack and the transcript takes the full column. **QA includes an explicit screen-size / responsiveness pass** — the ribbon must never overflow the column or lose its 1:1 time alignment when resized.

- **Benchmark (beat this):** Gong — discover your new call page — https://help.gong.io/docs/discover-your-new-call-page
- **Build docs:** Deepgram — speaker diarization — https://developers.deepgram.com/docs/diarization ; Deepgram — utterances (turn segmentation) — https://developers.deepgram.com/docs/utterances

## Journey 6.1a — Estimate who each outside speaker is (identification algorithm)

*As the system, I want to guess each outside speaker's identity and sharpen it as the call unfolds, so that the transcript reads with real names instead of "Person 1".*

**Trigger:** runs as part of the diarized pass (job C2b) and again whenever the call's record match changes (job G3 / Journey 6.7). Two stages:

1. **Seed from the linked record (deterministic, no AI).** After the call is matched to a record (Journey 6.7, which reuses the doc-5 matcher), assign outside speakers from that record's contacts:
   - **One outside voice + one contact on the matched record** → label that voice with the contact's name (high confidence).
   - **One outside voice + several contacts** (e.g. a Company with 4 people) → keep it **Person 1** but hold the candidate list; don't guess a specific name.
   - **Several outside voices** → **Person 1, Person 2, …** in first-heard order.
2. **Sharpen with a name-extraction AI pass over the transcript.** A single cheap LLM call reads the diarized transcript and returns, per outside speaker, a name **only if the transcript states it** — self-introductions ("Hi, this is Dana from finance"), a colleague naming them ("Dana, can you take this?"), or a sign-off. It never invents a name.
   - **Model:** a small/fast model — **Claude Haiku 4.5** (`claude-haiku-4-5`) — because this is short, structured, latency-sensitive, and cheap; accuracy is bounded by what's literally said, so a larger model buys little. Backend-selectable like every other model (super-admin choice).
   - **Prompt summary (structured JSON output):** *"You are given a diarized call transcript with speakers labelled `user`, `person_1`, `person_2`, …. For each `person_N`, return `{ speaker, name, evidence, confidence }` where `name` is filled **only** if the transcript explicitly states that speaker's name (self-introduction, someone addressing them, or a sign-off). Quote the exact line as `evidence`. If no name is stated, return `name: null`. Never guess from context, company, or role. Output an array, one entry per outside speaker."*
   - **Reconcile:** if the AI's name (with evidence + confidence ≥ threshold) matches a candidate contact from step 1, promote to that contact (linked). If it names someone **not** on the record, show the name as a plain label with a one-click "add/associate this person" affordance.
3. **The user always wins:** a manual rename/reassign (Journey 6.1 step 2) overrides both stages and is marked confirmed; the AI never re-labels a confirmed speaker.

- **Build docs:** Deepgram — diarization (speaker turns) — https://developers.deepgram.com/docs/diarization ; internal — reuses the doc-5 matcher (Journey 5.2c) for the record match and the provider-agnostic AI layer (as in job C3).

## Journey 6.2 — Play the call, synced to the transcript

*As a rep, I want the transcript to follow the audio as it plays and let me click any line to jump there, so that I can move around the call fast.*

1. He presses play on the pinned audio player. As it plays, the **active transcript line auto-scrolls into view and highlights**.
2. Inside the active line, the **current word** highlights as it is spoken — driven by Deepgram word-level start/end times stored on each segment.
3. He clicks any transcript line → the audio **seeks** to that line's start and keeps playing.
4. He clicks the diarization ribbon → seeks to that point in time.
5. Playback speed and a 10-second skip are in the player; the highlight stays in sync at any speed.

- **Benchmark (beat this):** Gong — intro to the call page — https://help.gong.io/docs/intro-to-the-call-page
- **Build docs:** MDN — HTMLMediaElement.currentTime — https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime ; MDN — the `timeupdate` event — https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event

## Journey 6.3 — Read and regenerate the summary

*As a rep, I want to read the call's AI summary and refresh it on demand, so that I get an accurate recap without redoing it by hand.*

1. On the right column of the call record, the **Summary** tab shows the AI summary already produced by **job C3** (Overview, pain points, next steps, extracted fields — Journey 2.7). This doc does not re-generate it, it surfaces it.
2. Each summary line links to the transcript moment it came from → clicking it seeks (Journey 6.2).
3. **Regenerate is an icon button, not a text button:** a small **circular-arrow (↻) icon** in the top-right of the Summary panel, with a **"Regenerate" tooltip** on hover (keeps the panel header clean; matches how the brief and other AI panels expose regenerate). Clicking it re-runs **job C3** on the diarized transcript with the current template, and the panel updates in a few seconds. His hand-edits are preserved unless he confirms overwrite.
4. The model used is the super-admin's backend choice; there is no per-user model picker.

- **Benchmark (beat this):** Gong — review what happened in a call (Call Spotlight) — https://help.gong.io/docs/save-time-with-call-spotlight
- **Build docs:** internal — reuses job C3 from the calling-core doc; no third-party doc.

## Journey 6.4 — Comment on a moment

*As a rep or manager, I want to leave a comment pinned to an exact moment in the call and reply to others, so that coaching and follow-ups attach to the precise thing that was said.*

Layout and interaction chosen after studying Gong closely (the best here) and Attio.

1. **Where they live:** comments sit in a **right-hand rail** on the call record; the transcript is the left/center column (Gong's layout). We add a **draggable divider so the panes resize** — an improvement over Gong's fixed layout. (Side-swap isn't worth building.)
2. **Two ways to create:** (a) **select transcript text** → a floating **Comment** action pins it to that text's moment; or (b) click **Comment at the current playhead**. **A real comment always has a moment — we never default to 0:00** (Gong's weak spot).
3. **What a comment shows:** author **name + avatar**, the **audio-moment timestamp** it is pinned to (primary, **clickable**), and the **created-time** as secondary metadata ("2d ago"). Two different timestamps, both shown, the moment being the load-bearing one.
4. **Scroll behavior:** the comments rail scrolls independently, **and** as the playhead/transcript moves, the **nearest comment soft-highlights** — the sync Gong doesn't do.
5. **Click a comment → it both seeks the audio and scrolls the transcript** to that moment (and it's pinned on the ribbon).
6. He can **edit/delete** his own comment, **reply** (one level of threading), add **emoji reactions**, and **@-mention** a teammate (fires a notification via **job E3**; single-user-inert until teammates exist `[LATER]`).
7. **Deleted parent:** deleting a comment that has replies leaves a **tombstone** so replies keep their anchor and order; a leaf comment is removed outright.

**Anchor edge case (your Decision-2 point):** a comment is anchored to a **time offset in milliseconds**, not to a word/segment index — so if we **re-transcribe** later (different segmentation), the comment still lands at the same audio moment. (If we ever anchor to a text range for the "select text" case, we store both the ms and the char range, and the ms wins on re-transcription.)

- **Benchmark (beat this):** Gong — add a comment — https://help.gong.io/docs/add-a-comment ; intro to the call page — https://help.gong.io/docs/intro-to-the-call-page
- **Build docs:** TipTap — comments — https://tiptap.dev/docs/comments/getting-started/overview ; TipTap — mention extension — https://tiptap.dev/docs/editor/extensions/nodes/mention

## Journey 6.5 — See conversation analytics

*As a rep or manager, I want talk-ratio, monologue, interactivity, question, and competitor stats for a call, so that I can judge how it went and coach on specifics.*

1. On the call record the user opens the **Analytics** strip. It shows, computed by **job G1** off the diarized transcript:
   - **Duration** of the call.
   - **Talk-ratio per speaker** — % of talk time for each speaker, as a stacked bar. The headline is **the user (our side) vs. everyone else**; with multiple outside people it also breaks down per Person.
   - **Longest monologue** — the longest uninterrupted stretch, whose speaker, and where (a marker on the ribbon he can click to hear it).
   - **Interactivity** — a 0–10 score of how often the conversation switched back and forth.
   - **Questions asked** — a count **per speaker** (the user, and each Person), detected from the transcript.
2. A **Competitors** row lists any competitor names heard on the call (from **job G2**), each with a count and a click-to-seek to the moment it was said.
3. Every number links into the transcript so he can verify it, never a black box.

- **Benchmark (beat this):** Gong — talk-to-listen ratio — https://www.gong.io/blog/talk-to-listen-conversion-ratio ; Gong — keyword tracker FAQs (competitor tracking) — https://help.gong.io/docs/keyword-tracker-faqs
- **Build docs:** Deepgram — calculate talk-time analytics — https://developers.deepgram.com/docs/calculate-talk-time-analytics

## Journey 6.6 — Maintain the tracked-vocabulary dictionary (competitors + more)

*As an admin, I want to maintain the list of terms (competitors, products, objections) the system flags on calls, so that detection matches our business and stays accurate.*

Competitors are just **one category** of terms worth catching. This is a general **tracked-vocabulary dictionary** — competitors, our own products, common objections, key phrases — any vocabulary the AI should flag on a transcript.

**Placement (your point on Settings → Competitors):** *not* a lone "Competitors" page. It lives under **Settings → Intelligence → Tracked terms**, grouped with the other call-intelligence settings (dispositions, the summary/extraction templates of Journey 2.7). Competitors ships as the first built-in category.

1. In **Settings → Intelligence → Tracked terms**, the user manages **categories** (Competitors, Products, Objections, Custom…), each with a color and icon.
2. Within a category he CRUDs **terms**, each a **canonical name + aliases** ("Salesforce" / "SFDC" / "sales force"), so detection isn't fooled by spelling or spacing.
3. On the next diarized transcript, **job G2** flags each mention against every category and feeds the analytics (Journey 6.5): each hit is a colored chip (by category) with a count and click-to-seek.

*This generalizes competitor detection into keyword/vocabulary tracking, close to Gong's "Trackers." Smart-trackers and saved searches across the whole call library stay [LATER].*

- **Benchmark (beat this):** Gong — keyword tracker FAQs — https://help.gong.io/docs/keyword-tracker-faqs ; Nooks — configuring competitors [how it works: the competitor list as workspace config] — https://support.nooks.ai/articles/8913542083-configuring-competitors-in-nooks
- **Build docs:** internal — the workspace tracked-terms dictionary; detection method in tech choices.

## Journey 6.7 — Review and correct a call's record match

*As a rep, I want a call linked to the right Person/Company/Deal automatically, and an easy way to fix it when the system is unsure, so that my timeline is accurate without manual bookkeeping.*

> **This journey no longer defines its own matching algorithm.** An earlier draft scored candidates with weighted points (+0.6 email, +0.5 phone…) and a 0.7 confidence cut-off. **That is deprecated.** Calls, emails, and meetings all resolve through the **one shared deterministic matcher specced in [doc 5, Journey 5.2c](5-comms-email-and-calendar.md)** — an ordered, first-hit-wins match (exact email → exact phone → email domain → open-Deal heuristic → unmatched hold), which is closer to Gong, easier to explain, and already ≥98%-precision-gated in CI. A parallel points system here would be a second, conflicting engine for the same problem. So **6.7 keeps only what is genuinely call-specific and additive: the review UX and the learned per-identifier correction.**

1. **Matching itself** runs in the shared matcher (doc 5, Journey 5.2c), invoked for a call by **job G3** at call end. Phone is the call's strongest signal; otherwise it uses the same order as email/meeting matching. On a clean single hit the call **auto-links silently** and shows on the record's timeline. Ambiguity the matcher will not silently resolve (no hit, or a genuine tie such as a shared line) is **held, not guessed** — surfaced for review below.
2. **Low-confidence / needs-review UX (your A/B/C):** on the call record, a **"Needs match" banner** shows up to 2–3 ranked **candidate chips** (Person · Company · Deal), each with its reason ("matched acme.com; 2 open deals"):
   - **(A — the UI)** he clicks a chip to confirm, or **"Create new"** to make the record, or search to pick another. One click links the call and clears the banner.
   - **(B — when & where)** the banner appears right after **job G3** runs (call end). The same unresolved items also collect in an **"Unmatched activity" queue** (shared with email/meetings, doc 5) so nothing is lost if he skips the banner.
   - **(C — the trade-off)** deferring ambiguous matches trades a few manual confirms for near-zero wrong auto-links (a wrong attach is worse than a miss — the doc-5 precision bar). Aggressiveness is a property of the shared matcher, tuned once in doc 5, not a knob duplicated here.
3. **Shared-line / generic guard** is the shared matcher's (doc 5): generic mailboxes (`info@`, `support@`) and known shared/reception numbers don't resolve to a single person; those calls land in the review banner instead of auto-linking.
4. **Learned per-identifier correction (genuinely additive — kept here, powers the shared matcher).** When he confirms/overrides a match, we store the resolved **identifier → record** mapping (`MatchOverride`: email/phone → contact, domain → account) with a **"was this a shared line?" toggle**, and apply it to **future and backlogged** activity — so we never ask about that identifier again. This is stronger than doc 5's per-activity manual-attach freeze (line-item only): it fixes the **identifier** everywhere. *Because it benefits email and meetings too, `MatchOverride` is a shared-matcher input; it is defined here (Data model) but consumed by the doc-5 matcher — cross-referenced both ways so the two docs don't drift.* A manual link always wins and is marked confirmed.

- **Benchmark (beat this):** Gong — email/account matching — https://help.gong.io/docs/faqs-about-email-account-matching ; associate a call to an account/opportunity — https://help.gong.io/docs/associate-a-call-to-an-account-or-opportunity
- **Build docs:** internal — reuses the **doc-5 matcher (Journey 5.2c)** against the CRM Record store (People/Companies/Deals); this journey adds the review UI and the `MatchOverride` learning only.

## Journey 6.8 — Detect and render the transcript language

*As a rep on multilingual calls, I want each part of the transcript shown in the right language and script, so that a mixed-language call is still readable and searchable.*

1. **Detection is per-segment, not one dominant language** (your edge case). Real calls **code-switch** (English + Spanish in one call), so **job G4** detects language **per utterance** and stores a code on each segment, plus the call's dominant language.
2. **Rendering:** each segment renders in its **own script and direction** (RTL where needed — Arabic/Hebrew), so a mixed call reads correctly line by line instead of being forced into one language.
3. **The chip — reconsidered (your point: do we even need it?).** We **do not** show a persistent language chip on every call — most are the workspace's default language, so a chip there is just noise. We surface language **only when it matters**: a small indicator when a call is **non-default or mixed** ("2 languages"), and a **correction control in the overflow menu** (not a prominent chip) for the rare wrong detection, which re-renders the affected segments.
4. Low-confidence detection is stored with its confidence, so we can flag/keep it correctable rather than hard-commit.

**The "default language" this journey assumes — now spec'd (your point).** Steps 1 and 3 lean on a **workspace default language**. Here is how it is set and used:

- **Where it's set:** **Settings → Intelligence → Language** (grouped with the other call-intelligence settings). A single **"Default call language"** dropdown (searchable list of Deepgram-supported languages/codes), plus an **"Auto-detect language on every call"** toggle (default **on**).
- **Who sets it:** an **admin**. Journey: admin opens Settings → Intelligence → Language, picks the language, saves; the value is stored on the workspace and takes effect on the next call. Default seed is the workspace locale from onboarding (doc 1); English if unknown.
- **How it's used:** (a) it's the language a call is assumed to be when auto-detect is off or a segment's detection is low-confidence; (b) it defines "non-default" in step 3 — a call is flagged only when its dominant language differs from this setting or the call is mixed. There is **no per-user** language picker; per-call correction stays the overflow control in step 3.

- **Benchmark (beat this):** Gong — multilingual transcripts — https://help.gong.io/docs/intro-to-the-call-page
- **Build docs:** Deepgram — language detection — https://developers.deepgram.com/docs/language-detection ; Deepgram — supported languages — https://developers.deepgram.com/docs/models-languages-overview

## Journey 6.9 — See the full account timeline

*As a rep or manager, I want every call, email, meeting, text, note, task, and deal change on an account in one navigable timeline, so that I can catch up on the whole relationship in one place.*

On a Company or Deal record, the **Timeline** tab. Designed after studying Gong (the best — a real horizontal timeline) and Attio (a vertical feed). We keep Gong's horizontal band **and** add a synced feed. Built by **job G5**, which reads the **denormalized `CompanyActivity` feed from doc 4 (job E5)** so it opens fast.

1. **Orientation — a horizontal timeline band on top, a synced vertical feed below.** The band shows momentum at a glance; the feed is for reading. (Gong's horizontal band is its big edge over a plain feed — we keep it.)
2. **What the horizontal band looks like.** A left-to-right time axis across the top ~120px of the tab. Time runs oldest→newest, **today marked by a vertical "now" line**, future to its right. Events are **bubbles positioned by timestamp**; bubble **size = activity intensity** (a busy day is a bigger/denser bubble), **color = event type** (step 6). Two stacked **lanes** (step 4) sit inside the band; the **Deal ribbon** (step 5) runs just above them. Hovering a bubble shows a tooltip (type · title · date); clicking it scrolls the feed below to that item and opens its panel.
3. **What the vertical feed looks like (your "I don't understand the vertical" point).** Below the band is a **single vertical column, newest at top** — the **same visual grammar as the CRM record timeline (Journey 4.11)** so the app has one feed style. Each row: a **type icon** on the left, a one-line **title/summary**, the **actor** (avatar), and a **relative timestamp** on the right; **day separators** ("Today", "Yesterday", "Aug 12") group rows. Long rows show a 2-line preview with **"See more"**. The band and feed are **synced two ways**: scrolling the feed moves a highlight along the band; clicking a band bubble scrolls the feed. Changing the duration picker (step immediately below) reframes **both** together. So: **band = the map, feed = the reading view of the same events.**
4. **Duration picker (horizontal selectors):** **day / week / month / quarter / year / 5Y / all-time**, with **arrows to pan** and **click-a-bubble-to-zoom**. The default range is chosen by the logic below.
5. **Lanes:** two primary bands — **Outbound (us)** and **Inbound (them)**. Each band **expands into per-person sub-lanes** (one row per outside contact, one per internal rep) — the per-person view Gong lacks. Default collapsed to the 2-band view.
6. **A dedicated Deal ribbon above the lanes:** deal **created / stage-moved / closed-won / closed-lost** as flag markers, color-coded (won green, lost red) — clearer than Gong burying stage changes in generic "CRM updates."
7. **Every event type on the timeline (your 6.9.5 "what else?" — aligned with the CRM timeline in Journey 4.11 so the two never diverge):**
   - **Interactions:** call (green phone), email (blue envelope, sent vs received tint), meeting/calendar event (purple), **SMS (teal chat)**, voicemail.
   - **CRM activity:** **note** (gray 📝), **task** (created / completed — checkbox icon; tasks are future-or-done items from doc 4d, distinct from past interactions), **field/stage changes** (amber flag; deal stage changes also surface on the Deal ribbon, step 6).
   - **Object lifecycle events (your explicit ask):** **record created** — a low-weight marker when a **Person, Company, or Deal is created** on this account ("Deal created", "Contact added"). **Deal creation is the entry into the pipeline and shows on the Deal ribbon.** **Deletions are *not* timeline events** — a deleted record leaves the feed rather than posting a "deleted" row (a deletion is administrative noise on a relationship timeline; the audit log in doc 5a keeps the record of it). Exception: if an **open Deal is deleted/lost**, that already shows as closed-lost on the ribbon.
   - **Custom objects:** any related **custom object** the admin has opted into the timeline (doc 4a Journey 4a.9) posts with a **generic entry shape** (icon · title · timestamp · link) — the same generic renderer as Journey 4.11, so a new object kind needs no new timeline code.
   - **Does "record created" count as a stage-change event? (your sub-question.)** For a **Deal**, yes — *created* is its own marker on the Deal ribbon and is the deal entering its first stage; we show *created* and later *stage-moved* as distinct markers (created is not double-counted as a stage move). For **non-Deal** objects (Person/Company), *created* is just a low-weight feed marker, **not** a stage event — those objects have no pipeline stage.
8. **Click an item → a right-side detail panel. This is where "what the content looks like" is decided (your Gong-parity ask; also the gap you flagged in doc 5). One panel, per-type body:**
   - **Email:** from/to/cc, subject, date, and the **full body rendered inline** — with the **reply-quote auto-collapsed** behind a "show trimmed content" toggle and attachments listed. Reply/Forward opens the composer (doc 5). *We show the real email, not just a "an email was sent" stub.*
   - **Call:** a **card that opens an inline player + transcript** in the panel (diarization ribbon, click-to-seek, search — the Journey 6.1/6.2 experience in miniature), plus **"Open full call"** deep-linking the call record (Journeys 6.1–6.5).
   - **SMS:** the **thread rendered as chat bubbles** (ours right/them left), timestamps, delivery status, and a reply box (doc 3) — not a single-line stub.
   - **Meeting:** title, attendees, time, agenda/notes, and — if recorded — the **recording + transcript** inline (doc 5 Journey 5.10), same call-style card.
   - **Note:** the **full note body** (read-only HTML; click to edit → Journey 4.13).
   - **Task:** title, due date, assignee, status, and linked records; complete/reopen inline.
   - **Field/stage change:** a compact **before → after** diff ("Stage: Discovery → Proposal", actor, time).
   - **‹ › chevrons** step to previous/next item, and **keyboard shortcuts** (←/→ items, J/K in the feed, Esc to close) — both missing from Gong. Drill-ins open this **panel, not a full-page jump**, so he keeps his place.
9. **Filter the feed by type** (calls / emails / meetings / SMS / notes / tasks / changes / custom …) and, on a Company, by **contact** and **deal**; the filter selection is **remembered per account** (Attio's best idea).
10. **Navigation:** a tabbed record header (Activity / Notes / Deals), breadcrumb back to the list.
11. It **reconciles with — does not duplicate —** the CRM record timeline (Journey 4.11): **one matched-activity source (the doc-4 `CompanyActivity` feed), two views** (4.11's compact record feed and 6.9's band+feed account view). Same events, same detail panels, no drift.

**Default-duration logic** — the tightest range with meaningful density, biased to recent + near-future. Evaluated top-down; the first rule that applies wins:
1. **If an open Deal exists →** frame the window as **deal-created (left edge) → the furthest future scheduled item (right edge)**, then snap to the smallest preset that *contains* that window. **Your "what if events/tasks are scheduled beyond +2 weeks?" fix:** the right edge is **not** a fixed +2 weeks — it extends to the **latest scheduled call, meeting, or task** on the account (or +2 weeks, whichever is later), so a demo booked six weeks out is visible. If that stretches past a preset, snap up (month → quarter → …).
2. **Else (no open Deal) →** pick the **shortest preset whose window (ending at "now") contains at least ~10 activity events.** Concretely: check **week** first — if the last week holds ≥10 events, use week; else try **month**, then **quarter**, then **year**. This keeps the default view **dense enough to be useful** rather than a mostly-empty long span. ("~10" is a tuning constant, not exact.)
3. **Always keep upcoming scheduled items in view:** whatever preset rules 1–2 pick, **extend the right edge** so any near-future scheduled call/meeting/task still shows (you should never open the timeline and miss a meeting booked for tomorrow). **Clamp the left edge to the account's creation date** (never render empty time before the account existed). **If the account is new or sparse** (too few events for rule 2 to find ~10), **fall back to all-time** so a thin account shows everything it has rather than a blank week.
4. **Manual override, reconsidered (your staleness point — you were right to doubt "remember forever").** We **do not** persist a manual duration override indefinitely. Instead:
   - Within a **session / short window**, remember his last pick for that account (so panning away and back doesn't reset him).
   - On a **fresh visit after the window has passed (default ~30 days)**, we **recompute the smart default** from rules 1–3 rather than reusing a stale pick — because, as you noted, an override chosen months ago for a deal that has since closed (or a goal that has since changed) is usually the *wrong* frame now. The recomputed default reflects the account's current state.
   - The current range is always one click to change, and a subtle **"Reset to default"** control lets him drop back to the computed frame anytime. *(This replaces the earlier "remember the override per account forever" rule.)*

- **Benchmark (beat this):** Gong — track activity with the account page — https://help.gong.io/docs/track-activity-with-the-accountpage ; intro to the account page — https://help.gong.io/docs/intro-to-the-account-page ; Attio — activity timeline — https://attio.com/changelog/2026/new-activity-timeline
- **Build docs:** internal — reads the doc-4 `CompanyActivity` feed (job E5); unions Calls, emails, meetings, SMS, notes, tasks, record-created markers, and stage-changes; detail panels reuse the per-type readers from docs 2/3/4/5.

## Journey 6.10 — Generate a deal / account brief

*As a rep or manager, I want a one-click written brief of where an account/deal stands, so that I can walk into a call or forecast review prepared without re-reading months of history.*

1. **Where the Brief button is.** On the account/deal record's **Timeline tab header**, top-right, next to the duration picker: a **"Brief" button** (primary/filled) with a dropdown caret to pick a template (defaults to the workspace default template, Journey 6.10a). It also appears on the **Deal record header**. Clicking it opens a **generating state** (skeleton with the section titles), then the finished brief.
2. **Also a Copilot skill (your ask).** The same generator is exposed as an **AI Copilot skill** (doc 7) — the user can type *"brief me on Acme"* / *"prep me for the Acme call"* in the chatbot and get the same brief, using the same job G6 and templates. The button and the skill are **two entry points to one generator**, not two implementations.
3. **What G6 reads (your ask — read more than interactions).** G6 does **not** read only call/email/meeting transcripts. It reads a **structured account bundle**:
   - **The structured Deal object(s)** — stage, amount, close date, owner, and **stage history** (how the deal has moved), plus any custom deal fields.
   - **The People objects** — contacts, roles/titles, who's the champion/economic-buyer if tagged, last-contacted per person.
   - **The Company object** — firmographics/custom fields.
   - **The interactions** — calls (with their summaries/analytics from G1/G3), emails, meetings, SMS, notes.
   - **Open tasks & upcoming meetings** — so "next steps" reflects what's actually scheduled.
   This mix is what lets the brief say "the deal slipped from Proposal back to Discovery on Aug 3" (structured) alongside "the champion raised pricing concerns on the last call" (interaction). Each claim is **linked back to its source** (a field change, a call moment, an email).
4. **What a brief says and looks like (your "more about what one might say / how it looks").** A brief is a **structured, sectioned document** rendered as clean markdown, each section a heading with tight bullets and **inline source links**. Default sections and the kind of content:
   - **TL;DR / Status** — 2–3 sentences: stage, amount, close date, momentum. *"Acme — $48k, Proposal, target close Sep 30. Momentum slowing: 9 days since last contact after 3 calls in the prior two weeks."*
   - **Key people** — each stakeholder, role, stance. *"Dana Cole — VP Finance, economic buyer. Pushed back on annual pre-pay on the Aug 12 call [link]."*
   - **Where it stands / open risks** — *"Risk: no meeting booked past today. Risk: legal not yet engaged; competitor ‘Northstar' mentioned twice [links]."*
   - **Next steps** — concrete, tied to open tasks/meetings. *"Send revised pricing (task due Fri). Get intro to Security. Book a mutual-action-plan review."*
   - **(Optional, template-driven)** Competitors mentioned, Timeline recap, Custom sections.
   Sections, order, per-section instructions, and length are all set by the template (6.10a). A **regenerate control** sits top-right of the brief as an **icon button (↻) with a "Regenerate" tooltip** (matching Journey 6.3), not a text button. Model = super-admin backend choice; **suggested default: a strong reasoning model (Claude Sonnet 5, `claude-sonnet-5`)** — a brief is long-context synthesis where quality matters more than latency, and it runs on demand (not per-call), so the cost is acceptable. Backend-selectable.
5. **Ask-anything Q&A over the account** is not built here — cross-reference to the **AI Copilot** pillar (doc 7).

**Sub-journeys:**

- **6.10a — Configure brief templates/instructions.** In **Settings → Intelligence → Brief templates**, he CRUDs named templates: which **sections** the brief includes (Status, Risks, Next steps, Key people, Custom…), **per-section instructions**, and length — reusing the template pattern of the summary/extraction editor (Journey 2.7). He sets a **default**; a brief can be generated from any template.
  - **Reference examples to seed the default template & prompt (your ask — real, public references).** The default sections mirror how strong sales teams already structure deal reviews, so we prompt against a known-good shape rather than inventing one. Use these as prompt scaffolding and as the seed template: **Gong's AI Briefer** (what a call/account catch-up should cover) — https://help.gong.io/docs/catch-up-quickly-with-the-ai-briefer ; **MEDDIC/MEDDPICC deal-review structure** (Metrics, Economic buyer, Decision criteria/process, Identify pain, Champion + a mutual action plan) — Dock's MEDDIC template https://www.dock.us/templates/meddic-sales and Recapped's MEDDICC deal-management template https://www.recapped.io/templates/meddicc-deal-management-template-curated-by-david-weiss ; a MEDDIC executive-summary layout — https://qwilr.com/templates/meddic-sales-template/. The prompt tells the model to fill these sections **only from the account bundle (step 3)** and to leave a section thin/blank rather than invent — every claim must carry a source link.

- **6.10b — A brief is a first-class object (your ask — treat it like a standard object).** Reconsidered from "just a saved render": **a brief is a stored object = metadata + a markdown body.** Concretely:
  - **Shape:** `AccountBrief` (Data model) holds a **markdown/rich body** plus **metadata** (account, template, model used, created-at, author, edited-flag, the source-id list). Think "a markdown artifact with a metadata header" — exactly your instinct.
  - **Record view:** opening a brief shows a **metadata header** (account, template, model, date, edited badge) above a **large markdown reader** with the inline source links — the "giant markdown reader" you described.
  - **List view:** a **Briefs** view. Two entry points: (a) a **Briefs list on the account/deal record** (history for that account), and (b) a **global "Briefs" item in the left navbar** listing all briefs across accounts, with columns (Account · Template · Model · Author · Created) — a standard object list view, filterable/sortable like any other list (doc 4c).
  - **AI-searchable:** briefs are indexed like other records, so the Copilot / global search (doc 4e / doc 7) can find "the Acme brief from last week."
  - A brief is a **snapshot**, not an ephemeral render: regenerating creates a **new** brief (history is kept), so you can compare how an account read two weeks apart.

- **6.10c — Edit / delete / share / export (your ask — the exact controls & steps).** On an open brief's record view, a **toolbar sits top-right of the metadata header**: **Edit** (pencil), **Regenerate** (↻, tooltip), **Share** (link icon), **Export** (download icon), and an **overflow (⋯)** holding **Delete**.
  - **Edit:** it is a **markdown/rich-text editor (TipTap, the same editor as notes)** — the reader turns editable in place. Exposed controls: **headings, bold/italic, bullet/numbered lists, links, and source-link chips** (a deliberately small toolbar — a brief is prose, not a document-publishing tool). **Steps:** click **Edit** → body becomes editable → he changes text → **Save** (or **Cancel**). Saving stamps `isEdited=true`, records the editor + time, and **his edits are preserved across a later Regenerate** (regenerate creates a new brief; the edited one is kept in history).
  - **Delete:** overflow (⋯) → **Delete** → confirm dialog ("Delete this brief? This can't be undone.") → removed from the list. (Deleting a brief is not a timeline event, per Journey 6.9.7.)
  - **Share:** **Share** → a panel with **"Copy read-only link"** (a link to the brief record; **teammate access is `[LATER]` until multi-user**, doc 11) and copy-to-clipboard of the markdown. Solo-user today: copy works; a shared teammate link is gated behind teams.
  - **Export:** **Export** → **PDF** (rendered brief with header) or **Copy as markdown**. Export works solo now.

- **Benchmark (beat this):** Gong — catch up quickly with AI Briefer — https://help.gong.io/docs/catch-up-quickly-with-the-ai-briefer
- **Build docs:** internal — reuses the provider-agnostic AI layer (backend-selected model); structured output via JSON-schema, as in job C3; body stored/rendered as markdown; list + record views reuse the CRM object views (doc 4c) and the TipTap editor (doc 4d).

---

## Background jobs

All jobs run on the shared pg-boss runner (doc 12). Each states its trigger, steps, and pg-boss params.

- **G1 — Compute call metrics.** **Trigger:** the diarized pass (C2b) completing. **Steps:** compute talk-ratio, longest monologue, interactivity, and question counts off the segments + word times; upsert one `CallMetrics` row. Also re-runs when the user renames/reassigns a speaker (Journey 6.1). **pg-boss:** queue `call-metrics`, `retryLimit: 3` with backoff, **`singletonKey = callId`** (one metrics job per call; a rename supersedes the prior run), idempotent on `callId` via the `@unique`. Seconds after the call.
- **G2 — Detect competitor/tracked-term mentions.** **Trigger:** same completion event as G1 (enqueued together). **Steps:** scan the diarized transcript against the workspace tracked-terms dictionary (canonical + aliases, whole-token), write a `TermMention` per hit with timestamp + speaker. **pg-boss:** queue `term-detect`, `retryLimit: 3`, **`singletonKey = callId`**, idempotent (delete-then-insert this call's mentions on re-run).
- **G3 — Match a call to a record.** **Trigger:** call end (after C2b); **also** re-runs on the doc-5 retroactive-rematch event (Journey 5.2e) when new CRM data appears. **Steps:** invoke the **shared doc-5 matcher (Journey 5.2c)** for the call's participants (phone-first, then the standard email → domain → open-Deal order), consulting any `MatchOverride` for a learned identifier. A clean single hit **auto-links**; no hit or a genuine tie is **held and surfaced for review** (the "Needs match" banner + Unmatched-activity queue, Journey 6.7) — never silently guessed. Confirmed corrections write a `MatchOverride` so it never re-asks. **pg-boss:** queue `call-match`, `retryLimit: 5` with backoff (transient CRM reads), **`singletonKey = callId`**. *(G3 defines no scoring of its own — the deprecated points system is gone; it calls the one matcher, per Journey 6.7.)* Seconds.
- **G4 — Detect language.** **Trigger:** runs **inline inside the transcription pass (C2/C2b)**, not as a separate queue — Deepgram returns per-utterance language, so we store it on each `TranscriptSegment` and the dominant code on `Transcript` as part of C2b's write. **No new pg-boss job.** A call is flagged non-default only against the workspace default language (Journey 6.8).
- **G5 — Assemble the account timeline (read-time, not a materialization job).** **Per Decision 5 there is no separate sync/materialization job now:** when a user opens the Timeline tab (Journey 6.9), G5 is a **read-time query** that unions the account's activity from the doc-4 `CompanyActivity` denormalized feed (kept current by doc-4 **job E5**, not by us). So G5 is a query path, not a pg-boss queue. *(If read volume later forces materialization, a `timeline-materialize` queue with `singletonKey = accountRecordId` is the drop-in — deferred, Decision 5.)*
- **G6 — Generate account/deal brief.** **Trigger:** on demand — the **Brief** button or the Copilot skill (Journey 6.10). **Steps:** gather the structured account bundle (Deal object(s) + stage history, People, Company, interactions, open tasks/meetings), call the backend LLM with the selected `BriefTemplate`, persist a new `AccountBrief` row with per-claim source links. **pg-boss:** queue `account-brief`, `retryLimit: 2` (LLM calls are costly — fail fast to the UI), **no singleton** (a user may deliberately regenerate; each run is a new snapshot), a longer `expireInSeconds` for model latency. A few seconds.

*(In-transcript text search (Journey 6.1) is client-side over the loaded segments; cross-call transcript search reuses the CRM search index, job E2 — neither is a background job.)*

---

## Decisions for you (call intelligence)

**All decided — your answers folded in.**

**1. The diarization visual? — Decided: a timeline ribbon + color-coded turns, with ONE color per speaker** (not two). One hue per speaker, and **shades of one hue for same-side people** (the user in green; outside people in blues), so multi-speaker calls stay readable (Journey 6.1). The ribbon doubles as the scrubber.

**2. Active-highlight granularity? — Decided: word-level highlight**, **plus a current-segment indicator** — a highlighted bar in the gutter beside the active turn — so it's easy to navigate to the right spot. **Comment anchoring (your edge case):** comments are pinned to a **time offset in ms, not a word/segment index**, so a re-transcription keeps them in place (Journey 6.4).

**3. Comments in the data model? — Decided (you agreed): a dedicated `CallComment` model** with a ms anchor and self-referential replies.

**4. Competitor/vocabulary detection? — Decided (you agreed): a maintained keyword list with alias normalization** now (now generalized to a tracked-vocabulary dictionary, Journey 6.6); optional LLM assist later.

**5. Account timeline storage? — Decided: compute it on read now; store a copy only later if needed. (Plain-language rewrite of "a query/view now, materialize later," your clarify.)** What this means:
- **Now:** when someone opens the timeline, we **build it on the fly** by querying and unioning the account's existing activity — specifically by reading the **doc-4 `CompanyActivity` denormalized feed (job E5)**, which is already kept current. There is **no separate "timeline" table** to keep in sync, and **no extra sync job** — the timeline is a *view* over data we already maintain. That keeps reads fast and avoids a second copy that could drift.
- **Later ("materialize"):** if an account ever has so much activity that building the view on each open is slow, we would **precompute and store the timeline as its own table** (a materialized copy) and refresh it in the background. We are **not** doing that yet because the E5 feed already opens sub-100ms. "Materialize" = "save a precomputed copy"; we're deferring that until read volume proves it's needed.

**6. Auto-match aggressiveness? — Decided: use the shared doc-5 matcher; no separate scoring here. (Revised per your earlier comments on matching.)** The earlier "auto-link ≥ 0.7 confidence, propose below" **points system is deprecated** — it duplicated, with a different and worse algorithm, the **deterministic ordered matcher already specced in doc 5 (Journey 5.2c)** that also powers email and meeting matching. Aggressiveness is now a property of that **one** matcher, tuned once in doc 5 (≥98%-precision-gated). **Journey 6.7** keeps only the call-specific pieces: the "Needs match" review banner + candidate chips + "Unmatched activity" queue (for items the matcher won't silently resolve), and the **learned per-identifier `MatchOverride`** so we never re-ask about an identifier. (This is what "stage candidates" meant — **hold and propose** for review, not a pipeline stage.)

---

## Technology choices (where it is not obvious)

Builds on the prior stack (React + Vite SPA + TS API, Twilio, Deepgram, Postgres+Prisma, TipTap).

- **Word timestamps + diarization source — Deepgram (already chosen in calling-core).** *Options:* Deepgram vs. AssemblyAI. The calling-core doc already picked **Deepgram** for streaming (C2) and diarized prerecorded (C2b), and it returns per-word start/end times we reuse for the active-word highlight. No new vendor. *AssemblyAI stays the noted fallback for diarization quality.*
- **Talk-ratio / interactivity / monologue — a server job over the diarized transcript, not a vendor metric.** *Options:* trust a vendor's analytics vs. compute our own. **Pick: compute in job G1** from segment speakers + word times — talk-ratio = summed speaking time per speaker; longest monologue = longest single-speaker run; interactivity = speaker-switch rate; questions = sentences ending in "?" plus interrogative openers. We own the definitions so they match what we show reps.
- **Competitor detection — a keyword list with alias normalization (Decision 4).** *Options:* keyword list vs. embeddings vs. LLM. **Pick: keyword list** (lowercase, strip punctuation, match canonical + aliases as whole tokens). Deterministic and explainable; LLM assist is a later add for paraphrase.
- **Transcript search — Postgres full-text for cross-call; in-memory for in-call.** *Options:* Postgres FTS vs. a search service. **Pick: reuse the CRM Postgres FTS index (job E2)** for "find this word across all calls"; the single-call search (Journey 6.1) runs client-side over already-loaded segments. Moving to Typesense/Meilisearch later stays a drop-in, as noted in the CRM doc.
- **Audio↔transcript sync in the browser — the native media element + `timeupdate`.** *Options:* a heavy waveform library vs. the plain `<audio>` element. **Pick: `HTMLMediaElement`** — bind `timeupdate` to a binary-search over word start times to pick the active word, and set `currentTime` on click-to-seek. The diarization ribbon is our own lightweight SVG over segment times, not a full waveform.

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. **New models are marked `// NEW`; `// added` fields extend existing models.** Existing models referenced but not redefined: `Call`, `Recording`, `Transcript`, `TranscriptSegment`, `CallSummary`, `Record`, `ObjectDef`, `Note`, `Notification`.

```prisma
model Call {
  // ...existing fields, plus:
  metrics            CallMetrics?          // added (Journey 6.5)
  comments           CallComment[]         // added (Journey 6.4)
  termMentions       TermMention[]         // added (Journey 6.5/6.6)
  matches            CallMatch[]           // added (Journey 6.7)
}

model Transcript {
  // ...existing fields, plus:
  language        String?   // added: detected language code (Journey 6.8 / job G4)
  langConfidence  Float?    // added
}

model TranscriptSegment {
  // ...existing fields, plus:
  wordsJson  Json?    // added: [{ word, startMs, endMs }] for active-word highlight (Journey 6.2)
  language   String?  // added: per-segment language for code-switching calls (Journey 6.8)
  speaker    String   // stable internal key: "user" | "person_1" | "person_2" ... (N speakers).
                      // DISPLAY label resolves at render: "user" -> the call user's own name
                      // (fallback "User"); "person_N" -> the matched/AI-estimated name (Journey 6.1/6.1a).
}

model CallComment {          // NEW — Journey 6.4 (timestamp-anchored, threaded)
  id         String   @id @default(cuid())
  callId     String
  authorId   String
  atMs       Int              // timestamp anchor on the call
  bodyJson   Json             // TipTap rich text (holds @mentions)
  parentId   String?          // self-ref reply; null = top-level
  isDeleted  Boolean  @default(false) // tombstone when a parent w/ replies is deleted
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model CallSpeaker {          // NEW — Journey 6.1a (who each voice is)
  id          String  @id @default(cuid())
  workspaceId String
  callId      String
  speakerKey  String        // the transcript's stable key: "user" | "person_1" | ...
  displayName String?       // null => render "Person N", never a guess
  recordId    String?       // the CRM record this voice was matched to, if any
  source      String  @default("seeded") // seeded | ai | manual
  evidence    String?       // the quoted line that justified an AI name — shown, not just logged
  confidence  Float?
  isConfirmed Boolean @default(false) // a manual rename; the AI never re-labels it
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([callId, speakerKey])
  // The transcript stores the KEY and this stores the LABEL, deliberately: renaming a
  // speaker updates ONE row here instead of rewriting every segment. A display name in
  // `TranscriptSegment.speaker` would make a rename a data migration.
}

model CallMetrics {          // NEW — Journey 6.5 / job G1 (one per call)
  id                 String  @id @default(cuid())
  callId             String  @unique
  durationS          Int
  talkRatioJson      Json     // per speaker key: { "user": 0.43, "person_1": 0.42, "person_2": 0.15 }
  longestMonologueMs Int
  monologueSpeaker   String   // speaker key, e.g. "user" | "person_1"
  monologueAtMs      Int      // where it starts (click-to-seek)
  interactivity      Float    // 0–10
  questionsJson      Json     // per speaker key: { "user": 6, "person_1": 3 }
  computedAt         DateTime @default(now())
}

model TrackedTermCategory {  // NEW — Journey 6.6 (Competitors, Products, Objections, Custom…)
  id          String @id @default(cuid())
  workspaceId String
  name        String        // "Competitors" | "Products" | ...
  color       String
  icon        String?
  termsJson   Json          // [{ canonical: "Salesforce", aliases: ["SFDC","sales force"] }]
}

model TermMention {          // NEW — Journey 6.5/6.6 / job G2 (generalizes competitor mentions)
  id          String @id @default(cuid())
  callId      String
  category    String        // which tracked category matched
  canonical   String        // canonical term matched
  termMatched String        // the exact alias/token heard
  atMs        Int           // where in the call (click-to-seek)
  speaker     String?       // speaker label
}

model CallMatch {            // NEW — Journey 6.7 (call ↔ record link produced by the doc-5 matcher)
  id          String  @id @default(cuid())
  sourceType  String        // "call" | "email"  (email links live in doc 5; shared shape)
  sourceId    String        // Call.id or email id
  objectSlug  String        // "people" | "companies" | "deals"
  recordId    String        // -> Record / concrete table
  method      String        // "number" | "email" | "domain" | "manual" (which matcher rule hit)
  isConfirmed Boolean @default(false) // manual/accepted match wins
  createdAt   DateTime @default(now())
  @@index([sourceType, sourceId])
  // NOTE: no confidence score — the doc-5 matcher (Journey 5.2c) is deterministic/first-hit-wins,
  // not points-based. `method` records which ordered rule matched.
}

model MatchOverride {        // NEW — Journey 6.7 (learned correction: never re-ask)
  id          String  @id @default(cuid())
  workspaceId String
  identifier  String        // an email or E.164 phone
  identifierKind String     // "email" | "phone"
  isSharedLine Boolean @default(false) // if true, phone never resolves to a single person match
  objectSlug  String        // resolves to this object...
  recordId    String        // ...and this record
  @@unique([workspaceId, identifier])
}

model BriefTemplate {       // NEW — Journey 6.10a (configurable brief sections)
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  sectionsJson Json          // [{ title, instructions, length }]
  isDefault   Boolean @default(false)
}

model AccountBrief {         // NEW — Journey 6.10 / job G6 (a first-class object: markdown body + metadata)
  id             String   @id @default(cuid())
  workspaceId    String
  accountRecordId String        // Company or Deal record
  templateId     String?        // which BriefTemplate produced it (6.10a)
  bodyMarkdown   String         // the brief as markdown (rendered in the record view's markdown reader)
  sourceLinksJson Json          // per-claim source links resolved in the body (call moments, fields, emails)
  authorId       String         // who generated it (for the Briefs list view, 6.10b)
  isEdited       Boolean  @default(false) // human edits preserved over regenerate (6.10c)
  editedById     String?        // who last edited
  editedAt       DateTime?
  modelUsed      String?        // provenance (super-admin-set model)
  sourceIdsJson  Json           // the account-bundle items the brief drew from (deal/people/interactions)
  createdAt      DateTime @default(now())
  // A brief is a snapshot: Regenerate creates a NEW row, history is kept (6.10b).
}

// AccountTimelineEntry is intentionally NOT a table by default (Decision 5):
// the timeline is a query/view unioning matched Calls, emails, and meetings.
// Materialize into a concrete model later only if read volume demands it.
```

## Technical decisions, trade-offs & edge cases

- **Diarization is imperfect.** Even a good diarizer mislabels on crosstalk and short backchannels ("mm-hm"), and can over- or under-count speakers. We anchor the **user's own name** label to the user's known call leg (not a guess; fallback "User"), label the rest **Person 1..N**, and let the user **rename or reassign any speaker** in one click — which re-labels the whole transcript and recomputes G1. The AI also promotes a "Person N" to a real name on self-identification (Journey 6.1).
- **Word highlight needs word timings.** The active-word highlight is only as good as Deepgram's per-word `start/end`; we store them on the segment (`wordsJson`) so the browser never re-fetches. If a segment lacks word times (rare/live-only), we fall back to line-level highlight for that segment.
- **Competitor list is user-owned, and false positives are the real risk.** Whole-token, alias-aware matching avoids "we're not *sales*-focused" tripping "Salesforce"; the user curates aliases (Journey 6.6). We store the exact matched token so a wrong hit is one click to inspect and suppress.
- **Auto-match ambiguity — shared numbers.** When multiple contacts share a number (shared line, reception, a couple on one cell), the shared matcher does **not** silently pick; the call surfaces in the "Needs match" review banner (Journey 6.7, step 2) and a confirmed choice is remembered per identifier via `MatchOverride` so it only asks once.
- **Language detection can be wrong or mixed.** Code-switching and short calls fool detection; we store confidence, expose a per-call correction control in the overflow menu (Journey 6.8, step 3), and re-render on correction rather than hard-committing.
- **Comment threads with deleted parents.** Deleting a parent that has replies writes a tombstone (`isDeleted`) so replies keep their anchor and order; only childless comments hard-delete. This is why comments are their own model, not CRM `Note`s (Decision 3).
- **Timeline reconciles, does not duplicate.** The account timeline (Journey 6.9) unions the same matched activity the CRM record timeline (Journey 4.11) shows — one source, two views — so a call never appears twice or drifts between them.
- **No change forced to earlier docs.** This layer consumes C2b/C3 and Journey 2.9 as-is. The only *extension* is `wordsJson` on `TranscriptSegment`: the calling-core diarized pass (C2b) must now persist per-word times, which Deepgram already returns — a storage add, not a decision reversal.

*(Later-phase call-intelligence items — trackers/smart-trackers, sentiment/topic segmentation, call library + clips, rep scorecards, shared call links, AI roleplay coaching, filler-word detection — are parked in the [backlog](14-backlog.md) under "Call intelligence at scale," with their value stated, so nothing is lost.)*
