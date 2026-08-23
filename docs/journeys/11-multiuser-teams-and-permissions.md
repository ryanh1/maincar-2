# Doc 11 — Multi-user, Teams, Permissions & Collaboration

Everything that turns the solo app into a team app: **invitations, roles, teams, access control, SSO/SCIM, data-retention policy, and Slack**. The app is single-user today, so **almost all of this is [LATER]** — but it's specced now so the data model is ready and identity/deletion don't need a rewrite later.

**Honest bottom line (from the research):** when a *second seat* first appears, only four things actually matter — **invitations, the rep/manager/admin roles, teams, and Slack**. Everything else (granular per-object/field permissions, SAML SSO, SCIM provisioning, GDPR retention policies) is **enterprise gating you sell *into* an org later**, when a buyer with IT and legal stakeholders shows up. A solo user needs **none** of it. Each journey below says **who cares** and **so that** what.

**Benchmarks:** **Attio** (simple Admin/Member + per-object/list access), **Linear** (invite + don't-bill-until-accepted), **HubSpot** (teams & partitioning), **Salesforce** (the reference model: separate "what actions" from "which records"; field-level security; role hierarchy), **WorkOS** (SSO/SCIM build-vs-buy), **Slack** (deal-event posting).

**Phase note:** tags below are real — **[NEAR-TERM]** = build when the second seat lands; **[LATER]** = enterprise, build when an enterprise buyer needs it. Nothing here is single-user.

**Journey numbering:** doc 11, so journeys are `Journey 11.1`, `11.2`, …

**Covers (from your list):** invitations (create/accept/view), roles (rep/manager/admin + internal super-admin), teams (full CRUD + rollup); per-list access control, per-attribute edit restriction, SAML SSO, SCIM provisioning, per-workspace GDPR retention/deletion. **Slack moved to its own doc, [11a](11a-slack-integration.md).**

---

## Journey 11.1 — Invite someone to the workspace [NEAR-TERM]

*As an admin, I want to invite a teammate by email and pick their role, so that they can join and start working the moment I hire them.*

1. In **Settings → Members**, the admin enters an **email** and picks a **role** (rep / manager / admin, Journey 11.3) and optionally a **team** (11.4).
2. The system sends an **invite email**. A **pending invites** list shows each invite with **resend / revoke / copy-link**.
3. **Seat accounting (Linear's good pattern):** a seat is consumed by an active member **or** a pending invite. **Billing itself is built much later** (there is no billing system in the app yet — see doc 14 / the superadmin console doc 13). So today "seat accounting" is just the **count** of active + pending seats shown in Settings → Members; **no charge happens on accept**. The design note to preserve for when billing lands: **don't start billing a seat until the invitee accepts and first logs in** — so an unaccepted invite never charges. Until then, seats are free and uncounted-against-money.

- **Benchmark (beat this):** Linear — invite members — https://linear.app/docs/invite-members ; Attio — manage members & teams — https://attio.com/help/reference/workspace-settings-billing/manage-members-and-admins
- **Build docs:** internal — `Invitation` model (below); email via the existing send path.

## Journey 11.2 — Accept an invitation [NEAR-TERM]

*As an invited teammate, I want to accept and join with one click, so that I'm in the workspace without a setup hassle.*

1. The invitee clicks the email link. If they have **no account**, they create one (or SSO in, 11.8); if the email **already has an account**, they **join the workspace** from it.
2. On acceptance the seat flips from pending to active and their role/team apply. They land in the workspace.

- **Benchmark (beat this):** Linear — members & roles — https://linear.app/docs/members-roles ; HubSpot — invite users
- **Build docs:** internal — invite-token acceptance; new-account vs join-existing branch.

## Journey 11.3 — Roles: rep / manager / admin (+ super-admin) [NEAR-TERM]

*As an admin, I want a fixed set of roles, so that a manager can coach without being an admin, a rep can't break settings, and I don't have to design a permission system.*

The universal three-tier model, with the key design insight baked in — **separate "what actions you can perform" (role) from "which records you can see" (ownership + team)**:

1. **Rep** — sees/edits **their own** records, logs activity, moves their own deals. No settings, no other people's data.
2. **Manager** — sees the **whole team's** pipeline for coaching/forecasting (visibility rolls up the team, Journey 11.4), can reassign ownership and report across reps. No billing/global config.
3. **Admin** — workspace settings, billing, seats, roles, data model, integrations.
4. **Super-admin (internal to our company)** — a person who **works at our company** and can **do anything in any workspace**. This is the operator identity behind the superadmin console ([doc 13](13-superadmin-console.md)) — cross-workspace by design, used for support and operations. It is **not** something a customer admin can grant; it's set on our side. Every super-admin action inside a customer workspace is via **audited, time-boxed impersonation** (doc 13.4), never silent. Distinct from a customer's own "admin," who is scoped to their single workspace.

**These four are the *only* roles. No custom permission sets — ever (decision below).** You asked to kill the idea entirely, and I agree: custom permission sets are the single biggest source of CRM permission sprawl and support load, and a solo-to-SMB product doesn't need them. If a real buyer ever demands finer control, the two [LATER] hooks that cover 95% of it are **per-list access** (Journey 11.6) and **field-level lock** (Journey 11.7) — targeted, not a general permission-builder.

**No DB enums — text fields.** Per your preference, `role` (and every other status-like column across the app) is a **`String`**, not a Prisma/Postgres `enum` — enums are painful to migrate (adding a value is a migration) and text is flexible. The **four values above are the only allowed ones**, validated in the app layer (a Zod union / TypeScript literal type), not by the database. Same pattern already used for `Call.status`, `Workflow.status`, etc.

**Who can change roles & permissions — the authority map (the thing you asked about).** Since there are no custom permission sets, "changing permissions" reduces to a small, fixed set of admin actions. **Only an `admin` can change any of these; a `manager` can coach and reassign records but cannot administer access; a `rep` can change nothing here.** Every change is written to the **audit log** (who changed what, on whom, when) and enforced **server-side**, not just hidden in the UI:

| What you change | Who may change it | Journey |
|---|---|---|
| A member's **role** (rep↔manager↔admin) | admin | 11.3.1 |
| **Remove** a member (offboard) | admin | 11.3.2 |
| **Team** create/edit/delete + **team lead** | admin | 11.4.1–11.4.4 |
| **Per-list** access grants | the list's owner **or** an admin | 11.6.1 |
| **Field-level** lock | admin | 11.7 |
| **Slack** connect/disconnect | admin | 11a.2 / 11a.7 |
| **Workflow** build/edit (acts on others' data) | admin or manager (reps: own-record only) | doc 10.1 / 10 perms |
| **Super-admin** (grant the cross-workspace operator) | our company only — **never** a customer admin | doc 13 |

- **Benchmark (beat this):** Salesforce — roles, profiles, permission sets (we take the role idea, *reject* the permission-set complexity) — https://www.salesforceben.com/salesforce-roles-profiles-permission-sets/ ; Attio — simple Admin/Member — https://attio.com/blog/permissions-in-attio
- **Build docs:** internal — `Membership.role` (String, app-validated to the four values); two independent checks on access (action-permission, then record-visibility). Super-admin is a flag on the **User** (`isSuperAdmin`), not a workspace membership, so it spans all workspaces.

### Journey 11.3.1 — Change a member's role [NEAR-TERM]

*As an admin, I want to change a teammate's role, so that their permissions match what they actually do now.*

1. **Entry point.** **Settings → Members** → a member's row → a **role dropdown** (rep / manager / admin) inline on the row. (Same list the invite flow, 11.1, lives on.)
2. **Who can do it:** **admin only.** The dropdown is disabled (with a tooltip "Only admins can change roles") for managers and reps, **and** the server rejects the change if the caller isn't an admin — never trust the UI alone.
3. **Guardrails (the ways this can go wrong, handled):**
   - **Never zero admins.** Demoting the **last** admin is blocked: "Promote someone else to admin first." A workspace must always have ≥1 admin.
   - **Self-demotion** is allowed only if another admin exists (so you can't lock yourself and everyone out).
   - **Promoting to admin** shows a confirm ("Admins can change billing, settings, integrations, and everyone's data").
   - Changing **to/from manager does not touch team *membership*** — being a manager (role) and leading a team (assignment, 11.4.3) are independent, so a role change never silently adds or drops a person from a team.
   - **Demoting a manager who currently *leads* a team is blocked** — with the same guarded-resolution as elsewhere: "Dana leads **2 teams** (West, Enterprise). A team lead must be a manager, so reassign those leads before demoting — or pick a new lead now." This upholds the 11.4.1 invariant (*a team lead must be a manager*) so a demotion can never leave a rep as a team lead who can't even see their own team.
4. **Effect** is immediate: the member's very next request is re-checked against the new role (the role rides in their session claim, re-read server-side). An **audit-log** entry records it.

- **Benchmark (beat this):** Linear — members & roles — https://linear.app/docs/members-roles ; Attio — manage members — https://attio.com/help/reference/workspace-settings-billing/manage-members-and-admins
- **Build docs:** internal — update `Membership.role`; enforce **two** pre-write guards in the transaction (≥1 active admin; a `leadUserId` of any live team can't drop below manager); write an audit entry; bust the member's cached claim.

### Journey 11.3.2 — Remove a member (offboard) [NEAR-TERM]

*As an admin, I want to remove someone who has left, so that they lose access and their records don't go orphaned.*

1. **Entry point.** **Settings → Members** → member row → **⋯ → Remove from workspace**.
2. **Who can do it:** **admin only**; the **last admin can't be removed** (same guard as 11.3.1).
3. **The reassign step (so records aren't orphaned).** A confirm dialog asks **what to do with the person's owned records**: **reassign to another user** (an owner picker, defaulting to their team lead) or **leave them owned-by-removed** (visible to admins only). Nothing is deleted.
4. **On confirm:** the person's `Membership` is **deactivated** (`isActive=false`) — they lose access to *this* workspace immediately and their session is revoked. Their **`User` account is untouched** (they may belong to other workspaces); this is a workspace offboard, not an account deletion.
5. **Distinct from two neighbors:** IdP-driven auto-deprovisioning across an org is **11.8 (SCIM)**; hard-erasing a *data subject's* personal data is **11.9**. Removing a *teammate* is this journey.

- **Benchmark (beat this):** Linear — deactivate members — https://linear.app/docs/members-roles ; WorkOS — offboarding — https://workos.com/guides/user-provisioning-scim
- **Build docs:** internal — `Membership.isActive=false`; reassign `ownerId` on the person's records in the same transaction; revoke session claims; audit entry.

## Journey 11.4 — Teams [NEAR-TERM]

*As an admin, I want to group reps into teams with a lead, so that a manager sees their group's pipeline and reports/forecasts roll up by team.*

This was underspecified before — you couldn't picture the CRUD UI. Below: the **model + terminology decisions** first (answering your questions), then the four CRUD journeys (11.4.1 Create, 11.4.2 Read/list, 11.4.3 Update, 11.4.4 Delete), then how rollup + dedup work (11.4.5).

**Terminology — role vs. assignment (answers "should we call it team leader?").** Keep the two ideas separate, the same action-vs-record split as Journey 11.3:
- **"Manager" is a *role*** (the permission tier — can see a team's records, coach, report). Set on the person once.
- **"Team lead" is a per-team *assignment*** (this person leads *this* team). A team has **one lead**; a person can be the lead of **many teams**. (Co-leads on one team are [LATER].)
- So: a **manager** (role) is set as the **team lead** (assignment) of one or more teams. A rep's "manager" = the lead(s) of the team(s) they're on.

**Multiple teams → multiple managers (answers your chain of questions).** A rep can be on **more than one team**. If those teams have **different leads**, the rep has **multiple managers**, and **each of them can see that rep's records** — the visibility resolver returns the **union** of "records I own" + "records owned by anyone on a team I lead."

**Dedup — where it matters and where it doesn't (answers "dedupe or adjust filters?").**
- **Visibility** is a **set** by construction — the resolver returns a **distinct set of user-ids** a viewer may see, so a rep who is on two of the *same* manager's teams appears **once**. No dedup code needed; it's a set union.
- **Rollups / forecasting** dedup at the **record level**: a manager's "all my teams" total sums over **`DISTINCT` owned records**, so a rep shared across two of that manager's teams is **never double-counted**. Implement with a `DISTINCT` on record id (and on owner id for headcount) — not by post-hoc filtering. This is the one place to get right; the schema (`TeamMember` many-to-many) makes double-counting possible, and `DISTINCT` is the guard.
- **Across different managers** there is nothing to dedup — two managers legitimately each see a shared rep; they're separate views.

**Where teams apply (the surfaces that key off team).** Team membership/lead drives: **CRM views** (an "owned by my team" scope + owner/team filters, doc 4/4c), **reporting** (group-by-team, team dashboards, doc 5b), **the deal board + forecasting rollup** (doc 9.6 stage-weighted forecast, rolled up rep→manager→team [LATER]), **record ownership + notifications** (doc 4e), **user profiles + the team directory** (doc 5b), and **workflow permissions** (who can build/act, Journey 11.3 / doc 10). One resolver, many consumers.

- **Benchmark (beat this):** HubSpot — teams & partitioning (the flat-team + rollup model we take) — https://knowledge.hubspot.com/account/partition-your-hubspot-assets ; Salesforce — role hierarchy (the visibility-rolls-up idea, *without* its depth) — https://developer.salesforce.com/workshops/admin-security-workshop/identity-and-access/2-security-hierarchy
- **Build docs:** internal — `Team` (one `leadUserId`) + `TeamMember` (many-to-many); the record-visibility resolver returns a distinct user-id set from owner + led-teams; rollups use `DISTINCT`. Parent-child team hierarchies (a VP seeing down into child teams) are **[LATER]**.

### Journey 11.4.1 — Create a team [NEAR-TERM]

*As an admin, I want to create a team, name it, pick a lead, and add reps, so that the group exists and rollups can start.*

1. **Entry point.** **Settings → Teams** (a new item under the same settings group as Members). The empty state shows one primary button, **New team**, with a one-line explainer ("Group reps so managers can see their pipeline and reports roll up").
2. Clicking **New team** opens a **right-side drawer** (not a full page — the same drawer pattern used for record create in doc 4b) with three fields:
   - **Team name** (text, required).
   - **Team lead** — a single-select **people picker** (searchable, avatars) listing workspace members; picking someone who isn't already a **manager** shows an inline note "This will give Dana the *manager* role" with a checkbox to confirm the role bump (so setting a lead can't silently fail the permission check).
   - **Members** — a **multi-select people picker** (chips); the lead is added as a member automatically. Reps already on other teams are still selectable (multi-team is allowed).
3. Click **Create**. The drawer closes; the new team appears in the list (11.4.2). No background job — synchronous write.

- **Benchmark (beat this):** Linear — teams (create + members drawer) — https://linear.app/docs/teams ; HubSpot — create a team — https://knowledge.hubspot.com/account/create-and-edit-teams
- **Build docs:** internal — insert `Team` (`name`, `leadUserId`) + `TeamMember` rows; if the lead isn't a manager, bump `Membership.role` to `manager` in the same transaction.

### Journey 11.4.2 — View teams (list + one team) [NEAR-TERM]

*As an admin or manager, I want to see all teams and open one, so that I can check who's on it and who leads it.*

1. **List (read-many).** **Settings → Teams** shows a table: **team name, lead (avatar + name), member count, and members (overlapping avatars, "+3")**. Sort by name or size. An admin sees all teams; a **manager** sees the teams they lead highlighted.
2. **Open one (read-one).** Clicking a row opens the team's **detail drawer**: name, lead, and the **member list** (each row: avatar, name, role, "on N other teams" badge so multi-team membership is visible at a glance). Buttons: **Edit** (11.4.3), **Delete** (11.4.4).

- **Benchmark (beat this):** Linear — team settings pages — https://linear.app/docs/teams
- **Build docs:** internal — list = `Team` + counts; detail joins `TeamMember` → `User` + each member's other-team count.

### Journey 11.4.3 — Edit a team: rename, change lead, add/remove members [NEAR-TERM]

*As an admin, I want to change a team's name, lead, or roster, so that it stays accurate as people move.*

1. From the detail drawer (11.4.2), **Edit** makes the fields editable in place (same three fields as create).
2. **Rename** — inline text edit, saves on blur/Enter.
3. **Change lead** — the people picker again; **changing the lead does not demote the old lead's role** (they may still lead other teams or need the role) — role changes are an explicit Members-page action, not a side effect, so a team edit never silently strips permissions.
4. **Add / remove members** — add via the picker; remove via an **×** on each member chip. Removing a rep from a team **immediately narrows** what that team's lead can see (the resolver re-computes on next read); if the rep is on no other team, their records are visible only to themselves + admins again.
5. Saves are synchronous; the list updates.

- **Benchmark (beat this):** HubSpot — edit a team — https://knowledge.hubspot.com/account/create-and-edit-teams
- **Build docs:** internal — update `Team.name` / `Team.leadUserId`; add/delete `TeamMember` rows; visibility is always resolved live, so no re-index job.

### Journey 11.4.4 — Delete (archive) a team [NEAR-TERM]

*As an admin, I want to delete a team that no longer exists, so that the list stays clean — without losing the records the reps own.*

1. **Delete** (from the detail drawer) asks for confirmation and states the **consequence in plain words**: "Deleting *West Team* removes the grouping. Reps keep all their records and their own access; the lead loses team-level visibility into these reps (unless they share another team). This does not delete any people or deals."
2. On confirm, the team is **soft-deleted** (recoverable 30 days, doc-4 trash model). `TeamMember` rows go with it. **No record is touched** — teams are a *grouping/visibility* layer, never an owner of data, so deleting one can never cascade into losing CRM records. (This is the key safety property.)
3. Reporting/forecast rollups that referenced the team fall back to workspace/owner scope; historical snapshots (doc 5b `PipelineSnapshot`, reused by doc 9) are unaffected.

- **Benchmark (beat this):** Linear — archive a team — https://linear.app/docs/teams
- **Build docs:** internal — `Team.deletedAt`; visibility resolver ignores soft-deleted teams; nothing cascades to records.

### Journey 11.4.5 — Rollup & forecasting by team (how the numbers add up) [NEAR-TERM model, [LATER] manager UI]

*As a manager, I want each rep's numbers to roll up to me and to my team totals, so that I can forecast and coach — without a rep on two of my teams being counted twice.*

1. **Who rolls up to whom.** The rollup hierarchy is **rep → team → lead (manager)** (doc 9's forecast rolled up rep → manager → team, flattened: no multi-level hierarchy yet). A manager's rollup = the aggregate over **every rep on any team they lead**.
2. **The dedup rule (restated where it's implemented).** A manager's "all my teams" total is computed over **`DISTINCT` record ids** (and `DISTINCT` owner ids for rep counts), so a rep on two of that manager's teams contributes **once**. Per-team views (one team at a time) don't need dedup; the cross-team roll-up does.
3. **What consumes it.** The deal-board stage-weighted forecast (doc 9.6, rolled up [LATER]), reporting group-by-team + team dashboards (doc 5b), and rep rankings/headcount (doc 5b, [LATER]). The **field + snapshot design is built now** (this doc's `Team`/`TeamMember` + doc 9's stage `winProbability` + doc 5b's `PipelineSnapshot`), so switching teams on is a **rollup over existing data, not a migration** — the repo-wide "spec the model now, gate the manager UI [LATER]" pattern.

- **Benchmark (beat this):** Clari — forecast rollup by team — https://www.clari.com/blog/sales-forecasting/ ; Gong — pipeline view + forecasting — https://help.gong.io/docs/set-up-your-pipeline-view-and-begin-forecasting
- **Build docs:** internal — rollup query groups by team via `TeamMember`, `DISTINCT` on record/owner to dedup; reuses doc 9 forecast fields.

## Journey 11.5 — Slack integration → moved to [doc 11a](11a-slack-integration.md) [NEAR-TERM, high value]

Slack was one journey here, but you were right that it's really **several distinct journeys** — building our Slack app, a customer installing it, configuring event→channel maps in *our* app, what each notification looks like, and the runtime post — so it's been **split into its own doc, [11a — Slack Integration](11a-slack-integration.md)**. It stays near-term and high value; the split just gives each journey room and answers the "which app / which screen / do reps go back and forth" questions in one place.

The one-line summary that stays true: **Slack is a productized workflow** — an admin connects Slack once (OAuth), maps a few high-signal deal events (won / stage change / high-value / at-risk) to channels **inside our app**, and the actual post is a **doc-10.4 workflow action**. Configuration lives in our app; the only thing done in Slack is the one-time "Allow" and inviting the bot to a private channel. Details, Block Kit layouts, and the data model now live in [doc 11a](11a-slack-integration.md).

## Journey 11.6 — Per-list access control [LATER; one cheap near-term hook]

*As a manager or admin, I want to control who can view vs. edit a shared list, so that a shared "Q4 Target Accounts" list can't be edited by the wrong person.*

This was underspecified. Below: the **three access levels** defined precisely, the **grant journey** (entry point + UI), the **resolver algorithm** with a worked example, and the **near-term cheap hook**. Note: this is **per-list access only** — per-*object* access (locking a whole People/Companies object) and per-*field* locking (Journey 11.7) are separate; we deliberately keep this narrow because the four roles (11.3) already cover most needs and we killed custom permission sets.

**The three access levels (Attio's model, defined).** A grant gives a grantee one level on a list:
- **Read** — can open the list and its records *as filtered by their own row-level visibility* (a Read grant never lets a rep see records they otherwise couldn't — it governs the *list*, not the *rows*). Cannot add/remove records or change the list's filters/columns.
- **Write** — Read + can **add/remove records** from the list and edit the records they can already edit. Cannot change the list's structure (its filters, columns, sort).
- **Full** — Write + can **restructure the list** (edit filters/columns, rename) and **manage its access grants**. Admins always have Full.

### Journey 11.6.1 — Grant access to a list [LATER]

*As a list's owner or an admin, I want to set who can view or edit it, so that the right people collaborate and the rest can't break it.*

1. **Entry point.** On a list (doc 4c), a **Share** button (top-right, next to the list name) opens an **access panel** — the same place a rep already goes to share, so there's no new surface to learn.
2. The panel shows a **grantee row per grant**: pick a **grantee** (the whole **workspace**, a **team**, or a **person** — one picker with three grouped sections) and a **level** (Read / Write / Full via a dropdown). Add rows with **+ Add people or teams**.
3. A default row, **"Everyone in the workspace,"** is present with a level (default **Write** for lists a rep creates, so the current all-can-edit behavior is the default until someone tightens it). Lowering it to **Read** is the common "lock this list" move.
4. Save is synchronous. The panel shows the **effective** level for the current viewer at the bottom ("You have: Full") so it's obvious what you can do.

- **Benchmark (beat this):** Attio — manage access to lists — https://attio.com/help/reference/managing-your-data/objects/manage-access-to-objects ; Notion — share & permissions panel (the grouped person/group picker feel) — https://www.notion.com/help/sharing-and-permissions
- **Build docs:** internal — one `ListAccess` row per grant (below).

### Journey 11.6.2 — How the resolver decides (most-permissive-wins) [LATER]

*As the system, I resolve a viewer's effective level on a list, so that overlapping grants never contradict each other.*

1. Collect every `ListAccess` grant that applies to the viewer: the **workspace** grant, any **team** grant for a team they're on, and any **person** grant for them directly.
2. **Most-permissive wins** — the viewer's effective level is the **highest** of those grants (Full > Write > Read). Admins are always Full; a list's owner is always Full.
3. **Worked example.** List "Q4 Targets": workspace = **Read**, team "AE Team" = **Write**, person Dana = **Full**. A rep not on AE Team → **Read**. A rep on AE Team → **Write**. Dana → **Full**. Nothing contradicts because we take the max, never the min.
4. **Row-level visibility still applies on top** — a Read/Write grant on the *list* never widens which *records* the viewer may see (that's owner/team, Journey 11.4). The two layers compose: list-access gates the *list and its structure*; row-visibility gates the *records inside it*.

- **Benchmark (beat this):** Attio — access resolution (workspace → team → member, most-permissive) — https://attio.com/blog/permissions-in-attio
- **Build docs:** internal — resolver merges `ListAccess` grants, returns `max(level)`; composes with the row-visibility resolver (11.4).

### Journey 11.6.3 — The near-term cheap hook (build this early) [NEAR-TERM]

*As an admin, I want at least a per-list read-only vs editable flag the moment shared lists exist, so that we don't have to retrofit access onto lists that assumed everyone can edit.*

1. Before the full grant system, ship **one boolean on a list: `isLocked`** (read-only for non-admins) — a single toggle in the list's ⋯ menu ("Lock list — only admins can change records or structure").
2. When the full `ListAccess` model lands, `isLocked=true` becomes a **workspace-grant of Read** — a clean forward-migration, no data loss. This is why the cheap hook is worth building first: it's trivial now and painful to retrofit onto lists that assumed all-can-edit.

- **Benchmark (beat this):** Attio — lock a list — https://attio.com/help/reference/managing-your-data/objects/manage-access-to-objects
- **Build docs:** internal — `List.isLocked` boolean now; migrate to a `ListAccess` workspace-Read grant when 11.6.1 ships.

## Journey 11.7 — Field-level security (restrict who edits an attribute) [LATER]

*As an admin, I want to lock the fields that drive the number, so that reps can't change stage, amount, or discount and distort the forecast.*

**Who can do it:** **admin only** (field access is workspace configuration, like the data model). Managers and reps never see this control.

1. **Entry point.** **Settings → Data model → [object] → [field]** (the same field-config panel as doc 4.4) gains a **"Permissions"** section — so field-level security lives right where the field is defined, not on a separate screen.
2. In that section the admin sets, **per role** (rep / manager), whether the field is **Editable / Read-only / Hidden** (admins are always Editable). E.g. lock **`stage`** or **`amount`** so only managers move deals or change value; hide commission/discount fields from reps (Salesforce field-level security).
3. Enforced in the **app layer** (like doc 4's field rules) — the cell renders read-only or hidden for that role in the grid, the record page, and the API, so the lock can't be bypassed by editing through a different surface.

- **Benchmark (beat this):** Salesforce — field-level security on permission sets — https://help.salesforce.com/s/articleView?id=release-notes.rn_permissions_field_security_perm_set.htm
- **Build docs:** internal — a per-role field-permission map layered on `AttributeDef` (doc 4); the config UI is a tab in the doc-4.4 field-settings panel, admin-gated; enforcement is the same app-layer validator that already reads `AttributeDef`.

## Journey 11.8 — SAML SSO + SCIM provisioning [LATER, enterprise gate]

*As an IT admin at a customer, I want SSO and SCIM, so that I control access centrally and accounts are auto-removed the instant someone leaves.*

1. **SAML SSO = authentication** — users log in via Okta/Entra/Google, no separate password.
2. **SCIM = provisioning** — the IdP auto-creates, updates, and **deactivates** accounts and syncs groups. **Deprovisioning is the killer feature** — offboarding without it is a security hole.
3. **Build-vs-buy:** SCIM in-house is genuinely hard (every IdP differs). **WorkOS** is the standard buy — one API abstracts the connectors for both SSO and SCIM.

- **Benchmark (beat this):** WorkOS — SSO + SCIM — https://workos.com/guides/user-provisioning-scim ; SCIM vs SAML — https://workos.com/blog/scim-vs-saml
- **Build docs:** internal — architect the user model now so **email identity can be swapped for IdP identity without a rewrite**; integrate WorkOS when the first enterprise deal needs it.

## Journey 11.9 — Data retention & GDPR erasure [LATER; one cheap near-term hook]

*As a legal/DPO owner at a customer, I want retention limits and a real erasure path, so that the company stays GDPR-compliant and doesn't hoard personal data.*

1. **[LATER]** A per-workspace **retention policy** — auto-delete/archive records after N days (GDPR storage-limitation), with legal-hold exceptions.
2. **[LATER]** A formal **right-to-erasure** workflow — hard-delete a data subject's data across all systems within ~one month, propagated to processors.
3. **[NEAR-TERM cheap hook]** Build one thing early: a genuine **hard-delete of a person + all their linked records** ("delete this person's data"), because it's much harder to retrofit than to design in — and it makes the CRM Part 1 trash model (doc 4) honor a real erasure.

- **Benchmark (beat this):** GDPR — CRM data retention — https://gdprlocal.com/crm-data-retention-and-compliance/ ; right to erasure — https://www.legalforge.app/blog/gdpr-right-to-erasure
- **Build docs:** internal — `RetentionPolicy` [LATER]; the cascading person-erasure honors the doc-4 relation rules.

---

## Background jobs

- **X1 — Invite lifecycle.** **Trigger:** an admin sends an invite (11.1) enqueues the email job; a daily ticker expires stale invites; acceptance (11.2) flips seat state. **Steps:** render + send the invite email via the existing send path → on accept, mark `Invitation.status=accepted` + activate `Membership` → nightly, expire invites older than 14 days. **pg-boss:** `invite-email` queue, `retryLimit: 3`, **idempotent per `Invitation.token`** so a resend/retry never double-sends; the expiry sweep is a `pg-boss` cron. [NEAR-TERM]
- **X2 — Slack event poster.** Moved to [doc 11a](11a-slack-integration.md) (its jobs live with the Slack journeys). [NEAR-TERM]
- **X3 — Retention sweep.** [LATER] Apply per-workspace retention policies and execute erasure requests, honoring legal holds + relation rules.

---

## Decisions for you (multi-user)

**1. Build order. Decided (my pick).** When teams land, build the four that matter: **invitations, roles (rep/manager/admin + internal super-admin), teams, Slack ([doc 11a](11a-slack-integration.md))** — plus the two cheap forward-hooks (per-list `isLocked`; real person-erasure). Everything else (field-level lock, SSO, SCIM, retention policies) waits for an enterprise buyer. *Alternative: build enterprise permissions up front — rejected; large effort, zero solo value, and no buyer asking yet.*

**1b. No custom permission sets — killed entirely. Decided (your call, I agree).** The four fixed roles (11.3) are the whole permission model. No user-defined permission sets, ever — they're the top source of CRM permission sprawl and support burden for near-zero SMB value. The two narrow [LATER] hooks (per-list access 11.6, field-level lock 11.7) cover the rare real need. *Alternative: a permission-set builder — rejected; complexity with no buyer.*

**1c. No DB enums — text fields. Decided (your preference).** `role` and every status-like column are `String`, validated in the app layer to their fixed set of values (a Zod/TS union), not a Postgres/Prisma `enum` — so adding a value is never a migration.

**2. Identity model now, IdP later. Decided (my pick).** Use **email-based identity** now but structure the user model so it can later accept **IdP identity (SAML/SCIM via WorkOS)** without a rewrite. *Alternative: bake in only email — rejected; retrofitting SSO onto a hard-coded email identity is expensive.*

**3. Separate "what actions" from "which records". Decided (my pick).** Two independent checks — role (can you perform the action) and ownership/team (which records you can see) — the Salesforce insight that lets a manager coach without admin rights. *This is a design rule, not really optional; noting it so it's not collapsed into one flag.*

---

## Technology choices (where it is not obvious)

- **SSO/SCIM — buy via WorkOS, don't build.** Options: hand-roll SAML+SCIM per IdP vs. one WorkOS integration. **Pick: WorkOS** — SCIM in-house is a maintenance sink (every IdP differs) and WorkOS abstracts Okta/Entra/Google for both SSO and provisioning. Integrate only when an enterprise deal requires it. [LATER]
- **Permissions — two-layer checks (action + record).** A `role` field (text, app-validated to the four values — no db enum) gates *actions*; an owner/team resolver gates *record visibility*. Most-permissive-wins across workspace → team → member (Attio's rule) for the [LATER] granular grants. This mirrors Salesforce's profile-then-sharing model without its complexity.
- **Slack — see [doc 11a](11a-slack-integration.md).** Its own doc now; the short version: a Slack post is just a doc-10.4 workflow action, so Slack is a thin OAuth + `chat.postMessage` adapter, not a new subsystem.
- **Seat billing — don't charge until accept (Linear).** A pending invite reserves a seat but doesn't bill until first login — avoids charging for invites that never land.

## Data model (Prisma) — additions in this doc

Most tables are **[LATER]**; the near-term ones are marked. Extends the CRM schema (Workspace/User already exist). `SlackConnection` moved to [doc 11a](11a-slack-integration.md).

```prisma
// Extend the existing User (doc 1) with one field — super-admin is workspace-independent (Journey 11.3):
//   User.isSuperAdmin  Boolean @default(false)   // internal-to-our-company operator; spans all workspaces (doc 13)

model Invitation {           // NEW [NEAR-TERM] — a pending invite (Journeys 11.1/11.2)
  id          String  @id @default(cuid())
  workspaceId String
  email       String
  role        String         // rep | manager | admin
  teamId      String?
  token       String  @unique
  status      String  @default("pending") // pending | accepted | revoked | expired
  invitedById String
  createdAt   DateTime @default(now())
  acceptedAt  DateTime?
  @@index([workspaceId, status])
}

model Membership {           // NEW [NEAR-TERM] — a user's role in a workspace (Journey 11.3)
  id          String @id @default(cuid())
  workspaceId String
  userId      String
  role        String         // rep | manager | admin
  isActive    Boolean @default(true)
  @@unique([workspaceId, userId])
}

model Team {                 // NEW [NEAR-TERM] — a group of reps (Journey 11.4)
  id          String @id @default(cuid())
  workspaceId String
  name        String
  leadUserId  String?        // the team lead (a "manager"-role user); one lead per team, a user can lead many teams (11.4)
  deletedAt   DateTime?      // soft-delete → trash, 30-day recovery (Journey 11.4.4); never cascades to records
  @@index([workspaceId])
}

model TeamMember {           // NEW [NEAR-TERM] — rep ↔ team (many-to-many; a rep can be on many teams → many managers, 11.4)
  id       String @id @default(cuid())
  teamId   String
  userId   String
  @@unique([teamId, userId])
}

// Slack: SlackConnection moved to doc 11a (Slack Integration).

model ListAccess {           // NEW [LATER] — per-list access grant (Journey 11.6); resolver takes max(level)
  id       String @id @default(cuid())
  listId   String
  granteeType String         // "workspace" | "team" | "user" (text, app-validated — no db enum)
  granteeId   String
  level    String            // "read" | "write" | "full" (text, app-validated)
}
// Near-term cheap hook (Journey 11.6.3): add List.isLocked Boolean @default(false) on the doc-4c List model now;
// migrate to a ListAccess workspace-"read" grant when the full model lands.

model RetentionPolicy {      // NEW [LATER] — per-workspace retention (Journey 11.9)
  id          String @id @default(cuid())
  workspaceId String
  objectSlug  String         // which object
  deleteAfterDays Int
  legalHold   Boolean @default(false)
}
```

## Technical decisions, trade-offs & edge cases

**Why almost everything here is [LATER].** A solo user is the only member, owner, and editor — so invitations, roles, teams, permissions, SSO, and retention are literally inert for them. Building them now would be effort with zero user until a second seat exists. The discipline: **define the data model now** (so identity → IdP and record-deletion extend without a rewrite) and **gate the UI** until teams land — the same "spec the model, defer the UI" pattern the repo already uses for teams and live transfer (doc 3.13).

**The two cheap forward-hooks worth building early.** (1) A per-list **read-only vs editable** flag — trivial now, painful to retrofit onto lists that assumed everyone can edit. (2) A real **hard-delete of a person + all linked records** — the erasure primitive that GDPR (Journey 11.9) and a clean trash model (doc 4) both need; retrofitting a true cascade delete later is far harder than designing it in.

**Separate action-permission from record-visibility.** The single most important structural decision: a **role** answers "can this user perform this action" and an **owner/team resolver** answers "which records can this user see." Collapsing them into one flag is what makes CRM permission models rigid — keeping them independent is what lets a manager coach (see all team records) without admin rights (change settings), exactly Salesforce's profile-then-sharing split.

**Slack is not a new subsystem** (full spec in [doc 11a](11a-slack-integration.md)). Because the deal-event triggers live in the deal engine (doc 9) and the workflow engine (doc 10) already has a "post to Slack" action shape, the Slack integration is a thin OAuth + `chat.postMessage` adapter plus a channel-mapping table — reuse, not rebuild. This is why Slack is near-term-cheap even though it feels like a big feature.
