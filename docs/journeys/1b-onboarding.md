# Doc 1b — Onboarding (first-run to first value)

How a brand-new user goes from **empty workspace → first real value** without guessing. Doc 1 already ships the P0 seed of this — **Journey 1.7** (the guided first-run checklist: buy a number → device check → first call). This doc is the **onboarding family**: it keeps 1.7 as the P0 core and specs the rest — empty states that teach, getting the first data in, connecting a mailbox, resuming a half-finished setup, and the definition of "activated" we grade against.

**Principle (from doc 1, Journey 1.7):** *one task at a time, one obvious button, and a small visual that shows why the task matters.* We copy Attio's onboarding. Every journey here obeys that.

**Not deleting anything.** Journey 1.7 stays in doc 1 as the P0 slice. This doc references it as **1b's step engine** and adds the surrounding journeys. Where onboarding touches other docs (buy a number = doc 1 Journey 1.5; connect mailbox = doc 5 Journey 5.4.1; import a call list = doc 3; import records = doc 5a CSV import), we **link** rather than restate.

---

## How to read this doc

Same shape as doc 1: numbered **Journeys**, **Background jobs** (trigger + timing), **Benchmark (beat this)** kept separate from **Build docs**, **Decisions for you** (two options, my pick first).

**One data field carries onboarding state:** `Workspace.onboardingStep` (already in doc 1's schema) plus a small per-user `OnboardingProgress` (added below). Everything is **derived from real state**, not "seen once" flags (the doc 1 Journey 1.1 banner rule) — so a refresh, a revoke, or a new device never leaves a user stranded or nagged.

---

## What "onboarded" means (the target we grade against)

We define **one activation moment** and instrument it, so onboarding has a finish line, not a vibe:

> **Activation = the user completes his first real outbound call from his own number, AND has at least one list/record to work (imported or created).**

That is the "aha": *he talked to a prospect through the app.* Everything in this doc exists to get him there fast and then to the *second* aha (the AI proposes his next action — doc 7). We track **time-to-activation** and **step drop-off** (PostHog, doc 12) as the onboarding scorecard.

---

## Journey 1b.1 — The first-run setup guide (the step engine)

*As a brand-new user, I want a guided setup that hands me one task at a time, so that I always know the single next thing to do.*

This is **Journey 1.7 promoted to the onboarding home** and generalized. On first landing in an empty workspace (right after Journey 1.1 / 1a.1), a **guided panel** opens in the main area — not a corner toast — with a short checklist, current step expanded, the rest collapsed and greyed:

1. **Set up your profile** — name + photo (Journey 1a.9 / 1a.11). *Why: your name shows on calls, emails, and notes.*
2. **Buy your first number** — doc 1 Journey 1.5. *Why: you need a line to call from.*
3. **Check your mic & speaker** — doc 1 Journey 1.4 (green room). *Why: your first call sounds good.*
4. **Get your first list in** — import a call list (doc 3) or records (doc 5a), or add one record by hand. *Why: someone to call.*
5. **Make your first call** — doc 1 Journey 1.6, with the coachmark that points at the dialer (Journey 1.7 step 4).
6. **(Optional) Connect your email** — doc 5 Journey 5.4.1. *Why: log emails and see the whole account.*

**Rules (inherited from 1.7, restated once):** only the current step is active with **one** primary button + a small illustration justifying it; finishing a step **auto-advances** and checkmarks the done one; later steps stay greyed until unlocked. The panel is **dismissable** ("I'll finish later") and **re-openable** from a "Getting started" navbar item until every required step is done, then it disappears on its own.

**What's new vs 1.7:** steps 1 (profile), 4 (first data), and 6 (email) are added, because "make a call" alone isn't activation — he needs *someone to call* and an *identity*. Steps 4 and 6 are skippable; steps 2, 3, 5 are required for activation.

- **Benchmark — flow & feel (match this):** **Attio onboarding** — one task at a time, obvious button, a visual that justifies each step. Internal deck: https://docs.google.com/document/d/1uh1qdOIpJwe9bvCY3-KBKK89phAcq1K04x8GiLHRDVw ; Attio — introduction to navigating Attio [visual: sidebar, switcher, settings screenshots] — https://attio.com/help/reference/attio-101/introduction-to-navigating-attio . Interaction galleries: https://www.saasui.design/pattern/onboarding/attio , https://mobbin.com .
- **Build docs:** product-owned onboarding state — `Workspace.onboardingStep` + `OnboardingProgress` (data model below); coachmark/spotlight is a small overlay component.

## Journey 1b.2 — Empty states that teach (onboarding without a wizard)

*As a user who dismissed the guide or is exploring, I want every empty screen to tell me what it's for and give me one button to fill it, so that I'm never staring at a blank page.*

The guide (1b.1) is the happy path; **empty states are the safety net**. Each core surface, when empty, shows a **one-line purpose + one primary CTA + a faint mock of the filled state**:

1. **Dialer with no number** → "Buy a number to start calling" (doc 1 Journey 1.1 banner + Settings → Numbers empty state).
2. **Records/table empty** → "Import your contacts or add your first company" → CSV import (doc 5a) or New record (doc 4).
3. **Call list empty** → "Build a call list from your records or import one" (doc 3).
4. **Inbox / activity empty** → "Connect your email to see every message on the account" (doc 5).
5. **Reports empty** → "Make a few calls — your activity report fills in automatically" (doc 5b).

**Defensive point.** An empty state is **derived from data count**, never a flag: it appears whenever the count is zero and vanishes the moment there's one row — so it self-heals after import, delete-all, or workspace switch.

- **Benchmark (beat this):** **Linear / Notion empty states** — a sentence of purpose + one primary action + a light illustration. Notion — empty states [visual] — https://www.saasui.design/pattern/empty-state/notion ; Linear — empty states [visual: 3 real Linear zero-data screens] — https://www.saasui.design/pattern/empty-state/linear ; the wider gallery [visual] — https://www.saasui.design/pattern/empty-state .
- **Build docs:** each list/table component renders an `EmptyState` when its query returns zero rows; the CTA routes to the matching create/import journey.

## Journey 1b.3 — Get the first data in (fast path to "someone to call")

*As a new rep, I want to load my prospects in under a minute, so that I can start calling today, not after a data project.*

Activation needs *someone to call*. This journey is the onboarding-time front door to the import machinery specced elsewhere, tuned for speed:

1. From the guide step 4 (1b.1) or the records empty state (1b.2), he picks one of three:
   - **Import a CSV** (doc 5a CSV import) — drag a file → column-map → normalize/validate/flag → done. Best for a real book.
   - **Paste a list** — paste rows of names/numbers → same normalize/flag path → a call list (doc 3).
   - **Add one by hand** — a single New record (doc 4), for the user who just wants to try one call.
2. On import, the normalize→validate→flag pipeline (doc 3 / design rubric §III) coerces phones to E.164, lowercases emails, and **flags** bad rows (accept-but-explain, never silent-drop), so his first list is trustworthy.
3. When the first rows land, the guide auto-advances and the "Make your first call" step lights up **pre-loaded with the top row**, so step 4 → step 5 is one motion.

- **Benchmark (beat this):** **Apollo / Instantly "import and start"** speed — from file to callable list in one flow — Apollo import: https://knowledge.apollo.io/hc/en-us/articles/4409130255885 . For paste-to-list, **Superhuman/Linear** paste ergonomics.
- **Build docs:** reuse doc 5a CSV import + doc 3 list build; onboarding only changes the *entry point* and the auto-advance wiring.

## Journey 1b.4 — Connect your email (optional, high-value step)

*As a user, I want a one-click prompt to connect Gmail/Outlook during setup, so that I immediately see the full history on every account.*

This is doc 5's **Journey 5.4.1** (first-run "why connect" + Connect Google / Connect Microsoft), surfaced as the optional guide step 6.

1. Guide step 6 shows the value ("see every email + calendar event on each account, log automatically") with two buttons: **Connect Google**, **Connect Microsoft**, and **Skip for now**.
2. Clicking runs the OAuth connect (doc 5 Journey 5.7) — including the **scope-verification** repair path (doc 5 Journey 5.7a) if he unticks a permission.
3. On success, the step checkmarks; on skip, it's parked and re-offered later from "Getting started" and from the inbox empty state (1b.2).

- **Benchmark (beat this):** **Attio onboarding — connect email step** — https://attio.com/help/reference/email-calendar/email-and-calendar-syncing .
- **Build docs:** doc 5 Journeys 5.4.1 / 5.7 / 5.7a; onboarding just triggers them and reads the resulting connection state.

## Journey 1b.5 — Save progress, resume, dismiss, re-open

*As a user who gets interrupted, I want my setup progress remembered, so that I can leave and pick up exactly where I stopped.*

1. Every completed step writes to `OnboardingProgress` (per user, per workspace). `Workspace.onboardingStep` tracks the workspace-level furthest point.
2. **Resume:** on next sign-in, if required steps remain, the "Getting started" navbar item shows a small **progress ring** (e.g. 3/5). Clicking re-opens the guide at the first unfinished step.
3. **Dismiss:** "I'll finish later" hides the panel but keeps the navbar item + ring. It never nags with modals.
4. **Auto-complete:** when the last required step is done, the guide shows a brief "You're set up 🎉 — here's what's next" (points at the AI copilot, doc 7), then removes itself and the navbar item.
5. **Derived, not flag-based:** each step's "done" is re-derivable from real state (has ≥1 active number, has ≥1 record, has ≥1 completed call). If a user deletes everything, the relevant steps can legitimately re-open — that's correct, not a bug.

- **Benchmark (beat this):** **Linear / Vercel setup checklists** with a persistent progress indicator that survives refresh and resumes. Attio — setup playbook (phased checklist with a live "0 / X" progress count) [how it works] — https://attio.com/setup ; onboarding-checklist screens across products [visual] — https://www.saasui.design/pattern/onboarding . *Vercel's checklist is the feel we want but is undocumented — treat it as an unlinked reference.*
- **Build docs:** persist `OnboardingProgress`; compute step status from counts on load (cheap aggregate queries), reconcile with stored progress.

## Journey 1b.6 — Re-engage a stalled setup

*As a rep who started setup but got pulled away, I want one gentle nudge pointing at the exact step I'm missing, so that I can finish and make my first call.* **[LATER — needs email/lifecycle]**

1. A background check (job K1) finds workspaces where setup stalled (e.g. bought a number but made no call in 48h, or imported data but never called).
2. It sends **one** helpful nudge (in-app banner first; email only if he opted in) tied to the exact missing step — "You're one step from your first call" — linking straight to it. Capped and easy to turn off (respect notification prefs, Journey 1a.13).
3. Never nags: at most a small, dismissible sequence; stops the moment he activates.

- **Benchmark (beat this):** **Superhuman / Linear onboarding nudges** — specific, single-step, easy to silence.
- **Build docs:** pg-boss scheduled `onboarding-nudge-scan` (see job K1); respects `OnboardingProgress` + notification prefs; idempotent per user per step.

## Journey 1b.7 — Team-invite onboarding (the second seat) **[LATER — multi-user, doc 11]**

*As a teammate joining a workspace that's already set up, I want to skip the workspace-level setup and only do my personal steps, so that I land productive fast.*

When a second person joins (Journey 1a.4 / doc 11 invitations), the workspace already has numbers and data. His onboarding is **different**: skip "buy a number / import data" (workspace-level, done), keep **personal** steps (profile 1a.9, mic check 1.4, connect his own mailbox 5.4.1, make his first call). The guide detects "workspace already set up" and shows only the person-level checklist.

- **Benchmark (beat this):** **Slack / Attio member onboarding** — a joiner sees a lighter, personal checklist, not the founder's. https://attio.com/help/academy/attio-for-product-led-growth/onboarding-your-team .
- **Build docs:** guide reads workspace-level state (numbers/data exist) vs user-level `OnboardingProgress` to choose the checklist.

---

## Background jobs

- **K1 — Onboarding nudge scan** **[LATER]**. **Trigger:** pg-boss schedule (e.g. every few hours). Steps: find workspaces/users with an incomplete required step past a threshold (number-but-no-call 48h; data-but-no-call; started-but-idle); emit at most one in-app/email nudge for the specific missing step; record it so it's not repeated; stop on activation. `retryLimit: 2`, idempotent on `(userId, step)`. Respects notification prefs (Journey 1a.13).
- **K2 — Step-status recompute.** **Trigger:** on app load and after any onboarding-relevant mutation (number bought, import finished, call completed). Steps: cheap count queries (active numbers, records, completed calls) → derive step status → reconcile with `OnboardingProgress` and `Workspace.onboardingStep`. Inline (not queued); it's what makes progress self-healing (Journey 1b.5 step 5).

---

## Decisions for you

**1. Sample/demo data, or start empty?** — **My pick: start empty, but make import a one-minute step (Journey 1b.3), not demo rows.** Demo data in a *calling* app is dangerous — a rep could dial a fake number or get confused about what's real. Option B (seed demo contacts) speeds the empty-state look but risks a real dial to fake data and cleanup friction. Go empty + fast-import; if we ever want a tour, use a clearly-labeled read-only "example" that can't be dialed.

**2. Product tour (spotlight walkthrough) vs checklist-only?** — **My pick: checklist + targeted coachmarks (the dialer coachmark from 1.7), not a full click-through tour.** Full tours get skipped and age badly. The one place a coachmark earns its keep is the easy-to-miss corner dialer (already in 1.7 step 4). Add coachmarks only where a control is genuinely hidden.

**3. Required vs optional steps?** — **My pick: required = number, mic check, first call; optional = profile, first data, email.** Activation (the metric above) needs the required three; data/email accelerate value but shouldn't block the first call. (Profile is optional but pre-filled from sign-up where possible.)

---

## Data model (Prisma) — additions relative to doc 1 / 1a

```prisma
model OnboardingProgress {              // NEW — per user, per workspace
  id           String    @id @default(cuid())
  user         User      @relation(fields: [userId], references: [id])
  userId       String
  workspace    Workspace @relation(fields: [workspaceId], references: [id])
  workspaceId  String
  completedSteps String[]               // e.g. ["profile","number","mic","data","call","email"]
  dismissedAt  DateTime?                // "I'll finish later" (panel hidden, ring stays)
  activatedAt  DateTime?                // set when the activation moment is reached (metric)
  lastNudgeStep String?                 // for K1 dedupe [LATER]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@unique([userId, workspaceId])
}
// Workspace.onboardingStep (already in doc 1) stays the workspace-level furthest point.
```

## Technical decisions, trade-offs & edge cases

- **Onboarding state is derived, not "seen once"** (Journey 1b.5 step 5): step completion is re-computable from counts (numbers, records, calls). This is the same rule as doc 1's buy-a-number banner — it's why refresh, revoke, delete-all, and workspace-switch never leave a broken or nagging state.
- **We never block the first call on optional steps** (Decision 3): data and email accelerate value but the required path (number → mic → call) is the shortest line to activation.
- **No dialable demo data** (Decision 1): in a calling app, seeded fake numbers are a real hazard; onboarding invests in one-minute import instead.
- **Joiner onboarding differs from founder onboarding** (Journey 1b.7): the guide reads workspace-level vs user-level state so a second seat isn't asked to re-buy a number. **[LATER]**
- **Nudges are capped, specific, and opt-out-respecting** (Journey 1b.6 / K1): at most one per missing step, in-app first, honoring notification prefs (Journey 1a.13). **[LATER]**
```
