# Doc 13 — Superadmin Console: entry, overview, workspaces & audit

The **operator's cockpit** — the backend-only console **you** (the super-admin, our staff) use to run the product across *all* customer workspaces: watch system health, manage workspaces/users, impersonate for support, and read the audit trail. It is distinct from a customer's in-app Settings — this is the product-owner view above every workspace.

This doc owns the **console shell** (how you get in, what the overview shows) and **workspace/user operations**. Two sibling docs own the rest:
- **[Doc 13a](13a-superadmin-cost-monitoring.md)** — AI-token & API-credit **cost monitoring**, budgets, and the runaway-cost alerting.
- **[Doc 13b](13b-superadmin-model-and-killswitches.md)** — **model routing**, provider keys, feature flags, and kill-switches.

**Phase note:** single-operator now (you). The cost ledger ([doc 13a](13a-superadmin-cost-monitoring.md)) turns on with the *first* AI call in Phase 2; the rest of the console lands later (see [sequencing](../development-guidelines/sequencing-and-build-order.md)). This is not a customer-facing "Journey" family in the product sense, but it is specced as real journeys because *you* are the user.

**Journey numbering:** doc 13 → `Journey 13.1`, `13.2`, … ; doc 13a → `13a.1`, … ; doc 13b → `13b.1`, …

---

## Architecture — two questions you asked, answered

**A. "Is the console a separate React app?" — No. It is a protected `/admin` area inside the *same* app.**

*Options:* (a) a separate React app / repo / deploy; (b) a protected route-group inside the existing app; (c) an off-the-shelf admin tool (Retool / Forest Admin).

**Pick: (b) — an `/admin` area in the same app**, gated by a `superadmin` auth claim + an IP allowlist + step-up re-auth for destructive actions (Journey 13.1). It has its **own layout and nav** so it never visually bleeds into the customer app, but it shares the same repo, DB client, types, auth, and deploy.

*Why:* the console must **write to the same database** the app uses (suspend a workspace, set model routing, flip a flag) — trivial when it's the same codebase, awkward across a network boundary. A solo builder should not run, deploy, secret-manage, and patch **two** apps. *Rejected:* a separate app doubles ops for zero benefit at this scale; an off-the-shelf admin adds another SaaS bill, still needs custom code for our specific actions, and pulls customer data into a third party. If the console ever needs network isolation from the customer app, splitting a route-group into its own deploy later is cheap; splitting shared code is not. *(This composes with the frontend decision in [doc 12](../development-guidelines/12-devops-and-infrastructure.md): the app is a **Vite SPA + a separate API service**, and the console is a gated area of that same front end talking to the same API.)*

**B. "Is the cost/health dashboard my own React dashboard, or Axiom / Evidence / a tool?" — Split it by read vs write.**

The console has two kinds of surface, and they want different homes:

- **Read / monitor** (system health, cost trends, spend-by-feature, latency) → the data **already lives in Axiom** (metrics/logs/traces, [doc 12](../development-guidelines/12-devops-and-infrastructure.md)) and in Postgres. Don't rebuild charts. **Embed or deep-link Axiom dashboards** for real-time health and cost, and use **Evidence.dev** (SQL + Markdown, versioned in git — [doc 12](../development-guidelines/12-devops-and-infrastructure.md)) for the cost reports you want to keep and diff over time. Detail in [doc 13a](13a-superadmin-cost-monitoring.md).
- **Write / control** (create a budget, change model routing, flip a kill-switch, suspend a workspace, impersonate) → a **thin custom admin UI** in the `/admin` area, because **you cannot take an action from a read-only observability tool**. These are forms and buttons over our own data models.

So the overview page is *mostly embedded Axiom panels + a few of our own summary numbers*; the action pages are *ours*. This split is why you'll see "reads from Axiom" on monitoring journeys and "writes `X` model" on control journeys.

- **Benchmark (beat this):** **Stripe Dashboard** (operator clarity, spend-at-a-glance) — https://stripe.com/docs/dashboard ; **Vercel / Render** admin overviews (health surface) ; **Axiom dashboards** (embed target) — https://axiom.co/docs/query-data/dashboards

---

## Screens in this doc

1. **Console sign-in** — superadmin auth + IP gate + step-up (Journey 13.1).
2. **Overview** — system health + today's spend + alerts, one screen (Journey 13.2).
3. **Workspaces list** — every customer workspace, searchable (Journey 13.3).
4. **Workspace detail** — one workspace's health, plan, usage, actions (Journey 13.4).
5. **Impersonation banner** — the persistent "you are viewing as…" bar (Journey 13.7).
6. **Audit log** — every superadmin action, filterable (Journey 13.9).
7. **Data browser** — a read-first table view over any table in the DB (Journey 13.10).

---

## Journey 13.1 — Get into the console (sign in + IP gate + step-up)

*As a superadmin, I want a hardened way into the backend console, so that operator powers can never be reached by a customer or a stolen password alone.*

1. You navigate to `/admin` (same domain as the app, or an internal `admin.` subdomain — decided below).
2. The server checks three things **before rendering anything**:
   - **(a) Superadmin claim** — your auth token must carry `superadmin: true` (a custom claim set out-of-band on our own staff accounts only — never self-serve). No claim → hard 404 (not a 403; we don't reveal the console exists).
   - **(b) IP allowlist** — your request IP is in the allowlist (our office / VPN egress IPs, config in [doc 13b](13b-superadmin-model-and-killswitches.md)'s flag store). Off-list → 404.
   - **(c) Fresh session** — if your last step-up was > 12h ago, you re-authenticate (password + TOTP).
3. You land on the **Overview** (Journey 13.2).
4. **Destructive actions require step-up again.** Suspending a workspace, impersonating, rotating a provider key, or flipping a global kill-switch re-prompts for TOTP even inside a valid session (a per-action confirm, not a per-session one). This is the "you can look freely, but every dangerous click is re-confirmed" model.

- **How the claim arrives:** set once via a Firebase Admin script when we onboard a staff member (`setCustomUserClaims(uid, { superadmin: true })`); revoked the same way. It rides in the ID token like the workspace claim in [doc 1](1-auth-and-basic-dialer.md) (Journey 1.3), and the server **re-checks it server-side** — the claim is a hint, not the authority.
- **Benchmark (beat this):** Stripe / GitHub org-admin (step-up on sensitive actions) ; AWS Console (re-auth for dangerous ops).
- **Build docs:** Firebase custom claims — https://firebase.google.com/docs/auth/admin/custom-claims ; TOTP step-up — standard `otplib`.

**Decision — same domain `/admin` vs `admin.` subdomain.** *Pick: an `admin.` subdomain in production* (cookie isolation from the customer app, easy IP/WAF rules at the edge), falling back to a `/admin` path locally so dev stays one server. Both hit the same app; the subdomain is a routing/edge concern, not a second deploy.

## Journey 13.2 — Read the overview (system health at a glance)

*As a superadmin, I want one screen that tells me the product is healthy and what today costs, so that I know in ten seconds whether anything needs me.*

1. On landing (Journey 13.1) you see the **Overview** — a single scannable screen, no drilling required to answer "are we OK right now?"
2. It shows four bands: **Alerts** (top, only if any fire), **System health**, **Today's spend**, and **Fleet** (workspaces/users).
3. Each tile is a **read** — the numbers arrive from the sources below, not from a bespoke store.
4. You click any tile to drill: an alert → its detail; a health tile → the Axiom dashboard; spend → [doc 13a](13a-superadmin-cost-monitoring.md); a workspace count → the Workspaces list (Journey 13.3).

```
┌───────────────────────────────────────────────────────────────────────┐
│  ⚠  ALERTS (2)                                                          │
│  ● Runaway cost — workspace "Acme" spent $63 in the last 24h  [view →]  │
│  ● Provider degraded — Deepgram p95 latency 4.2s (usual 1.1s) [view →]  │
├──────────────────────────────┬────────────────────────────────────────┤
│  SYSTEM HEALTH               │  TODAY'S SPEND            $412.80        │
│  Queue depth        18  ✓    │  ├ AI (LLM)      $221   ▁▂▃▅▇  ↑         │
│  Failed jobs /10m    0  ✓    │  ├ Telephony     $128   ▂▂▂▂▂  →         │
│  Dead-letter         3  ⚠    │  ├ Transcription  $41   ▁▁▂▁▁  →         │
│  Providers    all green ✓    │  └ Enrichment     $23   ▁▃▁▁▁  →         │
│  [open Axiom health →]       │  [open cost console →]  (doc 13a)        │
├──────────────────────────────┼────────────────────────────────────────┤
│  FLEET                       │  RECENT ADMIN ACTIONS                    │
│  Workspaces   142  (+3 wk)   │  10:02  impersonate → "Acme" (you)       │
│  Active users 1,204          │  09:40  disable provider → Proxycurl     │
│  Suspended      2            │  08:15  change model → call-summary      │
│  [open workspaces →]         │  [open audit log →]                      │
└──────────────────────────────┴────────────────────────────────────────┘
```

- **Where each number comes from:**
  - *Queue depth, failed-jobs/10m, dead-letter, provider status* — Axiom, from the pg-boss + provider metrics emitted in [doc 12](../development-guidelines/12-devops-and-infrastructure.md) (§9). The tile shows the current value and a ✓/⚠ against its alert threshold.
  - *Today's spend + sparklines* — the `UsageEvent` ledger ([doc 13a](13a-superadmin-cost-monitoring.md)), summed for today by category, with a 7-point trend arrow.
  - *Fleet counts* — a direct count over `Workspace` / `User` / `Membership`.
  - *Recent admin actions* — the last 5 rows of `AdminAudit` (Journey 13.9).
- **Alerts band** only renders when something is firing (budget breach from 13a, a provider circuit-breaker from 13b, or a doc-12 health alert). Zero alerts → the band collapses and the screen reads "All clear."
- **Benchmark (beat this):** Stripe Dashboard home (spend + health, one glance) ; Vercel project overview.
- **Build docs:** internal — tiles read Axiom (embed/query) + DB counts + the 13a ledger; no new store.

## Journey 13.3 — Browse workspaces (read-many)

*As a superadmin, I want a searchable list of every customer workspace, so that I can find the one I need to inspect or act on.*

1. From the Overview's Fleet tile (or the console nav) you open **Workspaces**.
2. You see a table of **all** workspaces: name, plan, seats used/total, 30-day spend, health dot, created date, status (active / suspended).
3. You **search** by name/id/owner-email (server-side, debounced) and **sort** by any column; **filter** by status or "spend > $X".
4. You click a row → the **Workspace detail** (Journey 13.4).

```
Workspaces (142)          🔎 search name / id / owner-email          [ Active ▾ ]
┌────────────────────┬────────┬────────┬───────────┬───────┬──────────┬─────────┐
│ Workspace          │ Plan   │ Seats  │ 30d spend │ Health│ Created  │ Status  │
├────────────────────┼────────┼────────┼───────────┼───────┼──────────┼─────────┤
│ Acme Corp          │ Pro    │ 8 / 10 │ $1,204 ↑  │  ●    │ 2025-02  │ Active  │
│ Beta Sales         │ Free   │ 2 / 3  │    $18    │  ●    │ 2025-06  │ Active  │
│ Gamma Ltd          │ Pro    │ 5 / 5  │   $402    │  ●    │ 2024-11  │ Susp.   │
└────────────────────┴────────┴────────┴───────────┴───────┴──────────┴─────────┘
```

- **How the data arrives:** one paginated query joining `Workspace` → seat count (`Membership`), 30-day spend (`UsageEvent` sum, [doc 13a](13a-superadmin-cost-monitoring.md)), and a health dot (worst of: dead-letter count, failing sync, budget state). Spend and health are cached ~5 min so the list stays fast at fleet scale.
- **Benchmark (beat this):** Stripe customers list ; Linear admin workspace list (search + status filter).
- **Build docs:** internal — a paginated `findMany` with `where` / `orderBy` / cursor pagination.

## Journey 13.4 — View one workspace (read-one)

*As a superadmin, I want the full picture of a single workspace, so that I can diagnose a support issue or decide on an action.*

1. From the list (Journey 13.3) you open a workspace.
2. You see a detail page: **identity** (name, id, owner, created), **plan & seats**, **usage** (calls, AI spend, transcription minutes — 30-day, from the ledger), **health** (queue/sync/dead-letter specific to this workspace), and an **activity strip** (recent audit + notable events).
3. From here you take actions — each is its **own journey**, and each writes an `AdminAudit` row: **Impersonate** (13.7), **Suspend / Reactivate** (13.5), **Adjust seats/limits** (13.6), **Export / delete data** (13.8).

```
← Workspaces / Acme Corp                        [ Impersonate ] [ ⋯ Actions ▾ ]
────────────────────────────────────────────────────────────────────────────
Owner  jane@acme.com   ·   id ws_9f3…   ·   Created 2025-02-11   ·   Pro plan
Seats  8 / 10                                     Status ● Active
────────────────────────────────────────────────────────────────────────────
USAGE (30d)                          HEALTH
Calls           4,210                Queue (this ws)     ok
AI spend        $1,204               Mailbox sync        ok (cursor fresh)
Transcription   980 min              Dead-letter          1  ⚠
Budget state    72% of $1,800        Last error          2d ago
────────────────────────────────────────────────────────────────────────────
Actions ▾ :  Suspend · Adjust seats/limits · Export data · Delete workspace
```

- **How the data arrives:** DB reads for identity/plan/seats; ledger sums for usage; Axiom (scoped to this `workspaceId`) for health; `AdminAudit` for the activity strip.
- **Benchmark (beat this):** Stripe customer detail (identity + usage + actions on one page).
- **Build docs:** internal — one page, `workspaceId`-scoped reads.

## Journey 13.5 — Suspend or reactivate a workspace (update)

*As a superadmin, I want to suspend a workspace and later reactivate it, so that I can stop abuse or non-payment without deleting anything.*

1. On the Workspace detail (Journey 13.4) → **Actions → Suspend**.
2. A dialog explains the effect and asks for a **reason** (free text, required) and **TOTP step-up** (Journey 13.1 step 4).
3. On confirm, **Background job B-SUSPEND** runs: sets `Workspace.status = "suspended"` and `suspendedReason`/`suspendedAt`, revokes active sessions for its members, and writes an `AdminAudit` row.
4. Suspended state: members hitting the app see a "workspace suspended — contact support" wall (read-only or fully blocked, per the reason). Background jobs for that workspace (sync, sequences) **pause**, they don't error.
5. **Reactivate** is the inverse: **Actions → Reactivate** → confirm → `status = "active"`, jobs resume, audit row written. Nothing was lost because suspend never deletes.

- **If X then Y:** *If suspended for non-payment* → read-only wall (they can export, not act). *If suspended for abuse/legal* → full block. The reason drives the wall mode.
- **Benchmark (beat this):** Stripe account pause ; Linear workspace suspend (reversible, audited).
- **Build docs:** internal — `Workspace.status` gate checked in the auth middleware; session revoke via Firebase `revokeRefreshTokens`.

## Journey 13.6 — Adjust seats and limits (update)

*As a superadmin, I want to change a workspace's seat cap or usage limits, so that I can honor a sales deal or contain a problem without a code deploy.*

1. Workspace detail → **Actions → Adjust seats/limits**.
2. A form shows current **seat cap**, and any **usage limits** (e.g. monthly AI budget default, calls/day cap). You edit a number.
3. Save → step-up if it *raises* spend exposure (a higher budget) → writes the new value on `Workspace` (or a linked `CostBudget` for the AI cap, [doc 13a](13a-superadmin-cost-monitoring.md)) → `AdminAudit` row.
4. The change is **live immediately** (limits are read at runtime, not baked at deploy).

- **Benchmark (beat this):** Stripe subscription-item quantity edit ; Metronome/Orb usage-limit config.
- **Build docs:** internal — plain field update; the AI budget writes through to 13a's `CostBudget`.

## Journey 13.7 — Impersonate a user for support (audited, time-boxed)

*As a superadmin, I want to view the app exactly as a specific user sees it, so that I can reproduce and fix a support issue — without it ever being a silent backdoor.*

1. Workspace detail (Journey 13.4) → **Impersonate** (or pick a specific member first).
2. **TOTP step-up** + a required **reason** ("debugging ticket #482"). This is the most sensitive action in the product, so it is never one-click.
3. On confirm, **Background job B-IMPERSONATE** mints a **time-boxed impersonation session** (default **30 min**, hard max 60), scoped to that workspace/user, and writes an `AdminAudit` row *before* the session opens.
4. You are dropped into the **customer app as that user**, with a persistent, unmissable **banner** across the top: `⚠ Viewing as jane@acme.com — ends in 28:41 — [Exit]`. The banner cannot be dismissed; it counts down.
5. **Guardrails while impersonating:** the session is **read-mostly by default** — you can see everything the user sees, but *write* actions (send an email, delete a record, change billing) require an extra inline confirm, and some (billing changes, data deletion) are blocked entirely. Every write you *do* make is tagged in the audit as "by superadmin via impersonation."
6. The session **auto-expires** at the timer; **Exit** ends it immediately. Expiry/exit writes a closing `AdminAudit` row (duration, what was viewed/done).

- **Why time-boxed + read-mostly:** an open-ended, write-enabled impersonation is indistinguishable from an account takeover in the logs. The trust cost of a hidden or unlimited backdoor is far higher than the friction of a timer and a confirm.
- **Benchmark (beat this):** Stripe "view as / connect" support access ; Intercom/Linear impersonation (banner + audit + time-box) — https://www.intercom.com/help
- **Build docs:** internal — impersonation session = a short-lived server-signed token carrying `{ actingUserId, realAdminId, workspaceId, exp }`; every request re-checks `exp`; writes carry `viaImpersonationBy`.

## Journey 13.8 — Export or delete a workspace's data (honors retention)

*As a superadmin, I want to export or hard-delete a workspace's data on request, so that I can satisfy a GDPR/erasure or offboarding ask correctly.*

1. Workspace detail → **Actions → Export data** *or* **Delete workspace**.
2. **Export:** confirm → **Background job B-EXPORT** assembles the workspace's records/calls/emails into a downloadable archive (async; you're notified when ready). Read-only, non-destructive.
3. **Delete:** the dangerous one. Requires **TOTP step-up + typing the workspace name to confirm** + a reason. On confirm, **Background job B-ERASE** runs the **hard cascade delete** primitive from [doc 11.9](11-multiuser-teams-and-permissions.md) — person + all linked records, calls, transcripts, files (including S3 objects) — honoring any **legal hold** (a held workspace is surfaced and blocked, never silently skipped). Writes a final `AdminAudit` row.
4. Deletion respects the workspace's **`RetentionPolicy`** ([doc 11.9](11-multiuser-teams-and-permissions.md)) — this journey is the operator-initiated path into the same erasure machinery, not a second implementation.

- **Prohibited-by-design:** there is no "quick delete." Erasure is irreversible, so it is gated behind step-up + name-type + reason, matching the destructive-action rules in the system safety model.
- **Benchmark (beat this):** GitHub org deletion (type-to-confirm) ; Stripe data-deletion request flow.
- **Build docs:** internal — reuses [doc 11.9](11-multiuser-teams-and-permissions.md) erasure + [doc 12](../development-guidelines/12-devops-and-infrastructure.md) S3 object deletion; export is a streamed archive job.

## Journey 13.9 — Read the admin audit log (read-many)

*As a superadmin, I want a complete, filterable record of every operator action, so that any powerful move is accountable and reviewable.*

1. From the Overview or nav → **Audit log**.
2. You see every `AdminAudit` row newest-first: **when, who (admin), action, target (workspace/user), reason, and — for impersonation — duration and what was done**.
3. You **filter** by admin, action type, workspace, or date range, and click a row for its full JSON detail.
4. The log is **append-only and read-only** — even a superadmin cannot edit or delete rows (an editable audit log is worthless). Rows are retained per policy and shipped to Axiom too, so they survive even a DB compromise.

```
Audit log            [ action ▾ ] [ admin ▾ ] [ workspace ▾ ] [ last 7d ▾ ]
2026-08-19 10:02  you  impersonate   Acme / jane@acme.com   "ticket #482"  28m
2026-08-19 09:40  you  disable_prov  provider: Proxycurl    "enjoined"      —
2026-08-19 08:15  you  change_model  feature: call-summary  "cost cut"      —
2026-08-18 17:31  you  suspend       Gamma Ltd              "non-payment"   —
```

- **How rows arrive:** every write journey in this doc-13 family appends one `AdminAudit` row in the same transaction as the action (so an action can never happen without its audit). A mirror is emitted to Axiom.
- **Benchmark (beat this):** Stripe / Linear audit logs (append-only, filterable) ; AWS CloudTrail (immutability).
- **Build docs:** internal — append-only `AdminAudit`; no update/delete endpoints exist for it.

## Journey 13.10 — Browse any table in the database (internal data browser) — *and why not everything is a user-facing object* [LATER]

*As a superadmin, I want a read-first table view over **any** table in the database — Users, Workspaces, Recordings, Calls, UsageEvents, jobs — so that I can support customers and debug without writing SQL or opening a DB client.*

You asked whether we should let a table view show **basically any object in the DB** (users, workspaces, recordings, calls, …), and left the call to me. **My take: yes — but as an *internal superadmin* tool (this journey), not by making every model a customer-facing CRM object.** The distinction is the point:

- **Customer-facing first-class objects already get a table for free.** People, Companies, Deals, Calls, Emails, Texts, Meetings, Tasks, and every custom object get a navbar link + table via the doc-4 engine. That's the CRM surface, and it's done.
- **The models in your list that *aren't* first-class** split into two buckets, and neither should become a user-facing object:
  - **Platform data — Users, Workspaces, `UsageEvent`, jobs, `AdminAudit`.** These are **cross-tenant / operational**; surfacing them in a customer's CRM would leak other tenants' data. They belong to **you**, the operator — which is exactly this console.
  - **Supporting models — Recording, Transcript, Summary, PhoneNumber, SmsMessage.** These deliberately **hang off a record** and are shown inside it (doc 4 *first-class vs supporting*). A customer browsing a raw "all recordings" table is rarely useful and clutters the object model.
- **So the cool feature is a superadmin *data browser*, not "everything is an object."** It's the safe, powerful version of your idea.

1. **Entry point.** Console nav → **Data browser**. A left list shows **every table** — Prisma models plus the `Record`-backed dynamic objects rendered as tables.
2. **Browse (read-many).** Clicking a table opens the **same fast grid the app uses** (doc 4c §A — Glide) in **read-only** mode: columns, sort, filter, and the select-all-N mechanics, over any table. A **workspace filter** at the top scopes to one tenant by default, with an explicit **"all workspaces"** toggle for cross-tenant models like `UsageEvent`.
3. **Row detail (read-one).** Clicking a row opens a raw field inspector (all columns, including ids and JSON), with links that **follow foreign keys** (a Call → its Person, Recording, Transcript), so you can walk the graph.
4. **Read-first; writes are guarded + audited.** The browser is **read-only by default.** The few **support edits** that belong here (suspend a workspace, reset a stuck job, clear a flag) are the **existing typed journeys** (13.5 / 13b / etc.), each **step-up-gated and `AdminAudit`-logged** — *never* free-form row editing of production data, which is how people corrupt a database.
5. **Not a customer feature.** This lives **only** in the `/admin` console (superadmin auth + IP gate, Journey 13.1). It is **[LATER]** relative to the core product — a solo-operator convenience, valuable once there are real tenants to support.

- **Benchmark (beat this):** **Prisma Studio** (browse any model, read-first) — https://www.prisma.io/studio ; **Retool / Forest Admin** (an admin panel over your DB) — https://retool.com ; **Django Admin** (the classic "table view of every model" pattern) — https://docs.djangoproject.com/en/stable/ref/contrib/admin/. *Want browse/inspect at least as convenient as Prisma Studio, without exposing writes it allows.*
- **Build docs:** internal — reuse the doc-4c Glide grid in read-only mode over a generic table introspector (Prisma **DMMF** for real models + `ObjectDef` for dynamic ones — https://www.prisma.io/docs/orm/reference/prisma-client-reference); any write is redirected to the existing audited action journeys, not performed inline.

---

## Background jobs (trigger, steps, pg-boss params)

- **B-SUSPEND / B-REACTIVATE.** **Trigger:** confirm in Journey 13.5. **Steps:** flip `Workspace.status`; revoke member sessions (suspend only); pause/resume that workspace's scheduled jobs; write audit. **pg-boss:** `admin-workspace-status` queue, `retryLimit: 3`, **idempotent on `(workspaceId, targetStatus)`** so a retry is a no-op.
- **B-IMPERSONATE.** **Trigger:** confirm in Journey 13.7. **Steps:** write audit row *first*, mint the time-boxed token, open the session. **pg-boss:** the mint is synchronous; the **closing** row (expiry) is written by a `singleton` sweep `impersonation-expiry` running every 1 min that closes any session past `exp`.
- **B-EXPORT.** **Trigger:** Journey 13.8 export. **Steps:** stream the workspace's data to an archive in S3, notify when ready. **pg-boss:** `admin-export` queue, `retryLimit: 2`, long `expireInHours: 6`, idempotent on `(workspaceId, requestedAt)`.
- **B-ERASE.** **Trigger:** Journey 13.8 delete (after step-up + name-type). **Steps:** run the [doc 11.9](11-multiuser-teams-and-permissions.md) cascade delete incl. S3 objects, honoring legal hold; write final audit. **pg-boss:** `admin-erase` queue, `retryLimit: 1` (destructive — don't blindly retry), **idempotent on `workspaceId`**, dead-letter to human review on failure.

All four inherit the shared pg-boss health surface from [doc 12](../development-guidelines/12-devops-and-infrastructure.md) (queue depth, failure rate, dead-letter), visible on the Overview (Journey 13.2).

---

## Decisions for you (superadmin console)

**1. Console home — `admin.` subdomain vs `/admin` path. Decided (my pick): `admin.` subdomain in prod, `/admin` path in dev.** Subdomain buys cookie isolation and edge-level IP/WAF rules; the path keeps local dev on one server. Same app either way — no second deploy. *Alternative: path everywhere — rejected; weaker isolation for a console with cross-workspace power.*

**2. Impersonation write-access — read-mostly with confirms vs full write. Decided (my pick): read-mostly, extra-confirm on writes, hard-block on billing/deletion.** Support usually needs to *see*, not *change*; the rare needed write is one confirm away and fully audited. *Alternative: full write parity with the user — rejected; erases the line between support and account takeover in the logs.*

**3. Off-the-shelf admin (Retool/Forest) vs custom `/admin`. Decided (my pick): custom `/admin` in-app.** Our actions are specific (model routing, kill-switches, ledger-linked budgets) and touch our own DB; a generic admin tool is another bill, another auth surface, and still needs custom code. *Alternative: Retool for speed — reconsider only if the console grows faster than we can hand-build it.*

## Data model (Prisma) — additions in this doc

```prisma
// --- Workspace: operator fields (extends the Workspace in doc 1) ---
model Workspace {
  // ...existing fields from doc 1...
  status          String   @default("active")  // active | suspended  (Journey 13.5)
  suspendedReason String?
  suspendedAt     DateTime?
  seatCap         Int      @default(3)          // adjustable (Journey 13.6)
  callsPerDayCap  Int?                          // optional usage limit (Journey 13.6)
}

model AdminAudit {              // NEW — every superadmin action, append-only (Journey 13.9)
  id          String   @id @default(cuid())
  adminId     String                            // the real superadmin acting
  action      String                            // impersonate | suspend | reactivate | adjust_limits | export | erase | disable_provider | change_model | flip_flag | ...
  targetType  String?                           // workspace | user | provider | feature | flag
  targetId    String?
  reason      String?
  detailJson  Json?                             // action-specific payload; impersonation stores duration + writes made
  createdAt   DateTime @default(now())
  @@index([adminId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
  // No update/delete path is ever exposed — append-only.
}

model ImpersonationSession {    // NEW — time-boxed support view (Journey 13.7)
  id            String   @id @default(cuid())
  realAdminId   String
  actingUserId  String
  workspaceId   String
  reason        String
  startedAt     DateTime @default(now())
  expiresAt     DateTime                         // startedAt + <=60min
  endedAt       DateTime?                         // set by Exit or the expiry sweep
  @@index([realAdminId, startedAt])
}
```

*The cost/model/flag models (`UsageEvent`, `CostBudget`, `ModelRouting`, `FeatureFlag`) live with their journeys in [doc 13a](13a-superadmin-cost-monitoring.md) and [doc 13b](13b-superadmin-model-and-killswitches.md).*

## Technical decisions, trade-offs & edge cases

**The console is code-adjacent, data-shared, UI-separate.** Same repo / DB client / deploy (so actions can write our DB with zero friction), but its own layout, nav, subdomain, and auth gate (so it never leaks into or from the customer app). This is the cheapest safe shape for a solo builder.

**Every action writes its audit in the same transaction.** An action and its `AdminAudit` row commit together — so there is no path where a workspace gets suspended but the log doesn't show it. The log is append-only and mirrored to Axiom.

**Destructive actions are gated, not fast.** Suspend, impersonate, key-rotate, and erase each require TOTP step-up (and erase adds type-to-confirm). This matches the system safety rules: irreversible or outward-facing operations get an explicit, per-action confirm — never a session-wide free pass.

**Read from where the data already is.** Health and cost are not re-stored for the console; they're read from Axiom and the ledger. The console *owns* only the write models above. This keeps it thin and keeps one source of truth per number.
