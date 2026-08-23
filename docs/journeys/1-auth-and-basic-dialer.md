# Doc 1 — Auth & Basic Dialer (P0)

This is a format sample. If you like how it reads, I use the same shape for the rest of the app.

**P0 goal:** a working React app where you sign in and make a real outbound phone call from the browser. Nothing else.

**In P0:** React app shell, Firebase Auth, multi-workspace, buy/select a number, device check, outbound call with basic controls.

**Not in P0** (from your list, parked for later): CSV import, contacts, linking people to numbers, recording, transcription, AI, dispositions, notes, voicemail, call summary, call history log. All kept in the master list under [LATER] or a later phase.

---

## How to read this doc

- **Screens** = what exists on screen in P0.
- **Journeys** = the user's path, step by step. "He clicks X → sees Y."
- **Background jobs** = work the app does on its own, with rough timing.
- Under each journey, two link types (kept separate on purpose):
  - **Benchmark (beat this)** = the product to match, plus a link where you can *see* how it works (screenshots, the user journey, what the features do).
  - **Build docs** = the technical page that tells the coding agent how to build it.
- **Decisions for you** = choices only you can make. Two options, my pick first.

---

## Screens in P0

1. **Auth screens** — sign up, sign in, sign out. (Standard. We copy Lita / Loadwire.)
2. **App shell** — left navbar, a workspace switcher top-left, a user menu (bottom of the navbar) with **Sign out**, main area.
3. **Dialer** — a bottom-right popover, open on any page (decided below).
4. **Settings → Devices** — mic, speaker, and network check.
5. **Settings → Numbers** — buy a number, see your numbers, pick the active one.

---

## Journey 1.1 — First run and sign up

*As a new user, I want to sign up and create my workspace, so that I can get into the app and start setting up.*

1. User opens the app URL. Sees the sign-up screen.
2. Clicks "Sign up." Enters email and password (Firebase Auth). Submits.
3. Sees a "Create your workspace" screen. Types a workspace name. Clicks Create.
4. Lands in the app shell. Left navbar shows: Dialer, Settings, and a user menu with **Sign out** at the bottom. Top-left shows the workspace name.
5. If the workspace has no number yet, a banner says "Buy a number to start calling." He clicks it → goes to Journey 1.5.

- **Benchmark — flow & fields (match this):** your Lita / Loadwire sign-up (internal — no public link). Copy the *flow*: same fields, same steps. This is a functional benchmark, not a looks benchmark.
- **Benchmark — UI beauty (beat this):** **Attio's sign-in** — clean, modern, generous whitespace, one obvious primary button. See it live (public page): https://app.attio.com/welcome/sign-in ; design language: https://attio.com . Copy Loadwire's *flow*, but make it look at least as polished as Attio.
- **Build docs:** Firebase Auth — https://firebase.google.com/docs/auth

**Banner rules (Journey 1.1).** The banner is tied to *state*, not to "seen once." A "seen once" flag would break on refresh and hide the banner from a user who still has no number.

- **Show it** whenever the active workspace has zero active numbers to call from.
- **Hide it** as soon as the workspace has one active number.
- **Refresh the page:** state is unchanged, so the banner still shows if he still has no number.
- **Leave, do other things, come back without buying:** still zero numbers, so the banner still shows.
- **Other places we also prompt him to buy:** Settings → Numbers shows an empty state with the same "Buy a number" button; and the Dialer blocks the Call button with "Buy a number first" when there is no active number.

**Edge cases (documented for later — not built in P0):**

- **Number revoked, deleted, released, or gone inactive** → the workspace drops back to zero active numbers → the banner comes back on its own. The same state rule handles this, so no extra work.
- **Pending / porting numbers** (bought but not yet active) — decide later whether "pending" counts as "has a number" for the banner.
- **Suspended or past-due number** (once billing exists) — treat as not active for the banner. Revisit when billing lands.

## Journey 1.2 — Sign in (returning user)

*As a returning user, I want to sign in, so that I land back in the workspace I was using.*

1. User opens the app. Sees sign-in.
2. Enters email and password. Clicks Sign in.
3. Lands in the app shell, in the workspace he used last.

- **Benchmark — flow & fields (match this):** your Lita / Loadwire sign-in (internal).
- **Benchmark — UI beauty (beat this):** **Attio's sign-in** — https://app.attio.com/welcome/sign-in (same visual bar as sign-up above).
- **Build docs:** Firebase Auth — https://firebase.google.com/docs/auth

## Journey 1.3 — Switch or add a workspace

*As a user who belongs to more than one workspace, I want to switch between them or create a new one, so that I can work in the right place.*

1. User clicks the workspace name (top-left).
2. Sees a dropdown: his workspaces, plus "Create workspace."
3. Clicks another workspace → the app reloads that workspace's numbers and calls.
4. Or clicks "Create workspace" → names it → lands in the new, empty workspace.

*New vs your other apps: one user can hold many workspaces. The switcher is how he moves between them.*

- **Benchmark (beat this):** Slack / Attio workspace switcher (top-left switcher pattern).
- **Build docs:** Firebase Auth custom claims for workspace membership — https://firebase.google.com/docs/auth/admin/custom-claims

## Journey 1.4 — Device check (green room before the call)

*As a rep, I want a quick mic/speaker/network check right before I call, so that I never start a call on a dead or wrong device.*

Devices change often — the user plugs in a headset, swaps a mic, joins a new network. So the main check happens **right before a call starts**, like the Google Meet green room, not buried in settings.

1. The user clicks Call (Journey 1.6) for the **first call of the session, or the first call after a device change.**
2. A small green-room panel appears before the call connects: a mic level meter, a "Test speaker" button, and a network status light.
3. He speaks → the mic meter moves. Clicks "Test speaker" → hears a tone.
4. If a device is wrong, a dropdown lets him pick another mic or speaker.
5. A warning shows if the mic is muted or the network is weak. He clicks "Start call" to continue.
6. **Settings → Devices** holds the same controls for an anytime manual check, but the green room is the one he actually sees before calling.

**When the green room shows (exact rules).** Show it before a call when **any** of these is true:

1. **First call of the session** — no successful mic grant yet since the app loaded.
2. **A device changed** since the last call — a mic or speaker was plugged in, removed, or swapped. We listen for this with `navigator.mediaDevices.ondevicechange`.
3. **Mic permission is missing or was revoked** — the browser has not granted the mic, so we must ask before we can call.
4. **The last check flagged a problem that was not fixed** — mic muted, no input device, or a weak/failed network light on the previous green room.

**Skip it** (go straight to dialing) when none of the above is true — e.g. back-to-back calls in the same session, on the same healthy devices, permission already granted. This keeps rapid dialing fast.

**Open it manually any time.** A small **device/gear icon in the dialer** opens the green room on demand, even when the rules above would skip it. (Settings → Devices, step 6, holds the same controls for a check away from a call.)

**Live device capture (QA must verify this exact case).** While the green room is **open**, plugging in a new device (e.g. a headset) **must be captured live**: the `devicechange` event refreshes the device list, the new device appears in the mic/speaker dropdown, and the level meter re-reads the newly selected input — **with no need to close and reopen the panel**. Test: open the green room, plug in a USB headset, confirm it shows up and can be selected and metered on the spot.

- **Benchmark (beat this):** Google Meet green room — https://support.google.com/meet/answer/10409699?hl=en
- **Build docs:** MDN MediaDevices.getUserMedia — https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

## Journey 1.5 — Buy and select a number

*As a rep, I want to buy a phone number and set it active, so that I have a line to call from.*

1. User clicks Settings → Numbers.
2. Clicks "Buy a number." Picks a country and area code.
3. Sees available numbers from Twilio. Clicks one. Confirms.
4. **Background job B1 runs** (see below). In ~2–5 seconds the number appears in his list, marked Active.
5. If he owns several, he clicks one to set it Active for outbound calls.

- **Benchmark (beat this):** Apollo "Set up the dialer" — https://knowledge.apollo.io/hc/en-us/articles/26604629080845-Set-Up-the-Dialer-to-Make-Calls-on-Apollo
- **Build docs:** Twilio Phone Numbers — https://www.twilio.com/docs/phone-numbers

## Journey 1.6 — Make an outbound call

*As a rep, I want to place an outbound call from the browser, so that I can talk to a prospect.*

1. User opens the Dialer popover (bottom-right) from the navbar link or the global hotkey.
2. Types a number on the keypad, or pastes one.
3. Clicks the green Call button. *(On the first call of the session, the green-room device check from Journey 1.4 appears first.)*
4. **Background job B2 runs** (token + call setup, ~1–2 seconds). The user sees the "Calling…" state with the number (see B2 below).
5. The call connects. He sees: a live timer counting up, the number he is calling, his active caller ID, and Mute and Hang-up buttons.
6. He talks (audio streams to the browser over WebRTC).
7. He clicks Hang up. The dialer returns to the keypad, ready for the next call.

- **Benchmark (beat this):** Apollo "Make and Receive Calls" — https://knowledge.apollo.io/hc/en-us/articles/4734516058893-Make-and-Receive-Calls ; Apollo Dialer Overview — https://knowledge.apollo.io/hc/en-us/articles/4409140527757-Dialer-Overview
- **Build docs:** Twilio Voice JS SDK — https://www.twilio.com/docs/voice/sdks/javascript ; Quickstart — https://www.twilio.com/docs/voice/sdks/javascript/get-started

## Journey 1.7 — Guided first-run onboarding (one thing at a time)

*As a new user, I want a guided setup that gives me one task at a time, so that I know exactly what to do first.*

The first time a user lands in an empty workspace, he should never guess what to do next or hunt for a feature. We copy Attio's onboarding: **one task at a time, one obvious button, and a small visual that shows why the task matters.** This makes the whole first-run path a single guided flow with a visible finish line, instead of a scatter of banners.

1. Right after he creates his workspace (Journey 1.1), a **guided onboarding panel** opens in the main area (not a tiny corner). It shows a short checklist with the current step expanded and the rest collapsed:
   1. **Buy your first number** — so you have a line to call from.
   2. **Check your mic and speaker** — so your first call sounds good.
   3. **Make your first call.**
2. **Only the current step is active.** It shows **one** large primary button (e.g. "Buy a number") and a small illustration/mockup that shows what he is about to get and **why it is needed** (e.g. a phone-line graphic captioned "You need a number before you can call out"). Later steps are greyed until the one before them is done.
3. Clicking the step's button runs that step's existing journey — buy a number = Journey 1.5; device check = Journey 1.4 opened manually. When it finishes, the checklist **auto-advances** to the next step and marks the finished one with a check.
4. **The first call, made obvious (fixes the "hidden dialer" worry).** The bottom-right dialer is easy to miss the first time, before he knows it is there. So the **"Make your first call"** step does not just say "open the dialer." It shows a **prominent primary button that opens the dialer for him**, plus a one-time **coachmark** (a highlight + arrow) that points at the dialer's spot in the corner and at the navbar "Dialer" link, captioned "Your dialer lives here — open it any time." He learns where it is instead of searching for it.
5. The panel is **dismissable** ("I'll finish later") and **re-openable** from a "Getting started" item in the navbar until every step is done. Once all steps are complete, it disappears on its own.

*Why a guided panel and not only the buy-a-number banner (Journey 1.1): the banner nudges one thing; a new user does better with the whole first-run path shown as one ordered, one-step-at-a-time flow. This is the Attio pattern.*

- **Benchmark — flow & feel (match this):** **Attio onboarding** — one task at a time, an obvious button, and a visual that justifies each step. Internal screenshot deck (has the screens): https://docs.google.com/document/d/1uh1qdOIpJwe9bvCY3-KBKK89phAcq1K04x8GiLHRDVw ; Attio — introduction to navigating Attio [visual: sidebar + settings screenshots] — https://attio.com/help/reference/attio-101/introduction-to-navigating-attio
- **Build docs:** product-owned onboarding state — a per-workspace `onboardingStep` (data model below); the coachmark/spotlight can be a small overlay component.

---

## Background jobs in P0 (what happens on its own)

- **B1 — Provision a number.** **Trigger:** the user's **Confirm** in Journey 1.5. After purchase, the server calls Twilio to buy and configure the number. Takes ~2–5 seconds. The user waits on a small spinner, then sees the number. **pgboss:** `provision-number` queue, `retryLimit: 3`, **idempotent on `twilioSid`** (a retry never double-buys); a Twilio webhook confirms the number went `active`. **P0 billing model:** one Twilio account — **yours**. The server holds your Twilio credentials, buys every number on your account, and all number and call usage bills to your Twilio account. No per-workspace Twilio accounts and no Stripe in P0. Per-workspace Twilio subaccounts and charging customers are **[LATER]**, after multi-user and billing land.
- **B2 — Call setup.** On Call, the server mints a short-lived Twilio access token and returns TwiML so Twilio knows how to route the call. Takes ~1–2 seconds. **What the user sees during these 1–2 seconds:** the dialer switches to a "Calling…" state — the dialed number on screen, a spinner on the Call button (now disabled so he can't double-call), the keypad locked, and a Hang up button already available to cancel. When setup finishes, it becomes the live call (Journey 1.6 step 5).
- **B3 — Token refresh.** Firebase and Twilio tokens expire. The app refreshes them quietly in the background. The user never sees this. If a refresh fails, the app asks him to sign in again.

---

## Decisions for you (P0)

**All four are now decided — you agreed with every pick.** Kept here for the record.

**1. Where does the dialer live?** — **Decided: bottom-right popover.** A floating dialer in the corner, like SalesLoft, Apollo, and Dialpad. It stays open while the user is on any page, so he never loses his place. Fits your "one screen" thesis. Later, the CRM record shows behind it.

**2. Is inbound calling in P0, or P1?** — **Decided: P1.** Keep P0 to outbound only, so it ships faster. "Basic dialer" = you can call out.

**3. Is a simple call log in P0, or P1?** — **Decided: P1.** No stored call records in P0 (matches "no recording, no dispositions"). You just make calls.

**4. How does the user reach the dialer?** — **Decided: navbar link + global hotkey.** A "Dialer" item in the left navbar, plus a keyboard shortcut to open the popover from anywhere.

---

## What I still owe you (next passes)

1. Roll this exact format across the rest of the app.
2. Full "nothing dropped" audit — map every one of your original bullets to a spot.
3. Redo sequencing with you, phase by phase, since you disagreed with the draft order.
4. Apply your other edits everywhere: billing to the very end, add a Deals object with pipeline-stage config, add a Campaign / Script object, model chosen by super-admin on the backend.

---

## Technology choices (where it is not obvious)

Options first, then my pick and why. These carry across the later docs.

- **App framework — React + TypeScript, Vite SPA + a separate TypeScript API service.** *Options:* (a) Next.js — one deploy unit, built-in API routes; (b) **Vite SPA + a separate Node/TS API** — the SPA talks to an API service, and we need that always-on API service anyway for the pg-boss worker. **Pick: Vite SPA + separate API** — a logged-in dashboard needs no SSR/SEO, Vite is the fastest dev loop (and the tool you know best), and it fits the container-host model cleanly. *(This is the resolved choice; the fuller options/tradeoffs and the reasons it beats Next.js off-Vercel live in [doc 12](../development-guidelines/12-devops-and-infrastructure.md) — the authoritative tech-choices home.)*
- **Auth — Firebase Auth.** *Options:* Firebase (your build doc, matches Lita/Loadwire) vs Clerk/Auth0. **Pick: Firebase**, to reuse what you already know and the workspace-claims pattern (Journey 1.3).
- **Telephony — Twilio Programmable Voice + Voice JS SDK.** *Options:* Twilio vs Telnyx vs Vonage. **Pick: Twilio** for the most mature browser SDK and docs. *Telnyx is noted as a second provider in the at-scale doc for cost/number supply — so we keep a thin provider boundary now.*
- **Database — Postgres + Prisma ORM.** *Options:* Postgres/Prisma vs Firestore (would pair with Firebase Auth). **Pick: Postgres**, because this product is deeply relational (records, references, calls, deals). Firestore would fight the CRM model later. Firebase is used for **auth only**. *Where it's hosted:* **local Postgres via Docker Compose to start**; a managed Postgres co-located on the host when we deploy — **not Neon** (the pg-boss worker polls constantly, so Neon's scale-to-zero never fires). See [doc 12](../development-guidelines/12-devops-and-infrastructure.md).
- **Hosting — local first, deploy later.** We **build and run everything locally with Docker Compose** (Postgres + MinIO) — the way the Loadwire / Lita repos work — and **defer deploying to a host (Render) until we actually need a shared/staging/prod environment.** Render is the chosen target host (first-class always-on worker for pg-boss, auto DB backups, code-based config); the full Railway-vs-Render evaluation and deploy setup live in [doc 12](../development-guidelines/12-devops-and-infrastructure.md). Twilio secrets live only in server env, never in the browser.

## Data model (Prisma) — the starting schema

This is the first schema. **Everything here is new.** Later docs extend it and mark their additions.

```prisma
model User {          // NEW — mirrors the Firebase Auth user
  id           String       @id            // = Firebase UID
  email        String       @unique
  displayName  String?
  memberships  Membership[]
  createdAt    DateTime     @default(now())
}

model Workspace {     // NEW — one user can own many (Journey 1.3)
  id            String        @id @default(cuid())
  name          String
  onboardingStep String?      // guided first-run progress (Journey 1.7); null once complete
  memberships   Membership[]
  numbers       PhoneNumber[]
  calls         Call[]
  createdAt     DateTime      @default(now())
}

model Membership {    // NEW — join: which user is in which workspace, and role
  id          String    @id @default(cuid())
  user        User      @relation(fields: [userId], references: [id])
  userId      String
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  workspaceId String
  role        String    @default("owner")   // owner | member (multi-user is LATER)
  @@unique([userId, workspaceId])
}

model PhoneNumber {   // NEW — a Twilio number owned by a workspace
  id            String    @id @default(cuid())
  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  workspaceId   String
  e164          String    @unique            // +14155551234
  twilioSid     String    @unique
  status        String    @default("active") // active | inactive | released | pending
  isActiveForOutbound Boolean @default(false) // the selected caller number
  createdAt     DateTime  @default(now())
  // The A5 "buy a number" banner shows when a workspace has zero status="active" numbers.
}

model Call {          // NEW — a single outbound call (expanded in the calling-core doc)
  id            String    @id @default(cuid())
  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  workspaceId   String
  direction     String    @default("outbound") // inbound added in calling-core
  fromE164      String
  toE164        String
  twilioCallSid String?   @unique
  status        String    // queued | ringing | in-progress | completed | busy | no-answer | failed
  startedAt     DateTime?
  endedAt       DateTime?
  createdAt     DateTime  @default(now())
}
```

## Technical decisions, trade-offs & edge cases

- **Twilio access tokens are minted server-side and short-lived** (~1 hour), refreshed quietly (B3). The browser never holds Twilio credentials. *Referenced by Journey 1.6 step 4 and B2.*
- **Every query is scoped by `workspaceId`.** Workspace membership rides in the Firebase ID token as a custom claim (Journey 1.3 build doc), and the server re-checks it — the claim is a hint, not the authority.
- **The "buy a number" banner is derived state, not a flag** (Journey 1.1): it is `count(active numbers) == 0`. This is why refresh and revoke "just work" with no extra code.
- **Number provisioning is async and can fail** (B1): confirm via Twilio webhook, make the buy idempotent (guard on `twilioSid`), and show a clear error + retry if Twilio rejects. A number can sit `pending` before it goes `active`.
- **Mic/WebRTC need a secure context and a user gesture:** `getUserMedia` only works over HTTPS and after a click; handle "permission denied" and "no device" in the green room (Journey 1.4). Devices can change mid-session — the green room re-checks (see Journey 1.4 trigger rule).
