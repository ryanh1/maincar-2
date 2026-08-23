# Doc 3a — Dialer at Scale: voicemail, numbers, SMS, transfer & compliance

Second of the "at scale" docs (doc 3 = import + call lists + power dial; **doc 3b** = analytics). Same journey format as doc 1: each journey has a one-line user story, chronological steps, an entry point, benchmarks, and edge cases broken out.

**Journey numbers are stable across the split** — 3.14c here is the same 3.14c other docs already link to.

**Contents:**
- **A. Voicemail drop** — library (3.5), transcription (3.5a), dropping (3.6).
- **B. Numbers** — local presence (3.7), number health (3.8).
- **C. SMS** — send (3.10), 10DLC registration (3.10a), opt-out/STOP (3.10b), templates (3.11), inbox + media + reactions (3.11a).
- **D. Live conversation tools** — warm transfer (3.13), presence (3.13a), notifications (3.13b), hold (3.13c).
- **E. Browser extension** (3.12).
- **F. Compliance & hygiene** — Do-Not-Contact (3.14a), calling hours (3.14b), dead/unreachable contact points (3.14c), dial-order fields (3.14d).
- Legal note (internal), background jobs, data model, tech choices.

**One rule applied throughout this doc (your call):** users set their **own** settings; **we (the super-admin app builders) ship the factory defaults.** There is no "admin sets team defaults for other users" tier anywhere in doc 3.

---

# A. Voicemail drop

## Journey 3.5 — Build and manage your voicemail-drop library

*As a rep, I want a small library of pre-recorded voicemails I can drop in one tap, so that I don't re-record the same message by voice on every no-answer.*

Full CRUD — you asked for playback and delete, a default, and where the audio lives.

1. **Entry point.** Settings → Dialer → **Voicemail drop** (grouped with the other dialer settings, not a lone page).
2. **Create.** He clicks **New drop**, then either **records in the browser** (mic, a simple record/stop/re-record control) or **uploads an audio file** (`.mp3` / `.wav`). He names it ("Intro — no answer"). Save.
3. **Read (the library list).** Each saved drop is a row: **name · duration · a ▶ play button · a one-line transcript · a ☆ default star**. This is the list he picks from mid-call (Journey 3.6).
4. **Play.** He clicks **▶** to hear the drop inline (an audio element) — so he can check it without calling anyone.
5. **Rename / re-record (update).** He edits the name, or re-records/replaces the audio. Re-recording re-runs transcription (Journey 3.5a).
6. **Delete.** He removes a drop (confirm). If it was the **default**, we ask him to pick a new default (a library should always have one default so the one-tap button in 3.6 always works).
7. **Set default.** He stars one drop as the **default**. The default is what the one-tap **Drop** button plays and what auto-drop uses (Journey 3.6). *(Your question — yes, the default is used, for exactly those two things.)*

**Where the audio is stored (your question).** The audio file lives in **object storage** (the app's S3/GCS bucket); the database row holds only metadata — name, duration, `storageKey` (the pointer into the bucket), `isDefault`, and the transcript text. We never put audio blobs in Postgres.

- **Benchmark (beat this):** PhoneBurner — record your outgoing voicemail (building the library, then picking one before a session) [how it works] — https://support.phoneburner.com/hc/en-us/articles/36411165416084-Record-Your-Outgoing-Voicemail-QuickStart ; the marketing framing of the one-tap drop — https://www.phoneburner.com/homepage/voicemail-drop-software
- **Build docs:** MediaRecorder API (in-browser recording) — https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder ; storage via the app's existing object-storage bucket.

## Journey 3.5a — Transcribe a voicemail drop (so you can tell them apart)

*As a rep, I want to see the text of each saved voicemail, so that I can pick the right one at a glance without playing every clip.*

1. **Trigger.** When a drop is **saved or re-recorded** (Journey 3.5), a background job transcribes the audio.
2. **The model.** We use **Deepgram Nova-2** (fast, cheap, tuned for spoken audio — a few cents per clip, sub-second on a short voicemail). *If doc 2a already picks an ASR provider for call transcription, reuse that one instead — we want one ASR vendor, not two. Model is swappable later.*
3. **Where it shows.** The transcript appears **under the name** in the library list (Journey 3.5 step 3) and as the **subtitle in the drop picker** (the 3.6 dropdown), so "Intro — no answer" also shows *"Hi, this is Ryan at Maincar, sorry I missed you…"* — he reads instead of listens.
4. **Edge case — transcription fails or is unclear.** We show **"(no transcript yet)"** with a small retry, and the drop is **fully usable anyway** — a missing transcript never blocks recording or dropping.

- **Benchmark (beat this):** Google Voice — voicemail transcription *(the readable, skimmable transcript-under-each-message list we want)* — https://support.google.com/voice/answer/115074
- **Build docs:** Deepgram pre-recorded transcription — https://developers.deepgram.com/docs/pre-recorded-audio

## Journey 3.6 — Drop a voicemail (manual or automatic)

*As a rep, I want to leave a saved voicemail in one tap (or automatically) and move on, so that I don't waste time listening to and reciting the same message.*

1. **The manual-drop button (your 3.6.1 fix — one tap, no extra clicks).** On a live call that reaches voicemail, the in-call bar shows a **split button**: the **main part = "Drop voicemail"** (plays the **default** drop immediately), and a small **▾** on the side opens the picker to choose a different saved drop (with name + transcript subtitle from 3.5a). So the common case is **one tap**; picking a non-default is one extra tap only when he wants it. The server keeps the call leg open, plays the drop to the voicemail, and **releases him to the next call** — he never sits and listens.
2. **Auto-detect.** If auto-detect is on, **job D2** (Twilio AMD) listens for a machine at connect.
3. **Auto-drop — what he experiences, and how it's recorded (your question).** On a machine result with auto-drop on: the server plays the **default** drop on its own, advances him to the next call immediately, and he **never hears the machine**.
   - **Where he sees the "dropped" chip + the name.** A **"Voicemail dropped: {drop name}"** chip appears in **two** places: on the **just-ended call's row** in the power-dial list / dialer widget (right where his eyes already are), and on the **person's timeline** as the activity **"Left voicemail — {drop name}"** with a **▶** to replay the exact drop that was played.
   - **How it's saved to the record.** The **`Call`** row stores **`droppedVoicemailId`** (which `VoicemailDrop` was played) and **`amdResult = machine`**, and its disposition auto-sets to **Left voicemail** (doc 2 Journey 2.4). Because a `Call` is a first-class activity, that single write is what makes it appear on the person/company/deal **timeline** (doc 4a / doc 5 Journey 5.2) — we don't store a second copy of it.
4. **Edge — auto-drop is on but no default is set (your 3.6.4 fix — not a mid-call config).** We never silently do nothing, and we never make him configure a library **in the middle of dialing**. During the call we just mark it **"Voicemail (no drop set)"** and move on. **After the session ends** (or as a **dismissible toast**, never a blocking modal) we prompt: *"You hit 3 voicemails with no drop set — want to record one?"* → links to Journey 3.5. Setup happens later, in Settings, on his time.
5. **Edge — he drops, advances, and a human actually picks up (your edge case) — where things are on screen and how records update.** AMD is sometimes wrong (a slow "hello" reads as a machine). So while an auto-drop is playing, the server **keeps listening for human speech**:
   - **If the rep is idle / between calls:** the **dialer widget (bottom-right)** flips to a ringing-style **"Human on the line — {name}"** state with a large **Answer** button; answering bridges him to the caller. On screen it looks like an inbound-call pop in the widget. The `Call` updates to **status = in-progress**, and on hang-up it takes his normal disposition.
   - **If the rep is already mid-conversation with the next prospect:** we don't yank him. The drop finishes; the `Call` is marked **disposition = "Human answered after drop"**; a **callback `Task`** is created (doc 4d) and **pinned to the top of the call list** in the "Resurfacing today" strip (doc 4e Journey 4.18.3); the person's **timeline** logs "Left voicemail — human answered." He calls them back from that pinned row when free.
   - **What updates, in one place:** `Call.status` + disposition, a new callback **`Task`**, and a **timeline activity** on the person. The three surfaces — the **dialer widget** (bottom-right), the **pinned row at the top of the call list**, and the **person record's timeline** — all read off that same `Call`/`Task` write, so they stay in sync with no double entry.
   - Default behavior (re-alert vs. auto-callback) is a **Settings → Dialer** switch.
6. **The setting.** A single **Settings → Dialer** toggle controls auto-detect + auto-drop (default: **off** until he's built a library, then he opts in).

**Benchmark per numbered point (you asked for one each):**
1. **Manual one-tap drop + picker** → PhoneBurner voicemail drop *(release-the-rep-immediately, one-tap library)* — https://www.phoneburner.com/homepage/voicemail-drop-software
2. **Machine detection (AMD)** → Twilio AMD *(the mechanism)* — https://www.twilio.com/docs/voice/answering-machine-detection ; JustCall AMD *(behavior + false-positive handling)* — https://help.justcall.io/en/articles/8559982-understanding-answering-machine-detection-amd-in-predictive-dialer
3. **Auto-drop + logged to the record** → PhoneBurner auto-drop — https://www.phoneburner.com/homepage/voicemail-drop-software ; Orum *(drop + auto-log while power dialing)* — https://www.orum.com/
4. **"No drop set" handled gracefully** → *no direct benchmark — this is our design (never silently no-op, never force mid-call config); the bar is simply "don't fail silently."*
5. **Human-answered-after-drop recovery** → *novel; no direct benchmark. The nearest reference is AMD false-positive handling (JustCall AMD, point 2).*
6. **On/off setting** → a plain Settings toggle — obvious, no benchmark needed.

- **Build docs:** Twilio — answering machine detection — https://www.twilio.com/docs/voice/answering-machine-detection ; Twilio `<Play>` — https://www.twilio.com/docs/voice/twiml/play

---

# B. Numbers

## Journey 3.7 — Local presence + caller-ID rotation (mostly automatic)

*As a rep, I want the prospect to see a caller ID in their own area code, so that more of them pick up.*

**Tooltip (your edit applied — the "only numbers you own" line is deleted).** On the setting: *"Shows the prospect a caller ID in their area code — people answer local numbers more often."*

1. **Turn it on.** **Local presence is off by default** (your Decision — see below); he turns it on in Settings → Dialer (per-list override available).
2. **On dial**, **job D5** picks a caller ID from **the numbers he owns** whose area code matches the prospect's.
3. **What if he owns no number in that area code?** We never silently spoof or grab a random number. We fall back in order: (a) a number he owns in the same **state/region**; (b) his **primary** number — and we **show the fallback** ("no local number for 415 — used your main line"). Buying a matching local number is a **suggested action**, not automatic.
4. **Rotation is only across numbers he owns — never a shared cross-customer pool.** Rotating shared numbers across many customers flags them as spam fast and is legally riskier, so each rep's pool is his own owned numbers, each registered for STIR/SHAKEN and capped per number (Journey 3.8). No shared pool = no mass burning.

- **Benchmark (beat this):** PhoneBurner — Local Presence [how it works: area-code match, number pools, rotation] — https://support.phoneburner.com/hc/en-us/articles/16316515469716-Local-Presence + activating it — https://support.phoneburner.com/hc/en-us/articles/36410692890516-Activate-Local-Presence ; Nooks — Smart Presence — https://support.nooks.ai/articles/8714570394-smart-presence ; rotation: Kixie ConnectionBoost *(owned-pool rotation done well)* — https://www.kixie.com/features/connectionboost/
- **Build docs:** Twilio — available local numbers — https://www.twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource

## Journey 3.8 — Number health dashboard

*As an admin/rep, I want to see the health of each of my numbers and retire spam-flagged ones, so that my calls keep connecting and don't get labeled "Spam Likely."*

1. **Entry point.** Settings → Dialer → **Number health** (also reachable from Settings → Numbers).
2. **The dashboard.** Each owned number is a row: **number · connect rate · spam status · daily-cap usage · branded-caller-ID status**.
3. **Background scan (job D4).** On a daily schedule, we check each number against spam/reputation data (Twilio Voice Integrity) and update its `spamStatus`.
4. **Auto-retire (a setting) — with one guard.** A number over the spam limit can be **auto-retired**. **Exception (your question — what if it's his only number?): we never auto-retire the last active number.** Killing his only line would stop him calling entirely. Instead, that number stays active with a red **"At risk — replace this number"** banner, and we **suggest buying a replacement**; auto-retire only fires once a healthy replacement exists.
5. **Branded caller ID + cap.** He registers a number for **branded caller ID** (STIR/SHAKEN), and sets a **daily dial cap** per number.

- **Benchmark (beat this):** Orum — check caller-ID reputation *(the reputation dashboard we want to match)* — https://support.orum.com/en-US/orum/article/Ngc4FRwc-check-caller-id-reputation-feature ; branded caller ID: Dialpad — https://help.dialpad.com/docs/branded-calling
- **Build docs:** Twilio — Voice Integrity (spam monitoring) — https://www.twilio.com/docs/voice/spam-monitoring-with-voiceintegrity ; Twilio — SHAKEN/STIR — https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir

## Number pool — how many, what it costs, and the resolved defaults (notes)

*Not a journey — the sizing + cost answer you asked for, plus the settled dialer-at-scale decisions, kept so nothing is lost.*

**Start with one number; add a pool + rotation later (decided — you agreed).** What "later" needs:
- **How many numbers.** Rough rule: about **one local number per ~50–100 dials/day** into a given area code before reputation risk climbs, plus enough area-code coverage for your top regions. A solo rep at ~150 dials/day across 3 regions ≈ **3–6 numbers**; a team scales roughly linearly per rep.
- **Cost.** ~**$1–2 per number/month** (Twilio) + per-minute usage + a one-time 10DLC / branded-caller-ID registration. Cheap per number — the real cost is **management**, not dollars.
- **How we get them.** Buy on demand from Twilio by area code (the 3.7 fallback suggests it), and **register each for STIR/SHAKEN**.
- **How we rotate.** Only within **your owned** pool, area-code-matched, respecting each number's **daily cap** (job D5) — **never** a shared cross-customer pool (that burns numbers, 3.7).
- **How we monitor.** The Number Health dashboard (3.8) + the D4 reputation scan; **auto-retire** flagged numbers (never the last one) and suggest replacements.

**Resolved defaults (so no earlier choice is silently dropped):**
- **Power-dial delay:** 3s countdown, skippable (doc 3 Decision 1).
- **Local presence:** **off** by default (your call) — better connect rates, but opt-in.
- **Voicemail auto-drop:** **off** until a drop library exists, then opt-in (Journey 3.6) — changed from the old "on" pick because auto-drop is meaningless with no recording to play.
- **Live transfer:** sequenced **[LATER]** (needs multi-user), spec complete now (Journey 3.13).

---

# C. SMS

## Journey 3.10 — Send an SMS

*As a rep, I want to text a prospect from inside the app and see it delivered, so that I can follow up in the channel they actually answer.*

1. **Where the Text button lives (your question — referencing the other docs).** He starts a text from any of:
   - the **Person record** page — a **Text** action sits next to **Call** and **Email** (doc 4d record header);
   - a **phone field** — hovering a phone value shows quick **Call / Text** actions (doc 4c cell actions);
   - the **call screen** — a **Text** button in the in-call/after-call bar (doc 2), to text someone you just called.
   The composer opens in the **same bottom-right dock** the dialer and the email composer already use (doc 5 Journey 5.5 shell) — one corner widget for calls, email, and texts.
2. **Compose.** The composer shows the recipient, a **character / segment counter**, and the **template + merge-field** pickers (Journey 3.11). Standard SMS is 160 characters per segment.
3. **It looks like Apple Messages (the benchmark to beat).** The composer shows the **conversation as bubbles** — outbound on the right, inbound on the left, timestamps, newest at the bottom — the iMessage shape everyone already knows.
4. **Delivery status (your question — how he sees it).** Under each outbound bubble a tiny label tracks the message: **Sending → Sent → Delivered → Failed**, driven by Twilio status callbacks. A **Failed** bubble shows a reason on hover and a **Resend**.
5. **Emojis (your question).** Fully supported. Note that an emoji switches the message to **UCS-2 encoding**, which drops the per-segment limit from 160 to **70 characters** — so the counter shows this live (e.g. "1 emoji → 70/segment") so he isn't surprised by extra segments/cost.
6. **Links (your question).** Sent as plain text; they **auto-linkify** into a tappable link in the bubble. We do **not** build rich link previews/unfurls in v1 (noted as later).
7. **Rich text (your question).** **None** — SMS has no bold/italic; it's plain text. So the SMS composer has **no formatting toolbar** (unlike the email composer in doc 5.5). Media (images) go by **MMS**, handled in Journey 3.11a.
8. **Send.** Goes via Twilio; the message appears on the record **timeline**; inbound replies land in the thread and notify (Journey 3.13b). Reading and working replies is Journey 3.11a.

- **Benchmark (beat this):** Apple Messages — the bubble/thread UX bar to beat — https://support.apple.com/guide/iphone/send-messages-iph3d1102ba/ios ; HubSpot — send SMS (CRM logging) — https://knowledge.hubspot.com/sms/create-and-send-sms-messages
- **Build docs:** Twilio — send messages — https://www.twilio.com/docs/messaging/tutorials/how-to-send-sms-messages/node-js ; Twilio — message status callbacks — https://www.twilio.com/docs/messaging/guides/track-outbound-message-status

## Journey 3.10a — Register a number for business texting (10DLC)

*As an admin, I want to register my number for A2P texting once, so that my messages get delivered instead of carrier-blocked.*

Split out from the send flow (your ask) because it's its own multi-day process with its own UI and failure modes.

1. **Entry point.** Settings → Dialer → **Messaging**, or a **banner in the composer** the first time he tries to Text from an unregistered number ("Register this number to text").
2. **The form (stepped, save-and-resume).** Three steps with inline validation, because approval takes days and he shouldn't lose progress:
   - **Brand** — legal business name, EIN, address, website.
   - **Campaign** — use-case, sample messages, and how contacts opt in.
   - **Review & submit.**
3. **Submit → job D7.** We submit the brand + campaign to Twilio and **poll** for carrier approval. The page shows a status chip: **Submitted → Pending → Approved / Rejected** ("typically 1–3 business days").
4. **Blocked until approved.** Until the number is **Approved**, its **Text button is disabled** with "Texting pending approval" — we never queue sends that will bounce.
5. **Edge cases (broken out):**
   - **Rejected** → we show the carrier's rejection reason and let him **edit and resubmit** in place.
   - **Several numbers** → each number attaches to the same **brand**; one campaign can cover multiple numbers.
   - **He tries to text before registering** → the composer offers **"Register to text"** inline instead of a dead end.

- **Benchmark (beat this):** Twilio — A2P 10DLC onboarding *(the stepped brand→campaign flow + status states we mirror)* — https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- **Build docs:** Twilio — A2P 10DLC quickstart — https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart ; job **D7**.

## Journey 3.10b — Auto opt-out (STOP) and compliance in the composer [DEFERRED — build late]

*As a rep, I want the app to handle opt-outs for me, so that I stay compliant without thinking about it.*

**Sequencing:** **defer this until late** (your call) — texting works without it; this is the compliance polish layer. **Off by default** (your call): the suggested opt-out line and STOP handling are off until turned on in Settings → Dialer → Messaging.

**Sub-journeys (each is a distinct little flow):**

1. **Turn it on/off.** In Settings → Dialer → Messaging, a switch enables the opt-out features. Off by default; he (or the workspace) turns it on.
2. **The suggested opt-out line in the composer (your UI question).** When on, the **first** message to a new contact shows a faint **suggested append** — *"Reply STOP to opt out"* — as **editable ghost text**. He can **accept it (Tab), edit the wording, or delete it** (your question — yes, he can change or remove it; it's a suggestion, not a forced string). Removing it does not block send.
3. **Capturing an inbound STOP.** Twilio's Advanced Opt-Out catches the carrier-level STOP/UNSTOP keywords automatically; we **also** parse inbound bodies for STOP / UNSUBSCRIBE / QUIT and **auto-mark** that number **opted-out** — a Do-Not-Contact entry with `channel = sms`, `source = inbound` (Journey 3.14a).
4. **What happens when STOP is captured.** The number is blocked for further texts; the thread shows a system line *"Contact opted out (STOP) — texting disabled"*; the composer for that thread is disabled with the reason. It flows into the DNC model like any opt-out.
5. **Trying to text an opted-out number (your "testing a DNC number" question).** The composer is **blocked** with a clear reason. Re-enabling requires either a genuine inbound **START / UNSTOP** from the contact (auto-clears the opt-out), or a **manual admin override with a logged reason** (Journey 3.14a CRUD). We never let a rep quietly un-opt-out someone.

- **Benchmark (beat this):** Twilio — Advanced Opt-Out — https://www.twilio.com/docs/messaging/features/how-to-use-advanced-opt-out
- **Build docs:** Twilio — Advanced Opt-Out — https://www.twilio.com/docs/messaging/features/how-to-use-advanced-opt-out ; ties to the `DncEntry` model + job **D8**.

## Journey 3.11 — Use and manage SMS templates

*As a rep, I want reusable text templates with merge fields, so that I fire off consistent, personalized texts fast.*

1. **What ships by default (your question).** A small starter set, plain text + merge fields: **"No-answer follow-up," "Nice talking — recap," "Meeting confirmation," "Voicemail follow-up," "Break-up."** We ship them; the user edits them or adds his own.
2. **CRUD UI (Settings → SMS Templates).** A list of templates (name · preview · segment count). **New** opens a small editor — name, body, an **Insert field** button, a live **segment/char counter**. **Edit / duplicate / delete** on each row. No rich-text toolbar (SMS is plain).
3. **Merge fields (the sub-journey — same engine as email, doc 5.5a, minus the rich/AI parts).** He inserts a field **two ways**: type **`{{`** for an inline autocomplete, or the **Insert field** button (categorized: Contact / Company / Deal / Custom / System). Inserted fields render as **chips** — **blue = has data, amber = missing for this contact**. A chip is atomic (one backspace deletes it) and clickable to set a **fallback**, stored as `{{first_name | there}}`. A **"Preview as [contact]"** toggle resolves every chip before send. SMS deliberately omits the liquid/spintax/AI field classes email has (Journey 5.5a) — texts stay short and plain.
4. **Consume in the composer.** He picks a template → it fills the message with fields resolved from the record → send (Journey 3.10).

- **Benchmark (beat this):** our own email merge-field UX (doc 5 Journey 5.5a — chips, fallbacks, preview-as) is the bar; HubSpot — SMS templates *(simple CRUD + insert-field flow for short texts)* — https://knowledge.hubspot.com/sms/create-and-use-sms-templates
- **Build docs:** Twilio — Content API (templates + variables) — https://www.twilio.com/docs/content

## Journey 3.11a — Receive and work texts: the SMS inbox, media, and reactions

*As a rep, I want a real messaging inbox to read and answer texts and see them on the record, so that texting feels like a normal app and every message is on the timeline.*

1. **Receiving.** An inbound SMS/MMS hits the number's **message webhook**; we store it and route it to the conversation. It **notifies** (Journey 3.13b) and — like an inbound call — **screen-pops the sender's CRM record** (matched by `ContactPhone`, doc 2 Journey 2.1).
2. **Reading replies — the inbox (iMessage-benchmarked).** A **Messages** item in the nav opens a **two-pane inbox**:
   - **Left:** the conversation list — one **thread per counterparty number**, newest-active first, with unread badges.
   - **Right:** the open thread as **bubbles** (inbound left, outbound right), delivery status under outbound bubbles, timestamps, MMS inline. A reply box sits at the bottom (with template / merge / emoji).
   - He can **mark read/unread, archive** a thread, and **search** across messages. Tabs: **Unread / All / Archived**; filter by contact, number, or date. A message itself is **not editable** (a sent text is sent); he can **delete a thread from his view**.
3. **Media (MMS) — send and receive (your question).**
   - **Send:** an **image/attachment icon** in the composer → pick a file → it **previews as a thumbnail** in the compose box → send. It goes as MMS (Twilio media URL). Limits shown inline (Twilio ~5 MB; jpg/png/gif).
   - **Receive:** inbound media renders **inline in the bubble** (tap to enlarge or download) and also **attaches to the record**.
4. **Reactions / iMessage tapbacks (your question — the honest answer).** iMessage reactions (👍 "Liked", ❤️ "Loved") are **Apple-proprietary** and **do not travel reliably over SMS/MMS**. When an iPhone user reacts to our text, the carrier usually delivers a **plain text line** like *Loved "your message"* — not a real reaction object. So:
   - **Receiving:** we **detect those reaction-text lines** (a regex on the known *Loved / Liked / Emphasized / Laughed at / Disliked / Questioned "…"* patterns) and render them as a **small tapback badge on the referenced bubble** instead of a noisy separate message — beating the raw carrier experience. If we can't confidently match, we show it as a normal inbound line.
   - **Sending:** we **do not** send iMessage-style tapbacks (there's no standard way over SMS). He reacts by replying, optionally with a one-tap **emoji reply**.
   - **Net: partial support** — we render inbound reactions cleanly, we don't fake outbound ones. (Real reactions become possible if we ever add **RCS** — noted as later.)
5. **Which number.** With several owned numbers (doc 2 Journey 2.13), each conversation remembers **which of your numbers** the contact texts, and replies go out from that same number.
6. **Are messages first-class objects, like calls and emails? Yes (your question).** An **`SmsMessage`** is a first-class **activity**, modeled like a call or an email (doc 5 `EmailMessage`):
   - It belongs to a **`ContactPhone` → Person → Company** (and optionally a **Deal**), so every text shows on the person's, company's, and deal's **timeline** and in the merged **Activity** cell (doc 4b Journey 4b.1 / doc 4a `CompanyActivity`, written by job E5).
   - Because it's a real activity, it feeds **deal warnings/risks** (doc 9 Journey 9.2) and the **AI event engine** (doc 7b Journey 7b.1, event `sms.received`) exactly like calls and emails — e.g. an inbound reply clears a "gone-quiet" warning and reconciles an "unless-they-reply" reminder (doc 7b Journey 7b.3).
   - *Why first-class and not a sub-note: it's a two-way channel with its own inbound/outbound direction, delivery state, threading, and media, and it must drive the same automations calls and emails do. A note can't carry that.*

- **Benchmark (beat this):** Apple Messages (bubbles, threads, tapbacks) — https://support.apple.com/guide/iphone/welcome/ios ; OpenPhone — messaging inbox UX — https://www.openphone.com/
- **Build docs:** Twilio — receive & reply (incoming webhook, MMS media) — https://www.twilio.com/docs/messaging/tutorials/how-to-receive-and-reply/node-js ; Twilio — incoming webhook params — https://www.twilio.com/docs/messaging/guides/webhook-request

---

# D. Live conversation tools

## Journey 3.13 — Live (warm) transfer to another rep [LATER — needs multi-user]

*As a rep, I want to hand a live caller to a teammate, so that the right person closes the conversation without the caller repeating themselves.*

Spec is complete now even though it builds with multi-user. Benchmark: **Aircall** (the reference warm-transfer UI).

1. **The Transfer button** sits in the **in-call action bar** (next to mute / hold / keypad) during any active call.
2. **Pick a target:** a **presence-aware picker** — a searchable list of reps/teams, each with a **presence dot** (green available / grey away / red DND — Journey 3.13a). Unavailable reps show **greyed with their status** (not hidden), so he knows why. Targets: a rep, a team/queue, or an external number.
3. **Warm vs cold, chosen per transfer** — two buttons: **"Ask first"** (warm) and **"Transfer now"** (cold).
   - **Ask first** puts the customer on **hold** (hold music, can't hear the reps — Journey 3.13c) and opens a **private line** between the two reps; they toggle back to the customer and back as needed.
   - A prominent **"Complete transfer"** button connects the customer to the new rep and **drops the original rep**; a **"Cancel / return to caller"** aborts.
4. **Private-first is the default (your defaults rule applied).** Ask-first is the higher-quality default, so **we ship it on as the factory default**; **each rep can change his own default**, and it's always **overridable per transfer** with the two buttons. *(No "admin sets the team default" tier — users own their setting; we own the shipped default.)* Optionally a **3-way merge** (the introducer stays briefly before dropping) — a step beyond Aircall.
5. The receiving rep is **notified** (Journey 3.13b) with the caller's details and who's transferring.

- **Benchmark (beat this):** Aircall — transferring calls — https://support.aircall.io/hc/en-gb/articles/10375396999965
- **Build docs:** Twilio — `<Conference>` TwiML — https://www.twilio.com/docs/voice/twiml/conference

## Journey 3.13a — Presence (how we know a rep can take a transfer)

*As a rep, I want to see at a glance whether a teammate can take a live handoff, so that I don't transfer a caller into dead air.*

Presence hides real complexity, so it gets its own spec. Benchmark: **Slack**. Two independent axes: a derived **presence** + a manual **availability** override.

1. **Detection signals:** a **websocket heartbeat** from the rep's app (presence = connected), **local idle** detection (keyboard/mouse/focus) reported in the heartbeat, and — the strongest signal — **telephony state** from the dialer (`on_call` auto-set while connected). Plus a **manual override**.
2. **States + rules:** **Available** (connected, not idle, not on a call → transfer-eligible); **On a call / Busy** (telephony-driven, auto); **Away** (idle **> 3 min** — tighter than Slack's 10 because stale routing burns a live customer — or manual); **DND** (manual; blocks transfers + notifications, keeps the connection); **Offline** (socket dropped ~30–60s, or logged out).
3. **Where it shows:** a colored dot on **every rep avatar** — the transfer picker (primary), team views, call detail. The picker greys/filters by availability.
4. **Settings:** a manual Available / Away / DND toggle + DND schedule; the idle timeout is a **fixed system default we ship** (not user-tunable) to keep routing honest.
5. **Server-authoritative.** A presence service holds live socket + telephony state in memory / Redis as the **ephemeral** truth and pushes changes to clients; only **manual overrides + DND schedules are persisted**. At transfer time we **confirm against live server state**, never a client-reported flag.

- **Benchmark (beat this):** Slack — presence & availability — https://slack.com/help/articles/201864558-Set-your-Slack-status-and-availability
- **Build docs:** internal — a websocket presence service fed by telephony state.

## Journey 3.13b — Notification settings: transfer events + per-event ring sounds

*As a rep, I want to control how the app alerts me for each kind of event — and make a transfer sound different from a cold call — so that I react correctly without looking.*

**Notification settings already exist in doc 2 Journey 2.14** (channels per event, ring + volume, DND, enable-notifications). This journey **extends** that home. Benchmarked on **Aircall** (the most complete; rivals are thin — an opening for us).

1. **Add the transfer event.** A **Warm-transfer request** row joins the event × channel grid, so a handoff can alert differently from a fresh call.
2. **Per-event ring sounds (an extension of doc 2.14 — flagged).** Doc 2.14 today has **one global ring sound**. To make a transfer *sound* different, we extend the grid so **each event row has its own ring-sound picker** (inbound call, missed call, new voicemail, transfer request), plus the volume slider and **test ring** already in 2.14.
3. **Where the ring audio comes from (your question).** We ship a **small built-in library** of short ring/alert tones, bundled as static audio assets, sourced from a **permissively-licensed pack** (CC0 sounds, e.g. freesound.org / Material design sounds, or self-produced) so there are no licensing strings. The user picks from the library **or uploads his own** short clip. Played via the browser audio APIs (doc 2.14).
4. **Add Slack** as a channel for team handoffs (missed-call / voicemail / transfer).
5. **Defaults (your rule).** **We (super-admin) ship the factory defaults**; each user sets his **own** notification settings. *(No admin-sets-team-defaults tier — removed.)*

- **Benchmark (beat this):** Aircall — notifications settings — https://support.aircall.io/hc/en-gb/articles/21534404074909-Aircall-Workspace-Notifications-settings
- **Build docs:** reuses doc 2 Journey 2.14 + MDN Notifications API — https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API

## Journey 3.13c — Put a caller on hold

*As a rep, I want to put a caller on hold with music and a clear on-hold indicator, so that I can check something without dead air and without forgetting them.*

**New — doc 2 has no hold today**, so this adds a **Hold** button to the in-call bar (flag: a small doc-2 extension).

1. **Entry point.** A **Hold** button in the in-call action bar (next to mute / keypad / transfer).
2. **On hold.** The caller hears **hold music**; the rep's audio is muted to the caller.
3. **On-hold feedback so he can't forget (your question).** The call bar switches to a distinct **"On hold — 00:42"** state with a **counting timer** and a **pulsing amber indicator**. If a hold passes a threshold (e.g. **60s**), the indicator **escalates** (faster pulse) and an optional soft reminder tone nudges him — so a held caller is never forgotten.
4. **Resume.** A **Resume** button returns to the live call.
5. **Hold-music config (your question — kept simple).** We **ship a default hold track** (one pleasant royalty-free loop). **Settings → Dialer → Hold** lets the workspace **pick from a small built-in set** or **upload its own** track/announcement. We ship the default; the workspace can change it. Not a playlist manager — one track. Audio is sourced the same permissively-licensed way as the ring sounds (3.13b).

- **Benchmark (beat this):** Aircall — Workspace: in-call view and actions [visual + how it works: the Hold button and the in-call state] — https://support.aircall.io/hc/en-gb/articles/21534383206685-Aircall-Workspace-In-Call-View-and-Actions ; Aircall — configuring voicemail, music and messages (hold music from a media library) — https://support.aircall.io/hc/en-gb/articles/10375395294109-Configuring-Numbers-Voicemail-Music-and-Messages
- **Build docs:** Twilio — `<Play loop>` / conference hold — https://www.twilio.com/docs/voice/twiml/play ; https://www.twilio.com/docs/voice/twiml/conference

---

# E. Browser extension

## Journey 3.12 — Click-to-call browser extension (with an on/off popup)

*As a rep, I want to click any phone number on any web page and call it, and quickly silence the extension on pages where I don't want it, so that it helps without getting in the way.*

1. **Install.** The user installs the browser extension.
2. **It finds numbers.** On any web page, the content script finds phone numbers, outlines them, and turns each into a button. It recognizes many formats across countries — `(415) 555-2671`, `+44 20 7946 0958`, `04 15 55 26 71` — using **libphonenumber** and **normalizes each to E.164** before dialing, so a French or UK number dials correctly. Ambiguous/short strings that aren't valid numbers are ignored (no false positives on ZIP codes / IDs). Default country comes from the page/site and the user's setting.
3. **Click to call.** He clicks a number → a small popover opens → **Call** → the app opens and dials.
4. **The toolbar popup with an on/off switch (your idea).** Clicking the **extension's toolbar icon** opens a **popup** showing: the signed-in **account / workspace**, the **active outbound number**, an **"Open the app"** link, and — the point — a **switch to turn the number-detection off**. When **off**, the content script stops outlining numbers on pages, but the extension **stays installed and enabled**, so he can flip it back on any time. The **icon badge** shows the on/off state, and the setting persists per user (`chrome.storage`).

- **Benchmark (beat this):** RingCentral — Chrome extension *(number-detection on any page + a clean toolbar popup, the pattern we extend with an on/off switch)* — https://support.ringcentral.com/gb/en/release-notes/integrations/rc-for-google-chrome-extension.html
- **Build docs:** Chrome — content scripts — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts ; Chrome — action popup — https://developer.chrome.com/docs/extensions/develop/ui/add-popup ; libphonenumber-js — https://github.com/catamphetamine/libphonenumber-js

---

# F. Compliance & data hygiene

Three different things get confused constantly, so we name them apart up front. All three put a **status on a contact point (a phone or an email)** with a reason, who, when — the same mechanism — but they mean different things and follow different rules:

| Concept | Plain meaning | Legal weight | Expires? | Journey |
|---|---|---|---|---|
| **Do-Not-Contact (DNC)** | "They told us to stop." | Yes — an opt-out. | **Never** (for real opt-outs). | 3.14a |
| **Unreachable / dead** | "This number/email doesn't work." | No — deliverability. | Yes — re-verifiable, decays. | 3.14c |
| **Skip for now / snooze** | "Don't bother right now / call back later." | No — rep judgment. | Yes — time-boxed, auto-lifts. | 3.14a (soft) + backburner (doc 4e 4.18.3) |

So **DNC and "dead" are different things**, not one — that separation is the whole point. (Your question — they share a model shape, not a meaning.)

## Journey 3.14a — Do-Not-Contact: the situations, then the clicks

*As a rep, I want stopping-contact to be one fast, obvious action that does the right thing later, so that I honor opt-outs without slowing down my dialing or thinking about compliance.*

We start with the real situations, in plain sentences — what the rep wants and where he wants to end up — then walk the clicks and what happens months later. (The data model is at the very bottom; you should be able to judge the design from the situations alone.)

### The situations

- **Situation 1 — "Take me off your list."** The prospect clearly says stop calling. **Goal:** never call this person again, on any number. **End state:** a permanent person-level DNC. **This is universal — no judgment.** A clear opt-out is always honored, forever.
- **Situation 2 — "The gatekeeper says the company isn't interested."** A receptionist says "we're not interested, don't call." **Goal:** stop calling *that line*, but maybe still reach the decision-maker. **End state:** a block on that number (or that gatekeeper person); the account is flagged but other contacts stay callable. **This is judgment — the rep decides how far it reaches.**
- **Situation 3 — "Don't call anyone here."** A senior person says stop, company-wide. **Goal:** no one at this company gets called. **End state:** an account-level DNC. **Mostly universal, but the rep confirms the scope** (it's a big hammer).
- **Situation 4 — "Call me back in six months."** Not an opt-out — a timing thing. **Goal:** this person disappears from today's lists and comes back in ~6 months. **End state:** a **snooze/backburner** with an auto-return date — **not DNC** (doc 4e Journey 4.18.3). **Judgment, flexible.**
- **Situation 5 — "He was rude but never said stop."** **Goal:** a break from this lead without burning it or risking a false opt-out. **End state:** a **soft "skip for now"** with an expiry — **not DNC. Judgment.**
- **Situation 6 — "Wrong number."** The number doesn't reach the target. That's **unreachable/dead** (Journey 3.14c), not DNC. (Listed to show the boundary.)

### The clicks (walking the important ones)

**Situation 1 — a real opt-out (universal).**
1. He's on the call (or just hung up). The disposition bar (doc 2 Journey 2.4) has a red **Do-not-call** disposition. He presses its number key — one keystroke.
2. A small **reason picker** appears: *said stop · rude · wrong number · gatekeeper · legal.* He picks **"Said stop."**
3. That writes a **person-level DNC** (source = rep, permanent). The person's row gets a small, calm **grey "DNC" chip** — not a red banner.
4. **Months later:** a teammate imports a new list that includes this person, or a view surfaces them. At **dial time, job D8 checks DNC first and the person is auto-skipped** with a visible reason. In any table the row shows the same quiet **DNC chip**. He never calls them again by accident.

**Situation 2 — the gatekeeper (judgment).**
1. Gatekeeper says not interested. He presses **Do-not-call** → reason **"Gatekeeper."**
2. Because the reason is "gatekeeper," a **scope choice** appears: **This number · This person · Whole company.** The default is **This number** (the least aggressive choice).
3. He picks **This number.** The account gets a subtle **"gatekeeper block on 1 number"** flag, but **other contacts stay callable.** We do **not** auto-escalate a gatekeeper to the whole account.
4. **Months later:** the reception line is auto-skipped, but the decision-maker's mobile still dials normally.

**Situation 4 — "call me back in 6 months" (not DNC at all).**
1. He presses a **next-step** (not a disposition) — **"Call back / snooze"** — and picks a date six months out (doc 2 Journey 2.4: a callback is a next step, not a disposition).
2. This is a **backburner snooze** (doc 4e Journey 4.18.3), **not** a DNC. The person drops off today's lists.
3. **On the return date:** they **resurface pinned at the top of the call list** with a note ("you asked to call back") — a reminder, no compliance weight, nothing blocked.

### How a DNC number shows up in a call list, without clutter (your ask)

- A DNC contact point shows **one small grey "DNC" chip** on the row and on the phone field — never a big red banner, never repeated three times.
- In a **power-dial run**, DNC rows are **auto-skipped**, shown **greyed with the reason**, so he sees *why* without it interrupting flow (doc 3 Journey 3.4).
- The person record's phone section shows a per-number status chip (**DNC / dead / ok**); details live on hover/click, not on the row.
- The checks at dial time run in a fixed order so behavior is predictable: **DNC (D8) → calling hours (3.14b) → number status (3.14c) → dial.**

### CRUD (kept, but it's the rare path — the common path is the one keystroke above)

**Settings → Dialer → DNC:** view (filter by scope / reason / date), **add** (number / person / account + reason), **edit** (reason, expiry), **remove** (confirm + record who/why), **import** a DNC CSV. On any record or call, a one-click **"Mark Do-Not-Call"** with the reason picker. The national-DNC scrub runs on a schedule (job D8).

**Provenance on every entry (litigation defense):** scope + id, source (rep / inbound / national-DNC / legal), who, a reason code + free-text note, when, channel, the linking call id, plus `expiresAt` + `status`. Real opt-outs (said-stop / national-DNC / legal) **never auto-expire**; soft "skip for now" entries use a separate `suppressed` status with a 30–90-day expiry that auto-lifts, never confused with a real opt-out. **Number- and account-level scope are our differentiators** — Salesforce/HubSpot model person-level DNC only.

- **Benchmark (beat this):** Nooks — Snooze / Do-not-Call [how it works: the two states and where the rep sets them] — https://support.nooks.ai/articles/3085469846-snooze-do-not-call-feature ; Nooks — cold-calling compliance in the US [how it works: the legal frame we gate on] — https://support.nooks.ai/articles/9640528868-cold-calling-compliance-in-the-us-a-guide-for-businesses ; Salesforce/HubSpot DoNotCall field (person-only) — beaten by number + account scope ; FCC — Reassigned Numbers Database — https://www.fcc.gov/reassigned-numbers-database
- **Build docs:** internal — the `DncEntry` model (below) + job **D8**.

## Journey 3.14b — Calling-hours (quiet-hours) enforcement

*As a rep, I want the app to keep my calls inside an allowed daily window in the prospect's local time, so that I don't call people at the wrong hour.*

1. **Where:** Settings → Dialer → **Calling hours.**
2. **UI:** set the **allowed window** (default **8am–9pm**) and choose **warn vs block** outside it, with a master on/off (default on).
3. **Tooltip (your fix — no legal talk, accurate to the actual window).** The tooltip reads: *"We use the prospect's local time (from their number) to keep your calls inside your window (currently {start}–{end})."* It reflects the **currently configured** window, and it does **not** state the law. *(Why: we're not here to lecture users about statutes; we just do the right thing. The legal reasoning lives in our internal note, not the UI.)*
4. **How applied:** we derive the prospect's **local time from their number/area code**; a dial outside the window is **warned or blocked**. In power dial, blocked rows are **auto-skipped** as "outside calling hours."
5. **Rendering:** each row shows a small **clock chip** with the prospect's local time; out-of-window rows are greyed with the reason.

- **Benchmark (beat this):** Kixie — manage business hours and after-hours voicemail [how it works: hours per agent / ring group / IVR / queue, with a global override] — https://support.kixie.com/hc/en-us/articles/18787546339995-Manage-Business-Hours-and-Voicemails-for-After-Hours-Calls ; the UX bar is just a clean time-window control.
- **Build docs:** internal — timezone from area code (+ the prospect's stored timezone if known).

## Journey 3.14c — Dead & unreachable contact points (numbers and emails)

*As a rep, I want numbers and emails that don't work to be marked (not deleted) and quietly kept out of my way, so that I stop wasting dials on dead ends and the same dead value never comes back to bite me.*

### The concept, in plain words

A **contact point** is a way to reach someone — a phone or an email (later: LinkedIn, a website). Each carries a **status**:

- **Reachable** — works as far as we know.
- **Unverified** — we haven't checked it yet.
- **Unreachable ("dead")** — it doesn't work, with a plain **reason:** *never-valid* (junk / wrong format), *no-longer-in-service*, *wrong-person*, or (for email) *hard-bounce*.

**Terminology (your question — "invalid / disconnected" are confusing, and you're right).** We drop those as the user-facing labels. **"Disconnected" collides with a "connected call," and "invalid" sounds like a typo.** The status the user sees is **"unreachable"** (informally "dead") with a plain reason underneath. (*Invalid / disconnected* survive only as internal reason codes, never on the UI.)

**How this differs from DNC (your core question).** DNC = *"we're allowed to reach them, but they said don't"* (legal, permanent, deliberate block). Unreachable = *"we physically can't reach them here"* (deliverability, decays, re-verifiable). Same **stamp** on the contact point (status + reason + source + checkedAt); **different meaning and different rules** (see the table at the top of section F).

### Journey 3.14c.1 — How a number gets marked unreachable

Three sources, each stamps `status + reason + source + checkedAt`:
1. **Import + scheduled hygiene (job D9).** On import and on a schedule, D9 **format-checks** the number (libphonenumber) and calls **Twilio Lookup** for line type and whether it's assigned. It marks the status. This is where **line type** is captured too (used below).
2. **Our own dialer outcomes (the strongest signal).** Repeated failed dials / SIT tones auto-mark a number unreachable. Our own outcomes beat any lookup — a lookup says "assigned to a carrier," not "a human answers."
3. **Manual.** The rep marks **"wrong number"** from the call (a disposition/next-step in doc 2 Journey 2.4), which stamps *wrong-person*.

### Journey 3.14c.2 — What the rep sees when an unreachable number comes up

1. In any table, the row shows a **quiet grey "unreachable" chip** (with the reason on hover).
2. In a **power-dial run** (doc 3 Journey 3.4), the app **falls through to the person's next usable number** if there is one, or **auto-skips** the row (greyed, with the reason) if there isn't.
3. It's **advisory, not a hard wall** — he can still **force-dial** an unreachable number if he thinks it's mismarked (unlike DNC, which is a hard block). Force-dialing that connects **auto-clears** the "dead" status.
4. **Mark, don't scrub — and why.** We **never delete** a dead number. Deleting loses the memory, so the same dead number re-imports and gets dialed again. **Marking makes re-imports idempotent** — a re-imported dead number matches the existing one and stays suppressed — and enrichment **skips** known-dead values and continues its waterfall. Only a **legal erasure request** hard-deletes.
5. Because validity is a **snapshot that decays** (~1–2%/month of US numbers get reassigned), we always store **`checkedAt`** and re-verify old stamps on the schedule.

### Journey 3.14c.3 — How line type drives SMS and dial order (your "why does it matter?")

**Line type** (mobile / landline / VoIP) is tagged by **job D9** (Journey 3.14c.1) and used in exactly two visible places, so it's never a mystery number:
- **SMS composer (Journey 3.10):** texting a **landline** silently fails at the carrier, so the composer **warns/blocks** a text to a landline and says why.
- **Dial-order (Journey 3.14d):** **Line type** is a sortable field, so a rep can put mobiles first.
We **inform**, we don't hard-skip a landline by default — he can still call it.

### The generalization — one shape, every channel

The same `{ value, status, reason, source, checkedAt }` shape applies to **emails** (a hard bounce marks the email unreachable) and, later, to any channel. One shape → **one suppression check** at send/dial time. A "don't use this LinkedIn / website" is a lighter **manual "do-not-use" flag** on that field (no deliverability check) — same status idea, different reason — noted as a later addition.

### Why a phone number is its own object (`ContactPhone`)

A person often has several numbers, each with its own **label** (work mobile / office / home), **line type**, **primary** flag, **best-time-to-call**, **per-number DNC**, and **status**. `phone1 / phone2` fields can't carry that. So a serious dialer needs a **`ContactPhone` object related to Person** (Attio models multi-value; Salesforce/HubSpot use fixed fields — we beat both). *Overkill only when people have one number and you never dial at scale; for us, build the object.*

- **Benchmark (beat this):** Twilio — Lookup Line Type Intelligence — https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence ; Attio — multi-value attributes — https://attio.com/platform/data
- **Build docs:** libphonenumber — https://github.com/google/libphonenumber ; ITU E.164 — https://www.itu.int/rec/T-REC-E.164 ; job **D9**.

## Journey 3.14d — Dial-order fields (sort your list the way you want)

*As a rep, I want to sort my call list by the fields that predict a pickup — myself — so that I stay in control and understand why someone is at the top.*

**We're dropping the old "smart order" auto-score (your call — you're right).** A hidden priority score obscures the choices a rep wants to make. Instead, **every signal is a plain, visible field** on the Person (or `ContactPhone`) that you sort and filter like any column (doc 4c). You choose the order; nothing is a black box.

**The fields (each: where it lives, its type, how and when it's computed, how it's shown):**

| Field | Lives on | Type | How it's computed | When | Shown as |
|---|---|---|---|---|---|
| **Times dialed** *(renamed from "prior attempts" — clearer)* | ContactPhone / Person | integer rollup | count of dials to this number/person | incremented on each dial | a number; sort ↑/↓ |
| **Last dialed** | ContactPhone / Person | datetime | timestamp of the most recent dial | set on each dial | relative ("2d ago"); **this is the field the "recency" filter uses** |
| **Freshness** | Person | **derived label, not a stored score** | bucketed from *Last dialed* (Never / Fresh <7d / Aging / Stale) | **computed at read time** | a chip (Never / Fresh / Aging / Stale); sort by *Last dialed* underneath |
| **Line type** | ContactPhone | enum (mobile / landline / VoIP) | Twilio Lookup | on import + schedule (job D9) | an icon chip; sort/filter to put mobiles first |
| **Best time to call** | ContactPhone / Person | enum (morning / afternoon / evening / any) | the window that has historically **connected** — or set by hand | recomputed **nightly** from connect history; blank if too little data | a chip ("Best: AM"); sort/filter ("Best = now") |
| **Times connected / last connected** | ContactPhone | integer + datetime | incremented when a dial reaches a human | on connect | a number + relative time |

**Answering your specific questions:**
- **"Prior attempts" naming.** Renamed to **"Times dialed"** (a count). Filtering "by recency" is a **separate** field — **"Last dialed"** (a datetime you filter, e.g. "dialed in the last 3 days"). Splitting count from recency is what lets you do both.
- **Freshness.** It's a **derived label computed at read time** from *Last dialed*, **not** a stored score. Values: Never / Fresh / Aging / Stale (thresholds we ship, adjustable). Shown as a chip; the real sort key is *Last dialed*.
- **When each is computed.** Counts increment on each dial; best-time recomputes nightly; line type on import + schedule; freshness at read time. (Stated per field above.)
- **Multiple numbers — how to prioritize mobiles over landlines in the UI.** Two levels, both manual and visible:
  - **Within a person:** the dialer calls the person's **primary** number; set the mobile as primary (Journey 3.14c), or sort the person's `ContactPhone` rows by *Line type*.
  - **Across people:** add **Line type** (of the primary number) as a **sort/filter column** on the People view, so **people whose primary is a mobile sort above people whose primary is a landline** — or filter to "primary line type = mobile" to work only mobiles first. No hidden score; it's a column you control.
- **Best time of day in the view.** A **chip column** ("Best: AM / PM / Eve"), computed nightly from connect history. You **sort or filter** on it ("Best = now"). With too little data it's **blank** — we don't guess — and you can set it by hand.

- **Benchmark (beat this):** Attio — sort & filter on any field (the control we want) — https://attio.com/help/reference/attio-101/records-lists-and-views ; the *signals* to expose are inspired by Nooks — pickup likelihood & hot numbers [how it works: which signals feed the ranking] — https://support.nooks.ai/articles/8894679945-pickup-likelihood-and-hot-numbers — but exposed as fields, not a score.
- **Build docs:** internal — these are plain fields on `ContactPhone`/`Person` computed by job **D9** + a nightly best-time job; sorted with the doc 4c view engine.

---

## Legal note (INTERNAL — for us, not shown to users)

*This is an engineering/compliance note for the team. It is **not** user-facing copy — per the calling-hours decision, we don't lecture users about the law in the UI. I am not a lawyer; this is not legal advice. US TCPA, the FTC Telemarketing Sales Rule, the Truth in Caller ID Act, STIR/SHAKEN, and 50 states' laws are fact-specific and change — have a TCPA attorney review before launch.*

- **Local presence (3.7):** legal to display a number **you own** that rings back to you; illegal to spoof a number you don't own or to deceive. Own every rotation number, keep them answerable, register for **STIR/SHAKEN**.
- **Calling hours (3.14b):** no telemarketing before 8am or after 9pm in the **called party's** local time; many states are stricter. We enforce it per lead and default to the strictest applicable state rule where known.
- **DNC (3.14a):** scrub the **National DNC Registry** and honor opt-outs within 30 days for consumer/cell; maintain an **internal DNC indefinitely** for everyone (B2B included).
- **AMD / predictive dialing (3.6 / D2):** the FTC caps **abandoned calls at 3%**; **single-line (1:1) power dialing is structurally safe** (a rep is always waiting). Predictive/parallel is a separate, heavily-guarded later mode with abandonment tracking + a recorded disclosure + legal sign-off.
- **Number rotation (3.7):** legal across numbers **you own**, but high-volume churn reads as spam → register for STIR/SHAKEN, keep per-number volume reasonable, monitor reputation, never rotate to disguise identity.

---

## Background jobs (trigger, steps, and pg-boss params)

*(Queued jobs run on **pg-boss** — the Postgres-backed queue from doc 8. Not everything here is a queue: some work is a **Twilio webhook** or runs **in-request**, and we say so, because it changes how it's built. The analytics rollup **D6** is in **doc 3b**.)*

- **D2 — Answering-machine detection (AMD).** **Not a pg-boss job — a Twilio webhook.** **Trigger:** the call connects with AMD enabled. **Steps:** Twilio analyzes the first seconds (greeting length, beep, silence), classifies **human vs machine**, and POSTs the result to our webhook ~3–5s after answer; we write `amdResult` on the `Call`. False positives happen, so it's **advisory** (Journey 3.6).
- **D3 — Auto-drop voicemail.** **Not queued — a real-time server action inside the call leg.** **Trigger:** a `machine` result from D2 with auto-drop on. **Steps:** the server keeps the leg open, returns TwiML `<Play>` for the default drop, hangs up, and auto-dispositions "Left voicemail"; it keeps listening for human speech to handle the "human answered after drop" edge (Journey 3.6 step 5). Instant after D2.
- **D4 — Number-reputation scan.** **Trigger:** pg-boss **cron, daily** (`0 8 * * *`, workspace tz). **Steps:** for each owned number, check spam/reputation (Twilio Voice Integrity), update `spamStatus`, and **auto-retire** a number over the limit — **except the last active number** (Journey 3.8). **pg-boss:** queue `number-reputation-scan`, `retryLimit: 2`, one job per workspace (fan-out), `singletonKey` = numberId so a slow scan never overlaps itself.
- **D5 — Caller-ID pick.** **Not queued — runs in-request on the dial path.** **Trigger:** placing a dial with local presence on. **Steps:** pick from **your owned** numbers the best local match (exact area code → same state → primary), respect each number's **daily cap**, record which was used (Journey 3.7). Synchronous, sub-request.
- **D7 — 10DLC registration + polling.** **Trigger:** submit in Journey 3.10a. **Steps:** submit the brand + campaign to Twilio, then **poll** for carrier approval (days) by **self-re-scheduling**; flip status on a terminal result; **block SMS send** until `approved`. **pg-boss:** queue `tendlc-poll`, `singletonKey` = registrationId (one poller per registration), re-queue with `startAfter: 6h` until terminal, `retryLimit: 5` on transient API errors.
- **D8 — DNC check.** **Not queued — an in-request indexed lookup.** **Trigger:** before any dial and during import. **Steps:** check number/person/account against active `DncEntry` rows (all three scopes) plus the national-DNC scrub; **block + flag** matches with the reason (Journey 3.14a). Fast indexed read on `@@index([workspaceId, scope, scopeId])`.
- **D9 — Number hygiene.** **Trigger:** on import (enqueued by D1) **and** pg-boss **cron, weekly** (`0 3 * * 0`) to re-verify decayed stamps. **Steps:** format-validate (libphonenumber), call Twilio Lookup for line type + validity, and **mark** (never delete) dead/unreachable numbers with `status + statusReason + source + checkedAt`; tag **line type** for SMS and dial-order (Journeys 3.14c / 3.14d). **pg-boss:** queue `number-hygiene`, `retryLimit: 3`, batched (chunks of ~500 numbers), **idempotent** per `contactPhoneId` (re-running only refreshes `checkedAt` + status).

**D1 — Import parse + dedupe + E.164** (defined with the import widget, doc 3 Journey 3.1). **Trigger:** the user drops a file in the importer. **Steps:** **PapaParse streams** the CSV **in the browser** (no queue — the parse never blocks the server), applies the column map, **normalizes each phone to E.164**, and checks the chosen match fields against existing records to flag duplicates before the server write. The bulk insert is a **single batched server request** for normal files; for very large files it hands off to a pg-boss `import-write` job (queue `import-write`, `retryLimit: 3`, batched, **idempotent on a per-row import hash** so a retry never double-creates), which then enqueues **D9** for hygiene.

---

## Data model (Prisma) — additions in this doc

Extends the calling-core + doc-3 schema. **New models and added fields are marked.** Analytics models (`AnalyticsRollup`) live in **doc 3b**.

```prisma
model Call {          // from doc 1/2 — at-scale additions:
  amdResult             String?  // human | machine | unknown (job D2 / Journey 3.6)
  droppedVoicemailId    String?  // which VoicemailDrop was played (Journey 3.6.3)
  localPresenceNumberId String?  // which owned number D5 picked as caller ID (Journey 3.7)
  // (listId — which CRM list/view the dial came from — is added in doc 3.)
}

model PhoneNumber {   // YOUR OWNED Twilio numbers (rotation pool) — from doc 1/2, plus:
  inRotationPool  Boolean @default(false) // part of the caller-ID rotation pool (Journey 3.7)
  dailyDialCap    Int?    // per-number cap (Journey 3.8)
  spamStatus      String  @default("clean") // clean | flagged | retired (D4)
  connectRate     Float?  // rolling metric shown on the health dashboard
}

model ContactPhone {       // NEW — a PROSPECT's phone number, first-class (Journey 3.14c)
  id            String   @id @default(cuid())
  workspaceId   String
  personId      String            // -> Person record (doc 4)
  e164          String
  extension     String?
  label         String?           // work_mobile | office | home | other
  lineType      String?           // mobile | landline | fixed_voip | non_fixed_voip (D9)
  carrier       String?
  isPrimary     Boolean  @default(false)
  position      Int?              // order among a person's numbers; primary is hard
  bestTimeToCall String?          // morning | afternoon | evening | any (Journey 3.14d, nightly)
  doNotCall     Boolean  @default(false)   // per-number DNC (shortcut; the entry lives in DncEntry)
  status        String   @default("unverified") // reachable | unverified | unreachable | dnc
  statusReason  String?           // never_valid | not_in_service | wrong_person | hard_bounce ...
  source        String?           // lookup | dialer | import | manual
  checkedAt     DateTime?         // validity is a snapshot that decays (Journey 3.14c)
  timesDialed   Int      @default(0)   // Journey 3.14d
  lastDialedAt  DateTime?             // Journey 3.14d (recency)
  timesConnected Int     @default(0)   // reached a human
  lastConnectedAt DateTime?            // dialer defaults to this number next time
  @@unique([workspaceId, e164, personId])
  @@index([e164])
}
// EmailAddress (in the CRM) mirrors {value,status,reason,source,checkedAt} — the same
// "dead value" shape (Journey 3.14c); a hard bounce marks it unreachable.

model DncEntry {           // NEW — Do-Not-Contact (Journey 3.14a / D8) — THREE scopes
  id          String   @id @default(cuid())
  workspaceId String
  scope       String            // number | person | account
  scopeId     String            // the e164 / personId / companyId
  source      String            // rep | inbound | national_dnc | legal
  actorId     String?           // who marked it (provenance)
  reasonCode  String?           // said_stop | rude | wrong_number | gatekeeper | legal
  note        String?
  channel     String?           // call | sms
  callId      String?           // the call that substantiates it
  status      String   @default("active") // active | suppressed | expired | revoked
  expiresAt   DateTime?         // null = never (real opt-outs); set for soft "suppressed"
  createdAt   DateTime @default(now())
  @@index([workspaceId, scope, scopeId])
}
// "Call me back in 6 months" is NOT a DncEntry — it's a backburner snooze (doc 4e 4.18.3).

model VoicemailDrop {      // NEW — Journey 3.5 library
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  storageKey  String            // pointer into object storage (audio lives there, not in PG)
  durationS   Int?
  transcript  String?           // filled by Journey 3.5a (Deepgram)
  isDefault   Boolean @default(false) // the one-tap drop + auto-drop use this
}

model SmsMessage {         // NEW — Journeys 3.10 / 3.11a — a first-class activity
  id           String   @id @default(cuid())
  workspaceId  String
  userId       String?          // who sent it; null on inbound
  direction    String   // outbound | inbound
  fromE164     String
  toE164       String
  body         String
  // OUR MediaAsset ids, NOT Twilio's URLs. Twilio deletes its copy on the account
  // retention schedule, so a stored provider URL renders today and 404s later —
  // worse than never showing the picture, because the record looks complete.
  mediaAssetIds String[]        // MMS media (Journey 3.11a step 3)
  recordId     String?          // -> the matched CRM record (timeline). See note below.
  dealId       String?          // optional -> Deal
  phoneNumberId String?         // which OWNED number sent/received (doc 2.13)
  threadKey    String           // <ownedE164>|<counterpartyE164> — see SmsThreadState
  templateId   String?
  twilioSid    String?  @unique // idempotency anchor: Twilio retries its webhooks
  status       String   // queued | sent | delivered | failed | received
  errorCode    Int?             // the carrier's code on a failure (Journey 3.10 step 4)
  errorMessage String?          // ...in words, shown on hover of a Failed bubble
  sentAt       DateTime?
  deliveredAt  DateTime?
  // An inbound iMessage tapback (Journey 3.11a step 4). The carrier delivers a reaction
  // as an ordinary quoted line, so it arrives as a MESSAGE; the row is kept and pointed
  // at what it reacts to, and the thread draws it as a badge rather than a line. Both
  // null when the quoted text matched nothing we sent — that renders as a plain message,
  // because a missed tapback is noise and a wrong one hides a real message.
  reactsToMessageId String?
  reactionEmoji     String?
  createdAt    DateTime @default(now())
  @@index([workspaceId, threadKey])
  @@index([workspaceId, reactsToMessageId])
}
// `recordId`, not `personId`: the CRM kernel stores People as generic `Record` rows, and
// doc 3a's own first-class `ContactPhone` (Journey 3.14c) is not built. `phoneRecordMatch`
// returns a recordId, so that is what is stored until ContactPhone lands.

model SmsThreadState {    // NEW — Journey 3.11a step 2: what ONE USER did with a thread
  id          String   @id @default(cuid())
  workspaceId String
  userId      String            // read/archive/hide are PER USER, never per message
  threadKey   String            // the same key SmsMessage carries
  isArchived  Boolean  @default(false)
  isHidden    Boolean  @default(false) // "delete from my view"; the messages stay
  lastReadAt  DateTime?         // an INSTANT, not a flag: a later message is unread again
  @@unique([workspaceId, userId, threadKey])
  @@index([workspaceId, userId, isArchived])
}
// Unread is COMPUTED from this — inbound messages newer than lastReadAt — never stored.
// A stored counter has to be decremented by every path that could make something read,
// and one missed path leaves a badge that never clears. A thread with no row here has
// never been touched, so an inbox of threads nobody opened costs no rows at all.

model SmsTemplate {        // NEW — Journey 3.11
  id          String @id @default(cuid())
  workspaceId String
  name        String
  body        String        // plain text with {{merge}} fields (no rich text)
}

model TenDlcRegistration { // NEW — carrier approval (D7), can take days (Journey 3.10a)
  id          String   @id @default(cuid())
  workspaceId String
  numberId    String
  status      String   // submitted | pending | approved | rejected
  rejectReason String?
  submittedAt DateTime @default(now())
}

model DialerSettings {     // NEW — per-workspace POLICY (Settings -> Dialer)
  id              String  @id @default(cuid())
  workspaceId     String  @unique
  callingStart    String  @default("08:00") // calling-hours window (Journey 3.14b)
  callingEnd      String  @default("21:00")
  callingMode     String  @default("block")  // warn | block
  autoDetectVm    Boolean @default(false)    // auto-drop off until a library exists (Journey 3.6)
  autoDropVm      Boolean @default(false)
  smsOptOutOn     Boolean @default(false)    // STOP features off by default (Journey 3.10b)
  holdTrackKey    String?                    // uploaded hold music, else the shipped default (3.13c)
}
// PER-USER preferences (power-dial delay, local-presence toggle, ring sounds, hold-edge
// behavior) are per-user, defaulted by US (super-admin). No admin-sets-team-defaults tier.

model UserDialerPrefs {    // NEW — per-user preferences (defaults shipped by super-admin)
  id              String  @id @default(cuid())
  userId          String  @unique
  powerDialDelayS Int     @default(3)     // 0-30 (doc 3 Decision 1)
  localPresence   Boolean @default(false) // Decision 2: OFF by default (your call)
}

model PresenceOverride {   // NEW — persisted manual presence/DND (Journey 3.13a)
  id          String   @id @default(cuid())
  userId      String   @unique
  manualState String?           // available | away | dnd (null = auto)
  dndSchedule Json?             // optional DND windows
}
// Live presence itself is ephemeral (Redis + websocket + telephony) — not a table.
```

---

## Technology choices (stated once, for docs 3 / 3a / 3b)

Builds on the calling-core stack. New at scale:

- **Durable background jobs — pg-boss (Postgres-backed queue), from doc 8.** The calling-core work all happened **inside a web request** (do it, return, done). Bulk calling has work that **outlives a request** — runs on a schedule (D4 reputation), polls for days (D7 10DLC), or must retry for minutes. That can't live in a request that ends when the response is sent, so it goes on a **queue with a worker that survives restarts and retries**. **pg-boss**: Postgres-backed, open-source, **no Redis, no per-run cost.**
- **Answering-machine detection — Twilio AMD** (Journey 3.6 / D2). *Custom audio model rejected as overkill.*
- **Number reputation / spam — Twilio Voice Integrity** (D4), with a pluggable slot for a specialist (e.g. Numeracle) later.
- **SMS — Twilio Messaging + A2P 10DLC; templates via Twilio Content API.**
- **Voicemail-drop transcription — Deepgram Nova-2** (Journey 3.5a), or reuse doc 2a's ASR vendor if one is already chosen (we want one ASR vendor).
- **Ring / hold audio — a bundled, permissively-licensed (CC0) sound set + user upload** (Journeys 3.13b / 3.13c). No licensing strings.
- **Browser extension — Chrome MV3** (content script + action popup), a separate deploy that authenticates against the web-app session.

*(Analytics tech — ECharts, timezone handling — is stated in **doc 3b**, since analytics moved there.)*
