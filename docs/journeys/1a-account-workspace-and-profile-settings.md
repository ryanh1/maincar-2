# Doc 1a — Account, Workspace & Profile Settings

Boilerplate but load-bearing: the screens where a user **manages his workspaces** (create, switch, rename, join, leave, transfer, delete) and **his own account** (name, job title, email, avatar, password). Doc 1 (P0) already ships two thin slices of this — sign-up creates the first workspace (Journey 1.1) and the top-left switcher adds/switches (Journey 1.3). This doc is the **full CRUD home** for both, so nothing is half-specced.

**Why its own doc:** the design rubric ([design-principles-and-benchmarks.md](../development-guidelines/design-principles-and-benchmarks.md) §I) says every object needs **full CRUD + Read-Many, config, sharing, relations, guardrails**. `Workspace` and `User` are objects too — this doc gives them that treatment. Onboarding (the *first-run* flow) is its own doc: [1b](1b-onboarding.md).

**Format:** same as [Doc 1](1-auth-and-basic-dialer.md) — numbered journeys, benchmarks (beat this) kept separate from build docs, decisions with my pick first.

**Note on multi-user.** Some journeys here (join, leave, transfer, invite) only fully matter once **multi-user** lands ([doc 11](11-multiuser-teams-and-permissions.md)). For the solo P0 user, a workspace has exactly one member (owner). I still spec the multi-member paths and mark them **[LATER]** so the guardrails exist the day a second person joins, rather than being bolted on. The invitation *mechanics* live in doc 11; this doc covers the *settings-side* journeys and the guardrails.

---

## How to read this doc

- **Screens** = the settings surfaces this doc adds.
- **Journeys** = the user's click-by-click path.
- **Background jobs** = work the app does on its own, with a trigger and rough timing.
- **Benchmark (beat this)** vs **Build docs** are kept separate, as in doc 1.
- **Decisions for you** = open choices, two options, my pick first.

---

## Screens in this doc

1. **Workspace switcher** — the top-left dropdown (from Journey 1.3), now with the full menu: your workspaces, "Create workspace," and a gear to **Workspace settings**.
2. **Settings shell** — a left-nav settings layout with two groups: **Account** (just you: Profile, Security, Preferences) and **Workspace** (this workspace: General, Members, Danger zone). Members/roles detail lives in [doc 11](11-multiuser-teams-and-permissions.md); this doc owns Profile, Security, Preferences, Workspace → General, and Danger zone.
3. **Create-workspace dialog** — name + optional avatar.
4. **Avatar cropper** — a small modal to upload and crop a square photo (user avatar and workspace avatar share it).
5. **Danger zone** — leave / transfer / delete, each behind a typed or explicit confirm.

**Entry points (never make him hunt).** Settings is reachable from **(a)** the user menu at the bottom of the left navbar → "Settings," and **(b)** the workspace switcher's gear → jumps straight to **Workspace → General**. Deep links: `/settings/profile`, `/settings/workspace/general`, etc. (URL-as-state, per [doc 12a](../development-guidelines/12a-engineering-conventions.md)), so any journey below can be linked to directly.

---

# Part A — Workspace CRUD

`Workspace` is the top-level tenant. Everything (numbers, calls, records) is scoped to one. A user can belong to **many** and switches between them (Journey 1.3).

## Journey 1a.1 — Create a workspace

*As a user, I want to create a new workspace, so that I can keep a separate book of business (e.g. a second company or a test space) apart from my main one.*

Doc 1's Journey 1.1 creates the **first** workspace during sign-up. This is the **anytime** create, for a user who already has one.

1. User clicks the workspace name (top-left) → the switcher dropdown opens (Journey 1a.2).
2. Clicks **"Create workspace."** A small dialog opens with one required field, **Workspace name**, and an optional **avatar** (defaults to initials on a colored tile — see Journey 1a.11 for the cropper).
3. He types a name → clicks **Create**. The button shows a spinner (create is a real DB write + membership row).
4. **Background job B1a runs** (see below): create `Workspace`, create an owner `Membership` for him, seed defaults. ~300–800ms.
5. The app **switches into the new workspace** (same reload path as Journey 1.3): empty numbers, empty records, and — because it has zero numbers — the first-run onboarding of [doc 1b](1b-onboarding.md) begins.

**Defensive points.** Name is required (trim; reject empty/whitespace-only with an inline error, not a silent no-op). **Duplicate names are blocked** (decision by Ryan, 2026-08-19, implemented in T-0-002): creating a workspace whose name matches one the user already has is rejected, case-insensitively, with an inline error — *"You already have a workspace called 'Acme'."* *Why this overrides the earlier "allow duplicates with a soft hint" rule:* that rule assumed workspaces are told apart by **avatar/initials**, which don't exist yet — so two same-named workspaces are genuinely indistinguishable in the switcher, and users were creating accidental twins. **Revisit once avatars ship (Journey 1a.11):** at that point the soft-hint behavior becomes viable again if we want it.

- **Benchmark (beat this):** **Slack "Create a workspace"** — one field, instant landing — https://slack.com/help/articles/206845317-Create-a-Slack-workspace ; **Attio** workspace creation for the clean single-field dialog — https://attio.com/help/reference/getting-started .
- **Build docs:** Prisma create with a nested `Membership` create in one transaction; see the data model at the end.

## Journey 1a.2 — See and switch workspaces (Read-Many)

*As a user in more than one workspace, I want to see all of them and jump between them, so that I always know which book I'm in and can move fast.*

This expands doc 1's Journey 1.3 with the exact menu contents and the "which am I in" cues.

1. User clicks the workspace name + avatar (top-left). A dropdown opens showing, top to bottom:
   - The **current** workspace, checkmarked, at the top.
   - Each **other** workspace he belongs to, with avatar + name + his role chip (Owner / Member). Clicking one switches (step 2).
   - A divider, then **"Create workspace"** (Journey 1a.1) and **"Workspace settings"** (gear → Journey 1a.3).
2. Clicking another workspace **switches context**: the app reloads that workspace's numbers, records, and views, and the URL's workspace segment updates. In-flight work in the old workspace (an open composer, a dialing session) prompts "Leave and switch?" if it would be lost.
3. The **last-used workspace is remembered** per user (server-side on `User.lastWorkspaceId`), so sign-in (Journey 1.2) lands him back where he was.

**Keyboard.** The switcher opens with a shortcut and is arrow-key navigable (per the keyboard system, doc 4b). Target: switch workspaces **keyboard-only**.

**Edge cases.** If he belongs to **one** workspace, the switcher still opens (for Create + Settings) but shows no "other workspaces" list. If he belongs to **zero** (e.g. he just left his last one — Journey 1a.5), he lands on a full-screen "Create or join a workspace" state, never a broken empty app.

- **Benchmark (beat this):** **Slack / Attio / Linear** top-left workspace switcher — instant switch, current one clearly marked — Linear — workspaces & the top-left switcher [visual: switcher + admin settings screenshots] — https://linear.app/docs/workspaces ; Attio — the control panel switcher [visual] — https://attio.com/help/reference/attio-101/introduction-to-navigating-attio ; Slack switcher — https://slack.com/help/articles/1500002200741 .
- **Build docs:** workspace membership rides in the Firebase ID token as a custom claim (doc 1, Journey 1.3 build doc); the server re-checks it on every request (the claim is a hint, not the authority).

## Journey 1a.3 — Rename a workspace / edit General settings

*As a workspace owner, I want to rename the workspace and set its avatar, so that it's labeled correctly for everyone in it.*

1. User opens **Settings → Workspace → General** (via the switcher gear, or the user menu → Settings, then the Workspace group).
2. He sees **Workspace name** (text), **Workspace avatar** (Journey 1a.11), and read-only facts (created date, workspace id, member count).
3. He edits the name → clicks **Save**. Optimistic update in the switcher and header; a toast confirms.

**Permission — "disabled for some."** The name and avatar fields are **editable only by an Owner/Admin**. For a Member, the fields render **disabled** with helper text "Only an owner can change workspace details." (This mirrors the Loadwire `OrganizationTab`, where org name is `disabled={!isAdmin}` with the same helper line.) In solo P0 the single user is always Owner, so he can always edit; the gate is inert until multi-user.

**Defensive points.** Name required (same trim/empty rule as 1a.1). Save is disabled while the field is empty or unchanged.

- **Benchmark (beat this):** **Loadwire `OrganizationTab`** (internal) for the exact pattern — a single name field, admin-gated with a helper line, save on the right. Make it look at least as clean as **Linear → Settings → Workspace**.
- **Build docs:** `updateMany({ where: { id, workspaceId }, data })` defense-in-depth (doc 12a); re-check role server-side.

## Journey 1a.4 — Join a workspace (accept an invitation)

*As an invited teammate, I want to accept an invite and land in the workspace, so that I can start working with the team.* **[LATER — needs multi-user, doc 11]**

The invitation *mechanics* (creating/sending/revoking invites, roles) live in [doc 11](11-multiuser-teams-and-permissions.md). Here is the **joiner's** path and its guardrails, so the settings side is complete.

1. Invitee clicks the invite link (`/join/:token`). The app fetches the **public** invitation by token: workspace name, the email it was sent to, the offered role(s), and an expiry. Nothing sensitive is exposed.
2. **If the token is invalid, expired, or already used** → a clean "Invitation unavailable" screen with a link to sign in. (No guessing whether it was real.)
3. **If he has no account** → he sets name, job title, and password on this screen (the invite email is fixed, shown read-only), then submits → account created → added as a `Membership` with the offered role → signed in → lands in the workspace. *(This mirrors Loadwire's `JoinOrg` accept flow.)*
4. **If he's already signed in** (has an account) → the screen shows "Join **Acme** as Member?" with one **Join** button; on click he's added and switched into it.
5. **Guardrail — email match.** The invite is bound to an email. If the signed-in user's email ≠ the invite email, warn "This invite was sent to dana@acme.com but you're signed in as sam@acme.com" and offer to sign out / switch, rather than silently attaching the wrong account.

- **Benchmark (beat this):** **Loadwire `JoinOrg`** (internal) for the accept-and-provision flow; **Slack "Join a workspace"** for the already-signed-in join — https://slack.com/help/articles/212675257-Join-a-Slack-workspace .
- **Build docs:** `POST /auth/accept-invitation` (token, password, name, title) → create user + membership in one transaction; token is single-use and time-boxed (doc 11).

## Journey 1a.5 — Leave a workspace

*As a member, I want to leave a workspace I no longer work in, so that it stops cluttering my switcher.* **[LATER — needs multi-user]**

1. User opens **Settings → Workspace → General → Danger zone** (or a "Leave workspace" item in the switcher's per-workspace hover menu).
2. Clicks **"Leave workspace."** A confirm dialog names the workspace and says what he loses access to.
3. On confirm → his `Membership` is removed → he's switched to another workspace he belongs to, or (if none) the "Create or join a workspace" state (Journey 1a.2 edge case).

**Guardrail — the sole owner can't just leave.** If he's the **only Owner**, leaving would orphan the workspace. Block it with: "You're the only owner. **Transfer ownership** (Journey 1a.6) or **delete the workspace** (Journey 1a.7) first." This is the key guardrail that keeps a workspace from becoming ownerless.

- **Benchmark (beat this):** **Slack "Leave a workspace"** — https://slack.com/help/articles/201391308 ; **GitHub** org-leave guardrail for the sole-owner block.
- **Build docs:** `deleteMany({ where: { userId, workspaceId } })`; before delete, count owners and refuse if this is the last one.

## Journey 1a.6 — Transfer ownership

*As a workspace owner, I want to hand ownership to a teammate, so that I can leave or step back without orphaning the workspace.* **[LATER — needs multi-user]**

1. **Settings → Workspace → Members** (doc 11) → the owner picks a member → **"Make owner"**, or from Danger zone **"Transfer ownership."**
2. A confirm dialog explains: the chosen member becomes Owner; the current owner is **demoted to Admin/Member** (his pick) and loses owner-only powers (delete workspace, billing later).
3. Optional safety: **type the workspace name** to confirm (same widget as delete, Journey 1a.7), because it's high-consequence.
4. On confirm → roles swap in one transaction → a toast + an in-app/email notice to the new owner.

- **Benchmark (beat this):** **GitHub "Transfer repository/organization ownership"** — explicit, typed confirm, notifies the new owner — https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository .
- **Build docs:** transactional role swap; guard that the target is an existing active member.

## Journey 1a.7 — Delete a workspace

*As a workspace owner, I want to permanently delete a workspace and its data, so that I can clean up a test or wind down a book, safely, without deleting the wrong one.*

1. **Settings → Workspace → General → Danger zone → "Delete this workspace."**
2. A **red confirm dialog** spells out what's destroyed (all records, calls, numbers, views — with counts, e.g. "12,481 records, 3 phone numbers, 4,102 calls") and that **numbers will be released** and it **cannot be undone after the grace period**.
3. **Type-to-confirm:** he must type the exact workspace name into a field before the destructive button enables (prevents deleting the wrong workspace). *(This is the GitHub "danger zone" pattern.)*
4. On confirm → **Background job B2a runs**: the workspace is **soft-deleted** immediately (disappears from his switcher, all access cut) and hard-deletion is **scheduled for 30 days later** (consistent with the app's 30-day trash, doc 5a). Owned Twilio numbers are **released** on soft-delete (they cost money) after a short hold. A one-time "Workspace 'Test' deleted — restorable for 30 days" toast + email gives an undo path.
5. **Restore within 30 days:** superadmin console (doc 13) or a "recently deleted workspaces" affordance can restore data, but **released numbers may not be recoverable** — say so plainly.

**Guardrails.** Owner-only. Type-to-confirm. Soft-delete + grace window (not instant hard-delete). Explicit note that number release is effectively irreversible. If billing exists later, block delete on an unpaid balance (revisit when billing lands).

- **Benchmark (beat this):** **GitHub "Delete a repository"** danger zone — typed confirm, blunt copy about permanence — https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository ; **Attio** workspace deletion for the SaaS-tenant framing.
- **Build docs:** soft-delete flag + `deletedAt`; pg-boss `hard-delete-workspace` scheduled +30d, idempotent on `workspaceId`; number-release calls Twilio (idempotent on `twilioSid`, doc 1 B1).

---

# Part B — Account & Profile settings

`User` is the person. These journeys are the same for everyone regardless of workspace (a user's name/photo follow him across all his workspaces).

## Journey 1a.8 — Open Settings and find your way around

*As any user, I want an obvious Settings area split into "just me" and "this workspace," so that I know where to change what.*

1. User clicks the **user menu** at the bottom of the left navbar (avatar + name) → **"Settings."** Lands on **Settings → Account → Profile** by default.
2. The settings shell is a **left-nav + content** layout (like Attio/Linear settings), two groups:
   - **Account** (follows the person): **Profile**, **Security**, **Preferences**.
   - **Workspace** (this workspace): **General**, **Members** (doc 11), **Danger zone**, plus feature settings other docs own (Numbers → doc 1; Email/Calendar → doc 5; etc.).
   ```
   ┌─────────────── Settings ───────────────────────────────┐
   │ ACCOUNT            │  Profile                           │
   │   • Profile   ◀────┼──  [ avatar ]  Change photo        │
   │   • Security       │    First name [ Dana ]             │
   │   • Preferences    │    Last name  [ Reeve ]            │
   │ WORKSPACE          │    Job title  [ Account Exec ]     │
   │   • General        │    Email      dana@acme.com [Change]│
   │   • Members        │                                    │
   │   • Danger zone     │                        [ Save ]   │
   └────────────────────┴────────────────────────────────────┘
   ```
3. Each pane loads at its own URL (`/settings/<group>/<pane>`), so it's deep-linkable and back/forward works (URL-as-state, doc 12a).

- **Benchmark (beat this):** **Linear Settings** and **Attio Settings** — the calm left-nav split of personal vs workspace, generous whitespace, one primary action per pane. Linear — workspace settings (the member-vs-admin split) [visual] — https://linear.app/docs/workspaces ; Linear — Preferences (the calm toggle list) [visual] — https://linear.app/docs/account-preferences ; Attio — workspace settings & billing [how it works] — https://attio.com/help/reference/workspace-settings-billing .
- **Build docs:** section containers follow the house rule — plain `<section>` + `<h2>` + separators, no card borders on settings panels (doc 12a).

## Journey 1a.9 — Edit your profile (name and job title)

*As a rep, I want to set my name and job title, so that my calls, emails, notes, and @mentions show the right identity.*

1. **Settings → Account → Profile.** He sees **First name**, **Last name**, **Job title** (e.g. "Account Executive"), the **Email** field (Journey 1a.10), and the **avatar** (Journey 1a.11).
2. He edits a field → **Save** (bottom-right). Optimistic: his name updates in the navbar, mentions, and signature preview right away; a toast confirms.

**Where the name shows.** Call-from caller-ID display name, email "From" name + default signature (doc 5), @mentions and note authorship (doc 4d), assignee chips. So this is not cosmetic — flag that downstream.

**Defensive points.** Names trim; empty is allowed for last name but not first (need something to display) — or fall back to the email local-part if both are blank, never render a nameless user.

- **Benchmark (beat this):** **Loadwire `ProfileTab`** (internal) — first/last/title, save-on-the-right, disabled email. Beauty bar: **Linear profile settings**.
- **Build docs:** `PATCH /me` (firstName, lastName, title); update the Firebase Auth `displayName` too so tokens carry it.

## Journey 1a.10 — Change your email

*As a user, I want to change my sign-in email, so that I can move to a new address — but only in ways that keep my account secure.*

Email is the **login identity** (Firebase Auth), so this is more than a text field.

1. **Settings → Account → Profile → Email** shows the current email with a **"Change"** link (the field itself is read-only, like Loadwire).
2. Click **Change** → a dialog asks for the **new email** and, for security, **re-authentication** (re-enter password, or re-do the SSO handshake).
3. On submit → **a verification link is sent to the new address** (Firebase `verifyBeforeUpdateEmail`). The email **does not change** until he clicks that link. Until then a banner says "Pending: verify dana@newco.com."
4. He clicks the link → email updated → old address gets a "your email was changed" security notice.

**"Disabled for some" (the requested gate).** The **Change** control is **hidden/disabled** when the account's identity is **externally owned**: (a) **SSO/SAML-provisioned** users (doc 11) — email comes from the IdP, so we show "Managed by your identity provider (Okta). Contact your admin."; (b) optionally, **non-owner members** in an org that enforces managed identities. In solo P0 (email/password) the user *can* change it. So: email-change is enabled for self-serve password accounts, disabled for IdP-managed ones.

**Decision — verify-before-update vs update-then-verify.** **My pick: verify-before-update** (option A): send a confirmation to the *new* address and only switch on click. It prevents typo-ing yourself out of your account and prevents hijacking via a mistyped address. Option B (change immediately, then verify) is simpler but risks lockout. Go with A — Firebase's `verifyBeforeUpdateEmail` does exactly this.

- **Benchmark (beat this):** **Google Account email change** (verify new address before switch) — https://support.google.com/accounts/answer/19870 ; disabled-because-SSO copy modeled on **Linear/Notion** SSO-managed accounts.
- **Build docs:** Firebase `verifyBeforeUpdateEmail` — https://firebase.google.com/docs/reference/js/auth#verifybeforeupdateemail ; reauthenticate first — https://firebase.google.com/docs/auth/web/manage-users#re-authenticate_a_user .

## Journey 1a.11 — Set, crop, and remove an avatar photo

*As a user, I want to upload a profile photo and crop it to a nice square, so that I'm recognizable in mentions, call cards, and the member list.* (This is the "add back the avatar" ask.)

**Applies to both** the **user avatar** (Profile) and the **workspace avatar** (Workspace → General) — same cropper component, different target.

**One canonical avatar field.** The user's photo is stored once on **`User.avatarUrl`** and shown everywhere (mentions, call cards, member lists). The profile *page* in [doc 5b Journey 5.9d](5b-reporting-and-dashboards.md) lets a person edit their photo too — it uses **this same cropper** and writes the **same `User.avatarUrl`** (its `UserProfile.photoUrl` should defer to / be unified with `User.avatarUrl`, not a second copy), so there's one source of truth.

1. In Profile (or Workspace → General), he clicks the **avatar tile** (or a "Change photo" button under it). Default state before any upload: **initials on a colored tile** (color derived from the name/id — deterministic, so it's stable).
2. A file picker opens (accepts PNG/JPG/WebP, e.g. ≤ 10MB). He picks an image.
3. **The cropper modal opens:** the image with a **square crop frame**, a **zoom slider**, and drag-to-reposition. (Circular mask preview, since avatars render as circles.) Buttons: **Cancel**, **Save**.
   ```
   ┌──────────── Crop your photo ────────────┐
   │        ╭───────────────╮                │
   │        │   ( drag to    │   ← square/    │
   │        │    reposition) │     circular   │
   │        ╰───────────────╯     crop frame  │
   │   Zoom  ────────●────────                │
   │                       [ Cancel ] [ Save ]│
   └──────────────────────────────────────────┘
   ```
4. He adjusts → **Save**. **Background job B3a runs:** the browser exports the cropped square (e.g. 512×512) → uploads to object storage (MinIO/S3) → the stored URL is written to `User.avatarUrl` (or `Workspace.avatarUrl`). Optimistic: the new avatar shows immediately with a tiny spinner until the upload settles.
5. **Remove photo:** a "Remove" action clears `avatarUrl` → falls back to initials tile. (Never leaves a broken image.)

**Defensive points.** Reject non-images and oversize files with a clear inline reason (accept-but-explain, never silent). Strip EXIF on the server. Generate a couple of sizes (e.g. 512 for detail, 64 for lists) or resize on the fly. If upload fails, keep the old avatar and toast the error — don't blank it.

**Decision — crop in the browser or store original + crop server-side?** **My pick: crop in the browser, upload the finished square** (option A) — simplest, no server image pipeline needed for MVP, instant preview. Option B (store original, remember crop box, render server-side) is more flexible for re-cropping later but adds an image service. Go with A now; keep the original file too if cheap, so re-crop is possible later.

- **Benchmark (beat this):** **Slack / Linear avatar upload + crop** — pick image → square crop with zoom → done — Slack: https://slack.com/help/articles/205479998-Upload-a-profile-photo . For the interaction feel, **`react-easy-crop` demo** — https://valentinh.github.io/react-easy-crop/ .
- **Build docs:** **`react-easy-crop`** (zoom/drag, outputs crop pixels) — https://github.com/ValentinH/react-easy-crop ; export via canvas to a Blob; upload to MinIO/S3 (doc 12 local-first). Presigned-URL upload so the file doesn't round-trip through the API server.

## Journey 1a.12 — Security: change password & sign out everywhere

*As a user, I want to change my password and be able to sign out of all sessions, so that I keep my account secure.*

1. **Settings → Account → Security.** Shows: **Change password**, **Sign out of all devices**, and (read-only) how he signs in (password vs SSO).
2. **Change password:** current password → new password (min length, strength hint) → confirm → save; requires recent re-auth. On success, other sessions are optionally invalidated.
3. **Sign out everywhere:** revokes refresh tokens so every other device must sign in again (Firebase `revokeRefreshTokens`). Useful after a lost laptop.
4. **SSO accounts:** password controls are hidden — "You sign in with Okta." (mirrors the email gate, Journey 1a.10).

- **Benchmark (beat this):** **Google → Security** and **Linear → Security** for the plain, reassuring layout.
- **Build docs:** Firebase `updatePassword` + `reauthenticateWithCredential`; `revokeRefreshTokens` (Admin SDK) for sign-out-everywhere — https://firebase.google.com/docs/auth/admin/manage-sessions .

## Journey 1a.13 — Preferences (timezone, locale, notifications)

*As a user, I want to set my timezone and notification preferences, so that times display correctly and I'm pinged how I like.*

1. **Settings → Account → Preferences.** Shows **Timezone** (IANA, defaulted from the browser `Intl.DateTimeFormat().resolvedOptions().timeZone`, per doc 12a date rules), **Date/number locale**, and **Notification** toggles (which events email/notify him — detail in doc 4e attention/notifications).
2. Edits save on change (or Save button), toast confirms.

**Why timezone matters here.** Every human-facing time in the app is rendered in an explicit zone with a label (doc 12a). This is where `User.timeZone` is set/edited; call logs, scheduled sends (doc 5), and calling-hours guardrails (doc 3) all read it.

- **Benchmark (beat this):** **Linear → Preferences** for the tidy toggle list; timezone picker like **Google Calendar settings**.
- **Build docs:** store `User.timeZone`, `User.locale`; notification prefs table (doc 4e).

---

## Background jobs (what happens on its own)

- **B1a — Create workspace.** **Trigger:** Create in Journey 1a.1 (and the sign-up create, Journey 1.1). Steps: in one transaction create `Workspace`, create owner `Membership`, seed defaults (a starter view set, default field schema from doc 4). ~300–800ms; the user waits on the button spinner. Not queued — it's interactive and must feel instant. **pg-boss** only for the *seeding* if it's heavy; otherwise inline.
- **B2a — Delete workspace (soft → hard).** **Trigger:** confirmed delete in Journey 1a.7. Steps: set `deletedAt` now (immediate cut-off + removed from switcher); enqueue `release-workspace-numbers` (Twilio release, idempotent on `twilioSid`, `retryLimit: 3`) after a short hold; enqueue `hard-delete-workspace` for **+30 days** (`retryLimit: 3`, idempotent on `workspaceId`). A cancel/restore before +30d removes the scheduled hard-delete.
- **B3a — Avatar upload.** **Trigger:** Save in the cropper (Journey 1a.11). Steps: client exports the cropped square → requests a presigned upload URL → PUTs to MinIO/S3 → server validates content-type/size, strips EXIF, writes `avatarUrl`. ~0.5–2s. On failure, keep the prior avatar and surface the error.
- **B4a — Email change verification.** **Trigger:** submit new email (Journey 1a.10). Firebase sends the verification mail; the switch happens when the user clicks the link (webhook/next-load reconciles `User.email`). Old address is emailed a security notice.

---

## Decisions for you

**1. Where does account vs workspace settings live?** — **My pick: one Settings shell, two groups (Account / Workspace).** Matches Attio/Linear and keeps "just me" separate from "this workspace." Option B (separate top-level pages) scatters it. Go with the split shell (Journey 1a.8).

**2. Email change: verify-before-update vs update-then-verify?** — **My pick: verify-before-update** (Journey 1a.10). Prevents self-lockout and hijack. Firebase supports it directly.

**3. Avatar: crop in browser vs server-side pipeline?** — **My pick: crop in the browser, upload the square** (Journey 1a.11). Simplest MVP; keep the original if cheap for later re-crop.

**4. "Disabled for some" — what gates workspace-name and email edits?** — **My pick: role for workspace name (owner/admin only), identity-source for email (self-serve password = editable; SSO/SAML-managed = disabled with "managed by your IdP").** This matches Loadwire's admin-gated org name and the SSO reality coming in doc 11. Solo P0 users hit none of the gates.

---

## Data model (Prisma) — additions relative to doc 1

Only **new** fields/models are shown; everything else is inherited from doc 1.

```prisma
model User {                         // extends doc 1
  // ...existing (id, email, displayName, memberships, createdAt)
  firstName        String?           // NEW — Journey 1a.9
  lastName         String?           // NEW
  title            String?           // NEW — job title
  avatarUrl        String?           // NEW — Journey 1a.11 (null → initials tile)
  timeZone         String?           // NEW — IANA, Journey 1a.13 (defaulted from browser)
  locale           String?           // NEW — Journey 1a.13
  lastWorkspaceId  String?           // NEW — land back here on sign-in (Journey 1a.2)
  pendingEmail     String?           // NEW — set during email-change until verified (1a.10)
  updatedAt        DateTime @updatedAt // NEW — house rule (doc 12a)
}

model Workspace {                    // extends doc 1
  // ...existing (id, name, onboardingStep, memberships, numbers, calls, createdAt)
  avatarUrl   String?                // NEW — workspace avatar (Journey 1a.11)
  deletedAt   DateTime?              // NEW — soft-delete + 30-day grace (Journey 1a.7)
  updatedAt   DateTime  @updatedAt   // NEW
}

model Membership {                   // extends doc 1 — role already present
  // role String @default("owner")   // owner | admin | member (multi-user is doc 11)
  // No new fields here; ownership transfer (1a.6) and leave (1a.5) mutate `role`/delete the row.
}
```

## Technical decisions, trade-offs & edge cases

- **Every settings write is workspace- or user-scoped and role-checked server-side.** Workspace edits use `updateMany({ where: { id, workspaceId } })` (defense-in-depth, doc 12a); the owner/admin check is re-verified on the server, never trusted from the client's disabled state.
- **Deleting a workspace never hard-deletes instantly** (Journey 1a.7): soft-delete + 30-day grace + scheduled hard-delete, matching the app-wide 30-day trash (doc 5a). The one genuinely irreversible part — **releasing Twilio numbers** — is called out to the user, because a released number may not be re-obtainable.
- **Sole-owner guardrail** (Journeys 1a.5–1a.7): a workspace must always have ≥1 owner. Leaving as sole owner is blocked; ownership transfer is the escape hatch; delete is the other. This is checked in a transaction (count owners before removing/demoting).
- **Email is identity, not a plain field** (Journey 1a.10): changing it goes through re-auth + verify-before-update, and is disabled entirely for IdP-managed accounts. This avoids the two classic failure modes — locking yourself out with a typo, and drifting out of sync with the SSO source of truth.
- **Avatars are user gestures over HTTPS with content validation** (Journey 1a.11): presigned upload keeps large files off the API path; EXIF stripped; non-images/oversize rejected with a reason; failures preserve the old avatar. Default is a deterministic initials tile so there's never a broken image.
- **URL-as-state for settings** (doc 12a): each pane has its own path so deep links, back/forward, and the switcher gear all land precisely. No modal-only settings that can't be linked to.
```
