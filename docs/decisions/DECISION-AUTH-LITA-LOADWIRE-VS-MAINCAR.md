# Decision record: lita/loadwire auth vs maincar auth

**Status:** Accepted (D7 open)
**Linear:** MAI-9
**Applies to:** MAI-5, MAI-6, MAI-7, MAI-8 — read this before implementing any of them.
**Last verified against source:** 2026-08-20

---

## What this is

Three shipped auth-and-tenancy implementations were compared to decide the shape of
authentication, org membership, invitations and member management in maincar-2.

| Repo | Path on disk | Role in the comparison |
|---|---|---|
| `lita` | `../lita` | Reference implementation A |
| `loadwire` | `../loadwire` | Reference implementation B |
| `maincar` | `../maincar` | Reference implementation C |

**`lita` and `loadwire` are the same design.** They share a scalar-tenancy schema, a
server-side signup, a Resend-backed invite, and near-identical `team.ts` routers.
Where they differ, it is in UI polish and in which of the two shipped a given screen
first. **`maincar` is the outlier on every structural question** — and, as it turns
out, the right one on nine of the ten.

Ten decisions follow. Each gives the two approaches, a pros/cons table, and a
recommendation with the reasoning behind it.

> **On citations.** Every file/line reference below was re-checked against the repos
> on disk on 2026-08-20. Corrected line numbers are marked *(corrected)*; claims that
> could not be confirmed as originally stated are marked **(amended)** with what the
> code actually does. Line numbers drift — treat them as a starting point, and trust
> the symbol name over the number.

---

## Decision summary

| # | Question | Winner | Confidence |
|---|---|---|---|
| D1 | Tenancy model | **maincar** — `Membership` join table | High |
| D2 | Account creation | **maincar** — client SDK + JIT provisioning | High |
| D3 | Offboarding | **maincar** — deactivate the membership | High |
| D4 | Role vocabulary | **maincar** — shape, with our own role names | High |
| D5 | Invite delivery | **maincar** — copy-link only | High (also what was asked for) |
| D6 | Invitation security | **maincar** — every row | Very high |
| D7 | Row-level security | **Defer, with a seam** | **Open — argue with this one** |
| D8 | Email verification | **lita** — its flow, with one fix | High |
| D9 | List paging | **maincar** server, **loadwire** UI | High |
| D10 | Self-service restrictions | **maincar** — no self-ban | Medium-high |

---

## D1 — Tenancy: `User.orgId` vs `Membership` join table

**Winner: maincar.**

### Approach A — lita/loadwire: scalar `User.orgId`

`User.orgId` is a required scalar. One user belongs to exactly one org, forever.
Roles are a `String[]` on `User` itself.

- `lita/server/prisma/schema.prisma:46` — `orgId String` on `User`
- `lita/server/prisma/schema.prisma:49` — `roles String[] @default(["basic"])` on `User`
- Every org-scoped model carries `orgId` with an index; the request carries
  `authReq.orgId` and every query reads it.

### Approach B — maincar: `User` <-> `Membership` <-> `Workspace`

Roles are a `String[]` on `Membership`, with `isActive` for offboarding.

- `maincar/server/prisma/schema.prisma:108-125` — the `Membership` model,
  `@@unique([userId, workspaceId])`
- `maincar/server/prisma/schema.prisma:117` — `roles String[] // owner | admin | manager | rep`
- `maincar/server/prisma/schema.prisma:120` — `isActive Boolean @default(true)`
- `maincar/server/prisma/schema.prisma:24` — `lastWorkspaceId String?` on `User`, so a
  returning user lands back where they were *(the ticket called this `lastOrgId`; the
  concept is identical, the column name is `lastWorkspaceId`)*

### Pros and cons

| | lita/loadwire — `User.orgId` | maincar — `Membership` |
|---|---|---|
| **Pro** | Simplest possible code. Every query is `where: { orgId }`. | Multi-org is native. |
| **Pro** | No org switcher, no "which org am I in" state anywhere. | Roles are per-org, which is what roles actually are. |
| **Pro** | The tenant key is on the request; it cannot be forgotten in a join. | Offboarding keeps history instead of destroying it. |
| **Pro** | — | Matches how every B2B SaaS the customer already uses behaves. |
| **Con** | **An email can never be in two orgs.** Firebase enforces one account per email, so this is a hard wall, not an inconvenience. | More code: a switcher, `lastWorkspaceId`, an `authorize()` call in every route. |
| **Con** | A consultant, a dealer group, or anyone who changes employer needs a second email address. | "Which org is this request for?" becomes a question every route has to answer. |
| **Con** | Roles are global-per-person, so a person cannot be an admin here and a rep there. | An extra join on read paths. |

### Recommendation

**Adopt maincar's `Membership` join table.**

The deciding factor is **direction of travel**, not present-day cost. Retrofitting
`Membership` onto a live `User.orgId` schema means a data migration *plus* touching
every query in the codebase. Going the other way — deciding later that multi-org was
overkill — is deleting a table.

The extra cost is one `authorize()` helper and one org switcher, both already written
in maincar (`maincar/server/src/routes/invitations.ts:319-336`). That is copy-paste,
not design work.

**Keep lita's vocabulary: call it `Org`, not `Workspace`. Keep `profile`.** maincar
says "workspace" throughout; lita says "org". One name for one thing, and `Org` is the
name the rest of maincar-2 already uses.

---

## D2 — Account creation: server Admin SDK vs client SDK

**Winner: maincar.**

### Approach A — lita/loadwire: server-side creation

`POST /auth/signup` creates the Firebase user with the Admin SDK, then creates `Org` +
`User` in one Prisma transaction, deleting the Firebase user if the transaction fails.
The client then signs in.

- `lita/server/src/routes/auth.ts:95-120` — the signup handler: validate, then
  `createFirebaseUser({ email, password })`, then a transaction
- `lita/vite/src/pages/auth/JoinOrg.tsx:42` — **verified exactly.** A five-attempt
  `signInWithRetry` loop with exponential backoff (`250 * 2 ** attempt`), retrying on
  `"Incorrect email or password."` and `"Something went wrong. Please try again."`
- `lita/vite/src/pages/auth/SignUp.tsx:35` — the same loop, copied

That retry loop is the tell. It exists purely because the client races to sign in
against an account the server just made.

### Approach B — maincar: client SDK + just-in-time provisioning

The client calls `createUserWithEmailAndPassword`; the server lazily creates the
`User` row on the first authenticated request.

- `maincar/vite/src/pages/SignUp.tsx:22` and `maincar/vite/src/pages/JoinWorkspace.tsx:135`
  — `createUserWithEmailAndPassword`
- `maincar/server/src/middleware/requireAuth.ts:28-49` — `ensureUser(uid, email)`,
  called from the middleware at line 81. maincar uses the Firebase uid *as* the `User`
  primary key, so when an account is deleted and recreated the same address arrives
  under a new uid and `ensureUser` repoints the existing row (line 44).

### Pros and cons

| | lita/loadwire — Admin SDK on the server | maincar — client SDK + JIT |
|---|---|---|
| **Pro** | The DB row is guaranteed to exist when the user lands. | **The password never touches our server.** |
| **Pro** | Terms acceptance and password policy enforced in one server-side place. | No orphan-rollback problem — there is nothing to roll back. |
| **Pro** | One round trip creates everything. | Self-heals when a Firebase account is recreated under a new uid. |
| **Con** | The password transits our server. | A `User` row can exist with no org, so the app needs a "no org yet -> create one" route. |
| **Con** | Rollback is best-effort: a crash between the Firebase create and the Prisma commit leaves an orphaned Firebase account. | Terms acceptance is a separate write. |
| **Con** | The client races the server, hence the retry loop. | First-request latency includes a provisioning write. |

### Recommendation

**Adopt maincar's client-side creation with JIT provisioning.**

Three reasons, in order of weight: not having the password reach our server is a
genuine security win and removes us from a whole class of incident; the five-attempt
retry loop is a real fragility that only exists to paper over the race; and the
uid-reconciliation branch fixes the exact local-dev pain of wiping the Auth emulator
while Postgres keeps its rows.

> **Note for maincar-2:** we adopted the pattern but not maincar's uid-repointing
> branch — see the status table below. Our provisioning refuses to re-link a
> recreated Firebase account and returns 409 `email_already_linked` instead, because
> silently re-linking on email alone is an account-takeover path. That is a
> deliberate improvement on maincar, and it means the local-dev convenience above is
> **not** something we inherited.

---

## D3 — Offboarding: disable the user vs deactivate the membership

**Winner: maincar.**

### The two approaches

| | loadwire — disable the account | maincar — deactivate the membership |
|---|---|---|
| Mechanism | `User.enabled = false` plus `setFirebaseUserDisabled()` | `Membership.isActive = false` plus `revokeRefreshTokens()` |
| Blast radius | The account dies platform-wide | The account survives; only this org's access ends |
| Citation | `loadwire/server/src/routes/team.ts:403` — `setFirebaseUserDisabled(target.firebaseUid, !enabled)`, best-effort with a `.catch` | `maincar/server/src/routes/invitations.ts:756` — `adminAuth.revokeRefreshTokens(targetUserId)`, best-effort, after the membership write |

### Pros and cons

| | loadwire — disable the user | maincar — deactivate the membership |
|---|---|---|
| **Pro** | Absolute: the person cannot sign in anywhere, immediately. | Removing someone from Org A cannot touch their access to Org B. |
| **Pro** | One switch, easy to reason about. | History and audit trail survive — a deactivated membership still explains who did what. |
| **Pro** | — | Re-adding someone is a flag flip, not a re-invite from zero. |
| **Con** | **Incompatible with D1.** Under multi-org it is a footgun with a global blast radius held by any org admin. | Every membership read must remember to filter on `isActive`. |
| **Con** | Firebase-level state and DB-level state can disagree if the best-effort call fails. | Revoking refresh tokens only ends *live sessions*; access control is the `isActive` filter, so that filter is load-bearing. |

### Recommendation

**Adopt maincar's membership deactivation.** It follows directly from D1: removing
someone from Org A must not lock them out of Org B.

**Keep loadwire's Firebase-disable — but as a separate, later, *platform staff*
"suspend account" action.** It is a different action with a different meaning and a
different actor. Do not let an org admin reach it.

---

## D4 — Role vocabulary

**Winner: maincar's shape.**

### Approach A — lita/loadwire: `basic | admin | superadmin`

- `lita/server/prisma/schema.prisma:49` — `roles String[] @default(["basic"])`
- `lita/server/src/routes/auth.ts:432` — on invite acceptance,
  `Array.from(new Set(["basic", ...invitation.roles]))` — `basic` is force-added to
  every set
- `loadwire/server/src/routes/team.ts:660` — "Superadmin access required to invite a
  superadmin" — a platform-staff concept living inside the org role list

Every set must contain `basic`. `superadmin` is jammed into the same list as org roles.

### Approach B — maincar: `owner | admin | manager | rep`

- `maincar/server/src/lib/roles.ts:11` — `ROLE_VALUES = ['owner','admin','manager','rep']`
- `maincar/server/src/lib/roles.ts:16-23` — `assignableRoleSchema` excludes `owner`
  entirely; ownership moves by transfer, never by editing a member row
- `maincar/server/src/lib/roles.ts:32-36` — `assignableRolesSchema` is `.min(1)`:
  **empty sets are refused, not defaulted**
- `maincar/server/src/lib/roles.ts:52` — `isAdminRole` treats `owner` as carrying
  admin authority without the literal role
- There is **no platform role anywhere in the org role list.** *(Amended: maincar has
  no `User.isPlatformAdmin` column either — it simply has no platform-staff concept
  yet. `isPlatformAdmin` below is our proposal, not something to copy.)*

### Pros and cons

| | lita/loadwire — `basic \| admin \| superadmin` | maincar — `owner \| admin \| manager \| rep` |
|---|---|---|
| **Pro** | Tiny vocabulary, nothing to learn. | `owner` is structural, not assignable — ownership can only move by transfer. |
| **Pro** | `superadmin` gives support staff a way in without a second system. | No platform role in the org list, so an org admin cannot mint platform staff via an invite. |
| **Pro** | — | Empty role sets are refused. A membership with no roles is a removal wearing the costume of a role change. |
| **Pro** | — | Canonical sort order, so a stored set never depends on click order. |
| **Con** | **The mandatory `basic` is pure ceremony** — it appears in every set and grants nothing. | Four names to explain, two of which (`manager`, `rep`) are dealer-specific. |
| **Con** | A platform-staff role inside the org role list is a privilege-escalation surface. | `owner` needs its own transfer journey before it can move at all. |
| **Con** | Anyone who can edit a role set can hand out `superadmin` if the guard is ever missed. | — |

### Recommendation

**Adopt maincar's shape.** Two things it gets right that neither of the others do:

1. **`owner` is structural, not assignable.** Excluded from the assignable schema,
   set once at creation, never editable from the member list — and it has a real
   journey that moves it: `POST /workspaces/:id/transfer-ownership`
   (`maincar/server/src/routes/workspace-settings.ts:350-352`), with the member list
   refusing owner edits outright at `maincar/server/src/routes/invitations.ts:628`.
2. **No platform role in the org role list.** Put platform staff on
   `User.isPlatformAdmin` instead — a separate column, a separate concept, out of
   reach of any org admin.

Drop the mandatory `basic`. It appears in every set and grants nothing.

**Start maincar-2 at `owner | admin | member`.** The column is a `String[]`, so adding
`manager` and `rep` later costs a constant. Both approaches already support multiple
roles per user, so nothing is lost by starting small.

> **This is the decision maincar-2 has *not* implemented.** See the status table.

---

## D5 — Invite delivery: email vs copy-link

**Winner: maincar — and it is what was asked for.**

| | lita/loadwire — Resend email + copy-link fallback | maincar — copy-link only |
|---|---|---|
| **Pro** | The invitee gets the link without the admin doing anything. | No Resend dependency, no templates, no deliverability problem. |
| **Pro** | Works when the admin has no side channel to the invitee. | Nothing between "admin clicks invite" and "admin has a link". |
| **Pro** | — | Nothing to test in an email sandbox; the whole flow is testable in-process. |
| **Con** | A third-party dependency in the critical path of onboarding. | The admin must have some way to send the link. |
| **Con** | Deliverability, spam folders, and template drift become our problem. | No record that the invitee was ever actually reached. |
| **Con** | `loadwire/server/src/routes/team.ts:692` shows the shape of the compromise: send is best-effort and swallowed, so a silent failure looks like success. | — |

### Recommendation

**Copy-link only.** It removes Resend, templates, and deliverability from the critical
path of the single most important flow in the product.

The create endpoint returns `link` in its response, so adding email later is one extra
call inside the same handler — not a redesign.

---

## D6 — Invitation security

**Winner: maincar, clearly and on every row.**

| | lita/loadwire | maincar |
|---|---|---|
| **Failure disclosure** | **(amended)** The *public lookup* already returns one message — `"Invalid or expired invitation"` (`lita/.../team.ts:61`, `loadwire/.../team.ts:78`). The oracle is at the **accept** endpoint: `lita/server/src/routes/auth.ts:417-419` returns `"Invalid invitation"` (404), `"Invitation is not pending"` (400) and `"Invitation is expired"` (400) as three distinguishable answers, plus `"This invitation has already been accepted."` (409) at line 500. | One identical `"Invitation unavailable"` for every case, on both the lookup and the accept (`maincar/server/src/routes/invitations.ts:46`) |
| **Token** | 24 bytes hex (`loadwire/.../team.ts:654`, `lita/.../team.ts:682`) | 32 bytes base64url — 256 bits (`maincar/.../invitations.ts:93`) |
| **TTL** | 7 days (`INVITE_EXPIRY_DAYS = 7`, `loadwire/.../team.ts:25`, `lita/.../team.ts:20`) | 14 days (`INVITE_TTL_DAYS = 14`, `maincar/.../invitations.ts:41`) |
| **Rate limit** | None on the public lookup | 30/min on both lookup and accept (`maincar/.../invitations.ts:464` and `:515`) |
| **Email binding** | Implicit. The server creates the account *from* the invite, so a mismatch case never exists and is never handled. | Explicit 409 `code: 'email_mismatch'`, naming both addresses (`maincar/.../invitations.ts:534-536`) |
| **Duplicate invite** | **loadwire silently overwrites** the existing pending invitation with a fresh token (`loadwire/.../team.ts:656-670`) — invalidating a link the admin may already have sent, with no warning at all | Explicit 409: *"There is already a pending invite for {email}. Copy or revoke that one instead."* (`maincar/.../invitations.ts:378-379`) |
| **Regenerate** | Not available | Available — `POST .../invitations/:inviteId/regenerate` (`maincar/.../invitations.ts:430-433`), which kills a leaked link on the spot |

### Recommendation

**Adopt maincar's, all of it.**

Two rows deserve calling out. First, **four distinguishable errors is a probing
oracle**: a scanner can tell a wrong token from a real-but-spent one, and learns that
the org exists. The invitee loses nothing from a single message, because the fix is
the same in every case — ask the admin for a new link.

Second, **loadwire's silent overwrite is an outright bug from the admin's point of
view.** They send a link on Monday, click "invite" again on Tuesday because nothing
happened, and Monday's link is now dead — with no message saying so. Refusing with a
409 and offering copy-or-revoke is the honest behaviour.

---

## D7 — Row-level security

**Recommendation: defer, with a seam. This is the one open question, and the call
most easily argued against.**

### The two approaches

**maincar runs Postgres RLS.** Every query executes inside a workspace context:

- `maincar/server/src/lib/workspaceContext.ts:64` — `runInWorkspace(workspaceId, fn)`
- `maincar/server/src/lib/workspaceContext.ts:84` — `runUnscoped(reason, fn)`, the
  deliberate escape hatch
- `maincar/server/src/lib/workspaceContext.ts:106` — `runWithInvitationToken(...)`, a
  token-keyed policy so the **unauthenticated** invitation lookup can see exactly one row
- `maincar/server/src/prisma.ts:107` — `scopedTransaction`
- `maincar/server/src/prisma.ts:139` — `scopedQueryRaw`
- `maincar/server/src/prisma.ts:160` — `withElevatedDdl`

**lita/loadwire rely on app-level `where: { orgId }` only**, with the tenant key
carried on the request.

### Pros and cons

| | App-level `where` only | Postgres RLS |
|---|---|---|
| **Pro** | Nothing to learn; a new route is just a Prisma call. | Real defence in depth — it catches the query where someone forgets the `orgId` filter. |
| **Pro** | Raw SQL works normally. | The database refuses cross-tenant reads even when the app asks for them. |
| **Pro** | One mental model for reads and writes alike. | A leak needs *two* mistakes, not one. |
| **Con** | **One forgotten filter is a cross-tenant leak.** | Every raw query needs `scopedQueryRaw`; a plain `$queryRaw` silently returns nothing. |
| **Con** | The guarantee is "everyone remembered", which does not scale with headcount. | The unauthenticated invite lookup needs its own token-keyed policy. |
| **Con** | Nothing stops a background job from reading everything. | Reasoning about which context a write runs in is a permanent tax on every new route. |

### Recommendation

**Skip RLS in MAI-5 — but create `server/src/lib/orgContext.ts` with pass-through
`runInOrg()` / `scopedTransaction()` from day one, and route every write through it.**

The pass-through versions do nothing except call the function they were handed. The
point is the call site. Adding RLS later then becomes *migrations plus one file*,
rather than a sweep of the whole codebase touching every route.

**Talk me out of it if either of these is true:**

1. **You plan to hold customer PII across tenants early.** The cost of one forgotten
   filter is no longer an embarrassment; it is a disclosure.
2. **You expect more than one person writing routes soon.** "Everyone remembered the
   filter" is a guarantee that decays with every additional author.

In either case, **copy maincar's RLS now.** It is already written and tested there, so
the cost is mostly the ongoing tax, not the build — and the tax is cheapest to start
paying when there are twenty routes rather than two hundred.

---

## D8 — Email verification

**Winner: lita's flow, with one fix.**

maincar has no email verification at all. lita has a complete gate behind a
`REQUIRE_EMAIL_VERIFICATION` flag:

- `lita/server/src/config.ts` exports the flag; imported at
  `lita/server/src/routes/auth.ts:16`
- `lita/server/src/routes/auth.ts:48` — the gate returns immediately when the flag is off
- `lita/server/src/routes/auth.ts:296` — the flag is reported to the client so the UI
  knows whether to show the gate
- `lita/server/src/routes/auth.ts:511-577` — verify and resend endpoints
- `lita/vite/src/pages/auth/VerifyEmail.tsx` — the screen

| | maincar — nothing | lita — flagged gate |
|---|---|---|
| **Pro** | No code, no screen, no support burden. | Ready to switch on the day it is needed (compliance, abuse, a spammy signup wave). |
| **Pro** | Signup is one step. | Off by default, so it costs nothing until it is wanted. |
| **Con** | Anyone can sign up as anyone; no proof of address anywhere in the system. | A whole flow to maintain that is not exercised in normal use. |
| **Con** | Retrofitting a gate onto a live user base means deciding what to do with existing unverified accounts. | The screen is dead code while the flag is off — and dead code rots. |

### Recommendation

**Port lita's flow and ship it off — `REQUIRE_EMAIL_VERIFICATION` defaulting to
false.** Building it now while there is no user base is far cheaper than retrofitting
it onto one later.

**Fix on the way in.** lita stores verification tokens in an **in-memory `Map`**:

> `lita/server/src/routes/auth.ts:32` *(corrected — the ticket cited line 31, which is
> the comment above it)*
> `const verificationTokens = new Map<string, { userId, firebaseUid, email, expiresAt }>()`
> with a 24-hour TTL at line 33, and lita's own comment conceding *"Tokens survive for
> their TTL but not across server restarts"*.

Every restart drops every pending token, and behind more than one instance it fails
outright — a user verifies against instance A and instance B has never heard of the
token. **Put them in Postgres.** (Note the same anti-pattern at
`lita/server/src/routes/auth.ts:193`, where forgot-password rate limiting is an
in-memory `Map` too. Do not copy that either.)

---

## D9 — List paging

**Winner: maincar's server rigour, loadwire's UI behaviour, maincar's file split.**

Both implementations page in the database. maincar is stricter:

- **Zod `.catch()` defaults**, so a broken query string shows the default list instead
  of a 400 — `maincar/server/src/routes/invitations.ts:61-75`, with the comment
  *"a broken query string shows the default list"*
- **Allow-listed sort keys** — `z.enum(MEMBER_SORT_COLUMNS).catch('joinedAt')`
- **A `createdAt` tie-break** on every ordering, so page 2 is not a reshuffle of page 1
  — `maincar/server/src/routes/invitations.ts:139-153`, where `stable` is appended to
  every `orderBy` array

loadwire has the better UI — filters and pagination held in the query string, a role
multi-select popover, copy-link with transient feedback — but it is **one 1144-line
component**: `loadwire/vite/src/pages/settings/UserManagementTab.tsx` *(verified: 1144
lines exactly)*.

| | loadwire | maincar |
|---|---|---|
| **Pro** | Filters and paging live in the URL, so a view is shareable and survives reload. | A malformed query string degrades to the default list instead of erroring. |
| **Pro** | Role multi-select popover; copy-link with transient confirmation. | Sort keys are allow-listed, so no caller string reaches an `orderBy`. |
| **Pro** | Genuinely pleasant to use. | Stable ordering under pagination. |
| **Con** | 1144 lines in one file — nothing in it can be tested or reused in isolation. | The member table UI is plainer. |
| **Con** | A bad query string can 400 the whole page. | Sorting by role drops to raw SQL (see below). |

### Recommendation

**maincar's server discipline, loadwire's UI behaviour, maincar's file split.** That
split is `maincar/vite/src/pages/settings/Members.tsx` (236 lines) plus
`Members_MemberRow.tsx` (208), `Members_PendingInvites.tsx` (276),
`Members_InviteDialog.tsx` (116) and `Members_Avatar.tsx` (19) — 855 lines across five
files, with fetching in `vite/src/hooks/members/`. Same surface, testable in pieces.

**One carve-out: skip sorting by role in v1.** Prisma cannot `orderBy` a scalar list,
so maincar drops to raw SQL for that one column —
`maincar/server/src/routes/invitations.ts:159-198`, `memberIdsByRoleRank`, a
`scopedQueryRaw` with a `CASE ... = ANY(m."roles")` rank. That raw query is *the single
place in the member-management surface that would need RLS-aware plumbing*, which ties
this decision straight back to D7.

Fall back to **email order**, which is exactly what maincar's own invitation list
already does when asked to sort by roles
(`maincar/server/src/routes/invitations.ts:317-321`, with the comment *"email order is
the useful fallback, not a crash"*).

---

## D10 — Self-service restrictions

**Winner: maincar.**

loadwire blanket-refuses both self-service edits:

- `loadwire/server/src/routes/team.ts:359` *(corrected — ticket cited 341)* —
  `"You cannot change your own enabled status"`
- `loadwire/server/src/routes/team.ts:463` *(corrected — ticket cited 451)* —
  `"You cannot change your own roles"`

maincar has no self-ban. Its protection is a **last-admin check**:
`maincar/server/src/routes/invitations.ts:740-745` throws `LAST_ADMIN` inside the
transaction and answers 409 with *"Promote someone else to admin first. A workspace
always keeps at least one admin."* The rule is stated at
`maincar/server/src/routes/invitations.ts:11`: a workspace never drops to zero admins,
and the last admin cannot be demoted or removed.

| | loadwire — blanket self-ban | maincar — last-admin check only |
|---|---|---|
| **Pro** | Trivially simple; impossible to reason your way into a lockout. | Guards the thing that actually matters: an org with no admin. |
| **Pro** | No transaction needed — it is one `if`. | An admin can demote or remove themselves once someone else can take over. |
| **Pro** | — | The error message tells you the fix ("promote someone else first"). |
| **Con** | **Stops nothing dangerous** once a last-admin guardrail exists. | Needs the check to run inside the transaction, or two concurrent demotions can both pass. |
| **Con** | Forces a second admin to exist for routine cleanup — a solo admin cannot tidy their own row. | Slightly more code. |
| **Con** | Two rules where one would do, and they can disagree. | — |

### Recommendation

**Adopt maincar's.** Once a last-admin guardrail exists, the self-ban stops nothing
dangerous and forces a second admin to do routine cleanup.

**Keep the last-admin check — run it inside the transaction. Drop the self-ban.**

---

## Where maincar-2 actually stands today

Checked against the working tree on 2026-08-20. Several of these decisions are no
longer proposals — they are shipped, and one is shipped *differently* from what this
record recommends.

| # | Decision | State in maincar-2 | Notes |
|---|---|---|---|
| D1 | `Membership` join table | **Built** | `server/prisma/schema.prisma:79-96`. Vocabulary is `Org` and `profile` as recommended. `lastOrgId` shipped as **`User.currentOrgId`** (`schema.prisma:64`). |
| D2 | Client SDK + JIT | **Built, with a deliberate divergence** | `vite/src/pages/auth/SignUp.tsx:23` creates client-side. Provisioning lives in `GET /api/auth/me` (`server/src/routes/auth.ts:117`), **not** in `requireAuth` — which returns 401 for an unprovisioned uid (`server/src/middleware/auth.ts:182-186`). We use a separate `firebaseUid` column rather than uid-as-PK, and we **refuse** to re-link a recreated Firebase account, answering 409 `email_already_linked`. That is safer than maincar's repointing branch, but it means D2's local-dev benefit does not apply to us. |
| D3 | Deactivate the membership | **Not built** | There is **no `isActive` on `Membership`** and no member-removal route at all. `User.enabled` exists (`schema.prisma:52`) and is enforced as a 403 in `requireAuth` — i.e. we currently sit on the **loadwire** side of D3. |
| D4 | Role vocabulary | **Contradicted** | Shipped as `basic \| admin` for org roles and `basic \| admin \| superadmin` globally (`server/src/lib/roles.ts`), defaulting to `["basic"]` in the schema. That is **lita's vocabulary**, including the ceremonial `basic` this record recommends dropping, and it keeps `superadmin` as a platform role on `User.roles` rather than an `isPlatformAdmin` column. maincar's *shape* is partly honoured — `assignableRolesSchema` is `.min(1)` and refuses empty sets, and `OrgRole` deliberately excludes `superadmin` — but there is no `owner` role, so **ownership transfer has no representation**. Reconcile before MAI-6. |
| D5 | Copy-link only | **Built** | No Resend anywhere. |
| D6 | Invitation security | **Built, every row** | Single `"Invitation unavailable"` (`server/src/routes/invitations.ts:32`), 32-byte base64url token (`server/src/routes/team.ts:338`), 14-day TTL (`team.ts:25`), 30/min rate limits on lookup and accept, email-bound 409, duplicate-invite 409 (`team.ts:420`), regenerate (`team.ts:479`). |
| D7 | RLS seam | **Not built** | **`server/src/lib/orgContext.ts` does not exist.** There is no `runInOrg`, no `scopedTransaction`, and no RLS. `server/src/lib/membership.ts` (`requireMembership`) is the app-level tenant gate. The seam this record asks for is still to do. |
| D8 | Email verification | **Not built** | No `REQUIRE_EMAIL_VERIFICATION`, no verify screen, nothing. |
| D9 | List paging | **Partly built** | `GET /api/team/orgs/:orgId/members` (`server/src/routes/team.ts:274`) pages via `buildPaginationParams` in `server/src/lib/queryHelpers.ts` — manual `parseInt` with clamping rather than Zod `.catch()`, but with the same effect: a broken query string gets defaults, not a 400. Ordering is a fixed `{ createdAt: 'asc' }`; **there is no sorting, no sort allow-list, and no role sort**, so D9's carve-out is already satisfied by omission. |
| D10 | No self-ban | **Half-built** | There is no self-ban — but there is also **no last-admin check anywhere**, and no route to edit a member's roles or remove a member. D10 is only safe once the last-admin guard exists; right now neither half is there. |

**Net:** D1, D2, D5 and D6 are shipped. D3, D7, D8 and the member-management half of
D9/D10 are still to build. **D4 is shipped against this record's recommendation** and
needs an explicit reconcile-or-overrule before MAI-6 builds on it.

---

## Summary

**Nine of ten decisions go to maincar on structure and safety, and to lita/loadwire on
screens and UI polish.** maincar is the outlier in this comparison because it was
written later, against harder requirements, by someone who had already made the
lita/loadwire mistakes once.

That is the shape of MAI-5 through MAI-8:

> **maincar's server, lita's auth screens, loadwire's member-management UI.**

The one genuinely open question is **D7 (row-level security)**. Everything else on
this page would simply be built.

---

## Citation ledger

Every reference re-checked on 2026-08-20 against the repos on disk.

**Verified exactly as cited**

- `lita/vite/src/pages/auth/JoinOrg.tsx:42` — `signInWithRetry`, 5 attempts, `250 * 2 ** attempt` backoff
- `loadwire/vite/src/pages/settings/UserManagementTab.tsx` — 1144 lines
- `loadwire/server/src/routes/team.ts:654` — `randomBytes(24).toString("hex")`
- `loadwire/server/src/routes/team.ts:25` — `INVITE_EXPIRY_DAYS = 7`
- `loadwire/server/src/routes/team.ts:656-670` — the silent overwrite of a pending invite
- `maincar/server/src/routes/invitations.ts:41,46,93,378-379,430-433,464,515,534-536` — TTL, single message, token, duplicate 409, regenerate, rate limits, email mismatch
- `maincar/server/src/lib/roles.ts:11,16-23,32-36` — role values, `owner` excluded, `.min(1)`
- `maincar/server/src/lib/workspaceContext.ts:64,84,106` and `maincar/server/src/prisma.ts:107,139` — the RLS helpers
- `lita/server/prisma/schema.prisma:46,49` — scalar `orgId`, `roles String[]` on `User`

**Corrected**

- Self-ban messages: cited as `loadwire/server/src/routes/team.ts:341,451`; actually
  **`:359`** (enabled status) and **`:463`** (roles)
- In-memory verification token `Map`: cited as `lita/server/src/routes/auth.ts:31`;
  actually **`:32`** (line 31 is the comment above it)
- `lastOrgId`: maincar's column is **`lastWorkspaceId`** (`schema.prisma:24`);
  maincar-2 shipped it as **`User.currentOrgId`**

**Amended — the claim was not accurate as written**

- **D6, failure disclosure.** lita's and loadwire's *public lookup* endpoints already
  return a single `"Invalid or expired invitation"` (`lita/.../team.ts:61`,
  `loadwire/.../team.ts:78`), not distinct messages. The probing oracle is real but
  lives at the **accept** endpoint — `lita/server/src/routes/auth.ts:417-419` plus
  `:500` — where four distinguishable answers are returned. The recommendation is
  unchanged; the row now points at the right code.
- **D4, `User.isPlatformAdmin`.** No such column exists in maincar. maincar has no
  platform-staff concept at all. `isPlatformAdmin` is this record's **proposal**, not
  a pattern to copy from maincar.

**Confirmed on a second pass, after an initial miss**

- **maincar's file split (D9)** is real and is the model to copy:
  `maincar/vite/src/pages/settings/` holds `Members.tsx` (236), `Members_MemberRow.tsx`
  (208), `Members_PendingInvites.tsx` (276), `Members_InviteDialog.tsx` (116) and
  `Members_Avatar.tsx` (19) — **855 lines across five files** against loadwire's 1144
  in one, with data fetching further split into `vite/src/hooks/members/`.
- **maincar's `owner` transfer journey is shipped**, not merely intended:
  `maincar/server/src/routes/workspace-settings.ts:350-352` —
  `POST /workspaces/:id/transfer-ownership`, with the candidate list built at `:107`
  and the member-list route refusing owner edits at
  `maincar/server/src/routes/invitations.ts:628` (*"The owner's role changes by
  transferring ownership, not from this list."*). This strengthens D4: `owner` is only
  structural because there is a real journey that moves it.

**Could not confirm**

- Nothing outstanding. Every claim in this record was traced to code in one of the
  three repos, except the two entries under **Amended** above, which were corrected.
