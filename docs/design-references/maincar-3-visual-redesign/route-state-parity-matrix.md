# Route / state parity matrix

Source: [`README.md`](./README.md) in this folder. Read that first for what the mockup is
and where it came from.

**How to read "Mockup coverage":** the mockup is two desktop artboards, light mode only.
A cell is only marked covered when the mockup literally shows that exact route in that
exact viewport/theme combination. Everything else is `—` (not shown), not a guess at what
it should look like — per MAI-542, this ticket records observable values only and does not
infer unseen states.

Rows below cover the routes and shared overlays named in [MAI-542](https://linear.app/maincar2/issue/MAI-542/capture-the-durable-visual-reference-and-routestate-parity-matrix)'s
own scope, which matches the [project](https://linear.app/maincar2/project/maincar-3-visual-redesign-73cff79097ca)'s
stated scope. The full current route list (for context on what's *outside* that scope) is
at the bottom.

## Legend

- ✅ = the mockup shows this exact cell
- — = not shown by the mockup (not covered, not inferred)

| # | Route / overlay | Component(s) | Meaningful states | Light · Desktop | Light · Mobile | Dark · Desktop | Dark · Mobile |
|---|---|---|---|:-:|:-:|:-:|:-:|
| 1 | `/home` — Home | `pages/Home.tsx` | single state (static account summary; no loading/error/empty variants exist today) | — | — | — | — |
| 2 | `/auth/sign-in` — Sign in | `pages/auth/SignIn.tsx` | default form, submit-error banner, submitting | — | — | — | — |
| 3 | `/auth/sign-up` — Sign up | `pages/auth/SignUp.tsx` | default form, submit-error banner, submitting | — | — | — | — |
| 4 | `/join/:token` — Invitation join | `pages/JoinOrg.tsx` | loading · dead-link (404) · unreachable/other-error (with retry) · wrong-account / server-mismatch · invited-person accept (with role badges) · no-account create-or-sign-in form | — | — | — | — |
| 5 | `/settings/profile` — Profile | `pages/Settings_ProfileTab.tsx` | default form (name, job title, read-only email), saving | **✅** (`settings-profile.html`) | — | — | — |
| 6 | `/settings/members` — Members and invitations | `pages/Settings_MembersTab.tsx` + `Settings_Members_InviteForm.tsx`, `Settings_Members_PendingInvites.tsx`, `Settings_Members_RoleEditor.tsx` | default table, error, empty (`rows.length === 0`), invite-form dialog, pending-invites list, role editor | — | — | — | — |
| 7 | `/settings/phone-numbers` — Phone numbers | `pages/Settings_PhoneNumbersTab.tsx` + `Settings_PhoneNumbers_BuyDialog.tsx`, `Settings_PhoneNumbers_AssignDialog.tsx` | default table, error, empty (`numbers.length === 0`), buy dialog, assign dialog | — | — | — | — |
| 8 | Application shell | `components/ProtectedLayout.tsx`, `components/Sidebar.tsx` | signed-in chrome (nav rail + top bar), global `PageLoader` while auth resolves, mobile collapsed-sidebar toggle | partially implied by row 1 and row 5's shared nav rail (see note below) | — | — | — |
| 9 | Organization switcher | `components/OrgSwitcher.tsx` | closed trigger, open dropdown (org list + "create organization"), switching (`switchOrg.isPending`) | closed trigger only, implied by rows 1 and 5 (see note below) | — | — | — |
| 10 | Dialogs (shared primitive) | `components/ui/dialog.tsx`, used by 20+ feature dialogs across the app (lists, calendar, phone numbers, voicemail drops, data model, …) | open/close, form-inside-dialog, destructive confirm (`alert-dialog.tsx`) | — | — | — | — |
| 11 | Device check | `components/DeviceCheck.tsx`, `components/GreenRoom.tsx` | loading devices, mic/speaker selection, mic-denied, readiness-failed, retry | — | — | — | — |

**Note on rows 8–9:** the mockup's nav rail (workspace name, favorites/records/lists
sections, account footer) is present, unchanged, on *both* artboards — so it's a real
observed value, just not an independent state the mockup calls out on its own. The
organization switcher's **open dropdown** and the shell's **mobile/collapsed** treatment
are not shown anywhere in the mockup.

## Bonus: a screen not in the named scope, but present in the mockup

The mockup's left artboard, **"Companies grid"** (`companies-grid.html`), is a new grid
workspace with no current matching route — the closest existing thing is `/lists/:listId`
(`pages/CrmGrid.tsx`), which renders Glide Data Grid rather than this table treatment. It
is not in MAI-542's or the project's named scope list, so it isn't a matrix row above, but
it's real mockup content and later scoping work (e.g. a future companies-grid ticket)
should know it exists and where to find it.

| Screen | Light · Desktop | Light · Mobile | Dark · Desktop | Dark · Mobile |
|---|:-:|:-:|:-:|:-:|
| Companies grid (no current route) | **✅** (`companies-grid.html`) | — | — | — |

## Full current route list (context — most of these are outside this project's scope)

Every route registered in [`vite/src/App.tsx`](../../../vite/src/App.tsx), for reference.
Rows 1–7 above are the subset the project names; everything else here is unscoped for
Maincar-3 Visual Redesign unless a later ticket says otherwise.

| Route | Component |
|---|---|
| `/auth/sign-in`, `/auth/sign-up` | `SignIn`, `SignUp` — row 2–3 above |
| `/join/:token` | `JoinOrg` — row 4 above |
| `/home` | `Home` — row 1 above |
| `/calls` | `Calls` |
| `/calls/:id` | `CallDetail` |
| `/calendar` | `CalendarWorkspace` |
| `/voicemails` | `Voicemails` |
| `/voicemails/:id` | `VoicemailDetail` |
| `/voicemail-drops` | `VoicemailDrops` |
| `/records/:slug` | `Records` |
| `/records/:slug/:recordId` | `RecordPage` |
| `/reports` | `Reports` |
| `/tasks` | `Tasks` |
| `/lists/:listId` | `CrmGrid` |
| `/welcome` | `Welcome` (onboarding step 1) |
| `/create-org` | `CreateOrg` (onboarding step 2) |
| `/settings` | `SettingsLegacyRedirect` → `/settings/profile` |
| `/settings/profile` | `Settings_ProfileTab` — row 5 above |
| `/settings/members` | `Settings_MembersTab` — row 6 above |
| `/settings/phone-numbers` | `Settings_PhoneNumbersTab` — row 7 above |
| `/settings/organization`, `/teams`, `/call-recordings`, `/inbound`, `/dispositions`, `/next-steps`, `/voicemail-greeting`, `/email-templates`, `/signatures`, `/integrations`, `/data-model`, `/notifications`, `/keyboard`, `/alerts` | Other `Settings` tabs (all render inside the same `Settings` shell as row 5) |
| `/admin/sync-health` | `AdminSyncHealth` (superadmin-only, separate `AdminLayout` shell) |

## What later issues should do with this matrix

Per MAI-542's acceptance criteria: each later visual-redesign issue links to this file and
marks which rows it covers as it ships. Do not check a row until the shipped screen has
been compared against the mockup (where one exists) or against the written system
requirements in MAI-509 (where the mockup is silent).

## Shipped coverage

- **[MAI-546](https://linear.app/maincar2/issue/MAI-546/apply-the-visual-redesign-to-settings-members-invitations-and-phone)**
  shipped rows 5–7 (Profile, Members and invitations, Phone numbers). Row 5 was built
  against `settings-profile.html` through [decision-list.md](./decision-list.md); rows 6–7
  have no mockup cell (the matrix still reads `—` for them, per the legend), so they were
  built against `design-system.md` and the decision list's written rules instead.
  MAI-546 also changed the global `--primary` token from indigo (`#4f46e5`) to the
  decision list's teal (`#0E7490`) — a deliberate, user-approved exception to keeping this
  ticket scoped to Settings, since `--primary` is an app-wide token. Everything outside
  Settings inherits the new color automatically; no other screen's markup changed.
