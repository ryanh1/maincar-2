# Doc 5 — Comms: Email, Calendar & Meetings

*This is the comms half of the old doc 5. That doc grew too big and split into three, each keeping its original journey numbers so cross-references still resolve:*
- **This doc (5)** — connect a mailbox and calendar; match synced mail/events to CRM records; compose, template, and send email; signatures; the calendar; Google/Microsoft OAuth; mailbox deliverability; and meeting recording.
- **[Doc 5a](5a-crm-data-ops-and-hygiene.md)** — bulk actions, undo, dedupe/merge/trash, import, the Chrome extension, retention, audit log.
- **[Doc 5b](5b-reporting-and-dashboards.md)** — reporting, dashboards, and user profiles.

Benchmarks here are **Superhuman/Gmail** (email), **Attio** (compose, calendar, sync), **Gong** (email/meeting matching), and **Recall.ai** (meeting bots).

*Global edit carried over: this pillar adds a **Campaign** object (groups outreach) and a **Script** object (call/email copy tied to a campaign). The call screen's "battlecard" reads the current campaign's script.*

**Convention — sync scope.** Every journey that syncs from an outside system states **two** things: (1) the **live** sync (new items from now on, and its cadence) and (2) the **back-fill** on first connect (how far back, how many, and that it is batched/backgrounded). This applies to every sync journey in every doc.

**Convention — background jobs.** Every job states its **trigger**, its **algorithmic steps**, and its **pg-boss** params. Every UI journey states its **entry point** first.

---

## New objects this doc adds

- **Campaign** — a named grouping of outreach (a push, a quarter, a segment). Deals, Calls, and Emails can carry a `campaignId`.
- **Script** — call or email copy tied to one campaign. The dialer shows the active campaign's script; email templates (Journey 5.5) can be tied to one.

## New surfaces this doc adds

- **Settings → Integrations** — Google Workspace and Microsoft 365 connections, and the **Capture** and **Record creation** policies.
- **Settings → Mailboxes** — connected mailboxes, per-mailbox **signatures**, and a per-mailbox **deliverability/health** panel.
- **Email composer** — a dockable bottom-right corner widget; a per-record email thread on the timeline.
- **Calendar** page in the navbar + upcoming events on the record timeline.
- **Recordings** area + **Settings → Recording rules**.

---

## Journey 5.2 — Relate emails and events to CRM records

*As a rep, I want every email and meeting with a contact to attach itself to the right Person, Company, and Deal automatically, so that the CRM is always complete without me logging activity by hand.*

This is a complex routing problem, and your feedback was right that "relate emails and events" is really **many** journeys — a first sync, a live poll, a matching algorithm, an unmatched-hold cleanup, and exclusion rules — each with its own chronology. The sub-journeys below break them out. The model follows **Gong** (match-only by default, so it never pollutes the CRM), and this rewrite folds in several Gong edge cases the earlier draft missed.

**The match order (used by the algorithm in 5.2c; first hit wins for the *primary* attach, but the activity is logged against *every* match):**
1. Participant **email** = an existing **Person** → attach to that Person → and their **Company**.
2. No Person, but participant **email domain** (or its parent domain, so `sub.acme.com` → `acme.com`) = a Company's domain → attach to the **Company**.
3. Several Companies share the domain → **attach to all of them** (Gong does this — don't force a single pick), and mark the most-recently-active as primary for display.
4. **Deal pick:** among the matched Company's **open** Deals, attach to the one whose **owner is a participant**; if none, fall back to the open Deal with **activity date closest to this message** (Gong's heuristic); tie-break by most-recently-modified. No open Deal → log at Company level only.
5. No Person and no matching domain → **hold as unmatched for 30 days** (Journey 5.2e) for later re-match, then drop.

**Create vs update — default is match-only (like Gong):**
- We **never** auto-create Companies or Deals from a message.
- We **never** auto-create People by default. An **opt-in admin setting** turns on auto-create for unknown participants on a *matched* Company — the setting's config journey, modes, and admin/non-admin behavior are specced in **[doc 5a Journey 5.3a](5a-crm-data-ops-and-hygiene.md)** (creation + dedupe live with the other record-hygiene journeys). This journey only *feeds* it.
- **"Everything else updates/logs onto existing records" — what that means (your clarify):** for any message that matches an existing Person/Company/Deal, we don't create anything new — we simply **append the email or meeting as an activity** on those records' timelines and **update derived fields** on them (Last-contacted date, Last-interaction, activity counts). "Update/log onto existing records" = attach the activity + refresh those roll-up fields, nothing more.

### 5.2a — First connect: back-fill sync and what the user sees

*As a rep, I want my recent history to appear the moment I connect my mailbox, and to know it's working, so that the CRM is useful on day one.*

**When it runs:** immediately when the user finishes the OAuth connect (Journey 5.7) — not a nightly batch, not "later." Connecting is the trigger.

1. The instant OAuth succeeds, a **"Importing your email & calendar…"** panel appears on the connection card with a live progress bar and a running count: *"Matched 320 emails and 45 meetings to 120 contacts so far…"* The user can leave the page; it keeps running.
2. **Back-fill window:** **12 months** of email + events by default (admin-overridable to 3 / 6 / 12 — Journey 5.2f settings). We fetch history via the provider's list API (Gmail `messages.list` with `newer_than:12m`; Graph `messages` with a `receivedDateTime` filter — Journey "Google vs Microsoft" below), page through it, and run each message through the matcher (5.2c).
3. **Only messages with ≥1 CRM match are stored** (see "≥1 CRM match" below) — we do **not** ingest the whole mailbox.
4. **On done:** the panel flips to **"Import complete — 1,240 activities added to 210 contacts,"** with a link to a filtered view of what was captured. If nothing matched (a brand-new workspace with no contacts yet), the copy says *"No matches yet — as you add contacts, we'll attach their past email automatically,"* so an empty result never reads as a failure.

- **Background job — F2-backfill.** **Trigger:** OAuth connect success. **Steps:** page provider history (~500 messages/job chunk), run each through the matcher, store matches, update the progress counter. **pg-boss:** `mail-backfill` queue, `retryLimit: 5` with backoff (provider rate limits), idempotent per `(mailAccountId, providerMsgId)` via a unique index, `singletonKey = mailAccountId` so one mailbox back-fills once at a time.

### 5.2b — Live incremental poll (the ~5-minute sync) and how data flows

*As a rep, I want new mail and meetings to show up within minutes, so that the CRM reflects what just happened.*

**When it runs and the data flow:**
1. After back-fill, an **incremental poll runs every ~5 minutes** per connected account (plus a provider push subscription that can trigger a poll sooner — see below).
2. Each poll asks the provider **"what changed since my cursor?"** — Gmail `history.list` from the stored `historyId`; Graph `messages/delta` from the stored `deltaLink`; calendar via `syncToken` (Google) / `calendarView/delta` (Microsoft). We get back only new/changed/deleted items, not the whole mailbox.
   - **What "Graph delta" is (your clarify).** "Delta" is **Microsoft Graph's word for an incremental-change query.** You call a `.../delta` endpoint; Graph returns the changes plus an opaque **`deltaLink`** URL; you store that URL and pass it back on the next poll to get only what changed since. It is Microsoft's equivalent of Gmail's `historyId` cursor — same idea (a bookmark of "where I left off"), different mechanism (an opaque URL vs an integer).
   - **How far back an incremental poll looks (your clarify).** An incremental poll is **not time-boxed** — it does not look back "5 minutes" or "a day." It fetches **everything since the stored cursor**, however long ago that was. So if a mailbox was offline for two days, the next poll returns all two days of changes in one catch-up run. The only time a fixed lookback applies is the **first-connect back-fill** (12 months, Journey 5.2a) and the bounded re-page we do if a cursor expires.
3. Each new item runs through the **same matcher (5.2c)** as back-fill. Matches are stored and attached to timelines; the derived roll-up fields on the matched records update; the cursor advances.
4. **Push, to make it feel instant:** we also register a provider push subscription (Gmail `watch` → Pub/Sub; Graph change-notification subscription). A push doesn't carry the mail body — it just tells us "something changed," so we run an off-cycle poll immediately. The 5-minute timer is the floor that guarantees sync even if a push is missed (Google's calendar pushes are explicitly "not 100% reliable").

- **Background job — F1 (mailbox + calendar sync).** **Trigger:** a 5-minute pg-boss cron per account, plus a push-triggered off-cycle run. **Steps:** call the provider delta endpoint from the stored cursor → run new items through the matcher → store + attach → advance the cursor. **Cursor-expired handling:** Gmail stale `historyId` → HTTP 404, Google Calendar stale `syncToken` → HTTP 410 → in both cases wipe the cursor and re-run a bounded full sync; Graph tokens are opaque → on invalidation restart the delta cycle. **pg-boss:** `mail-sync` queue, `retryLimit: 3`, honor `Retry-After` on Graph 429s and Gmail quota-unit backoff, `singletonKey = mailAccountId`.

### 5.2c — The matching algorithm: when it runs and the logic flow

*As the system, I resolve each message to the right records deterministically, so that activity lands correctly and nothing pollutes the CRM.*

**When it runs:** once per message/event — during back-fill (5.2a) and during each incremental poll (5.2b). It is **not** a separate nightly job; matching happens **as messages arrive**.

**The logic flow (per message):**
1. **Extract participants** — sender, To, Cc, Bcc for email; for a meeting, the invitee list **merged with the actual attendees** reported by the conferencing provider (Gong does this — invitees ≠ who actually joined).
2. **Apply exclusions first** (5.2f) — internal-only, role addresses, bulk inbound, keyword/domain excludes, bounce/auto-reply. Excluded → discarded, never stored.
3. **"≥1 CRM match" — what it means and how the filter works (your clarify):** run each remaining participant through the match order above. **"≥1 CRM match" = at least one participant resolved to an existing Person or Company.** If **zero** participants resolve, the message is **not stored** in the CRM (email) or is **held unmatched for 30 days** (so a contact added later back-attaches it — 5.2e). This is the filter that keeps us from ingesting the entire mailbox: no CRM connection, no stored activity.
4. **Attach** — primary attach by first hit in the match order; **log the activity against every matched record** (a message to two customer domains attaches to **both** Companies).
5. **Update derived fields** on the matched records (last-contacted, counts).
6. **Unknown-but-on-a-matched-Company participant** → hand to auto-create (doc 5a 5.3a) **only if** the setting is on; otherwise just log against the Company.

**Gong edge cases this now covers (from reading Gong's matching docs — the earlier draft missed these):**
- **Attach to all matched Companies**, not a single pick (match order step 3).
- **Deal selection** falls back to **activity-date proximity** when no open deal has a participant-owner (step 4).
- **Subdomain / parent-domain** matching (`sub.acme.com` → `acme.com`).
- **Known contact on a personal domain (gmail/outlook):** public domains are excluded by default, which would silently drop a real contact emailing from a personal address. We handle it explicitly: if the **exact email** already matches a Person, we attach even on a public domain; we only apply the public-domain *exclusion* to the domain→Company step (so we never create/guess a Company from `gmail.com`).
- **Manual override freezes the record:** once a user manually re-associates an activity, later auto-matching **does not overwrite** that manual link (a `manualAttach` flag on the activity).
- **Retroactive re-match:** unmatched items are re-tried when new CRM data appears (5.2e).
- **Leads (a note, not a v1 build):** Gong matches to a Lead object too. We don't have a Lead object; our closest is an unconverted Person. Flagged as a possible future object rather than silently missing.
- **Green-field we choose to add (Gong doesn't):** meeting **organizer vs attendee** weighting and **attendee response status** are available signals — we prefer the organizer and accepted attendees when picking the primary Deal, a small precision win.

### 5.2e — The unmatched hold and its cleanup job (back-attach vs drop)

*As the system, I keep briefly-unmatched activity for a while so a contact added later reclaims its history, then I clean up, so that the hold buffer never grows without bound.*

- **What goes in the hold:** a message that passed exclusions but had **zero CRM matches** is parked in a 30-day **unmatched hold** (not shown in the CRM), with just enough metadata to re-match.
- **Back-attach when a Person/Company is created later (your clarify):** when a new Person or Company is created (by hand, import, or the extension), a re-match runs over the **hold buffer + the last 30 days** and **back-attaches** any activity that now matches — so adding "Jane @ Acme" today pulls in last month's thread with her automatically.
- **The cleanup (the "recurring job that deletes these" you asked about):** the **retention sweep (doc 5a F6)** drops hold entries older than 30 days on its nightly run. So "hold for 30 days" is enforced by F6, not a separate timer — one sweep owns all time-based purges.
- **Background job — F2-rematch.** **Trigger:** a Person/Company create event. **Steps:** query the hold + last-30-days for participants matching the new record → attach → clear the hold entry. **pg-boss:** `mail-rematch` queue, `retryLimit: 3`, `singletonKey = newRecordId`.

### 5.2f — Exclusion rules, the settings, and retroactive purge

*As an admin, I want to control which mail gets captured and exclude noise, so that the CRM logs real customer conversations and nothing else.*

**Entry point:** **Settings → Integrations → Capture.** Each setting, what it does, its form control, and how it feeds the algorithm (your "explain each setting + form layout + how it applies to the logic" ask):

| Setting | Form control | What it does in the algorithm (5.2c) |
|---|---|---|
| **Internal domains** | tag input (add domains) | Any message where **all** participants are on these domains is **internal-only** → excluded (step 2). Also drives internal/external meeting detection (5.11). |
| **Domain allow / deny** | two tag inputs | Deny-listed domains are excluded; allow-list (if used) restricts capture to only those domains. |
| **Address excludes** | tag input (emails) | Specific addresses never captured. Pre-seeded with role addresses. |
| **Auto-exclude role addresses** | toggle (default ON) | Drops `help@`, `no-reply@`, `noreply@`, `billing@`, etc. via a pattern list. |
| **Drop bulk inbound** | toggle + number (default >15) | A message with more than N non-CRM recipients is treated as a blast → excluded. |
| **Subject-keyword excludes** | tag input (phrases) | Case-insensitive; quoted phrase = exact. Matches Gong's keyword exclusion. |
| **What to log** | segmented: Email / Meetings / Both | Limits which activity types the matcher stores. |
| **Per-user opt-out** | per-user toggle | A user can exclude their own mailbox from capture entirely. |
| **Back-fill window** | segmented: 3 / 6 / 12 mo | Sets the first-connect history depth (5.2a). |

**Adding an exclusion after sync — the journey and data flow (your worked example ask).** Example: a rep realizes their support alias `support@ourco.com` has been capturing ticket noise.
1. Admin goes to **Settings → Integrations → Capture → Address excludes** and adds `support@ourco.com`, then **Save**.
2. Saving enqueues a **retroactive purge** (job): every already-stored activity that now matches the new exclusion is **deleted from timelines** and its derived counts are recomputed. A toast confirms *"Removed 412 previously captured activities matching this rule."*
3. **Which algorithm runs are impacted:** from now on, the matcher (5.2c) drops matching mail at step 2, so future polls never store it. Past data is purged by the retroactive job.
4. **Un-excluding does NOT re-import (a Gong behavior we adopt):** if the admin later *removes* the exclusion, we do **not** resurrect the purged mail (it's gone); capture simply resumes going forward. The Save dialog says so, so it's not a surprise.
- **Background job — F2-purge.** **Trigger:** a new/edited exclusion rule. **Steps:** find stored activities matching the rule → soft-delete → recompute affected derived fields → write one grouped audit entry (doc 5a). **pg-boss:** `capture-purge` queue, `retryLimit: 3`, idempotent per (ruleId, activityId).

### Google vs Microsoft — how to do this for each, and what differs

Both providers reach the same outcome, but the mechanics differ enough to spec per side (verified against current developer docs). Scopes are least-privilege: Google `gmail.readonly` + `gmail.send` + `calendar`; Microsoft `Mail.Read` + `Mail.Send` + `Calendars.ReadWrite` (all delegated, no admin consent needed).

| Concern | Google (Gmail + Calendar API) | Microsoft (Graph mail + calendar) |
|---|---|---|
| **Mail incremental cursor** | `historyId` (integer) → `users.history.list` | opaque `@odata.deltaLink` (`$deltaToken`) → `messages/delta`, **per folder** |
| **Calendar incremental** | `events.list?syncToken=…` | `calendarView/delta?startDateTime=…&endDateTime=…` |
| **Cursor expired → full resync** | Gmail stale id → **404**; Calendar stale token → **410 Gone** → wipe + full sync | opaque tokens → restart the delta cycle (no distinct status code) |
| **Push transport & lifetime** | Gmail `watch` → **Pub/Sub**, ~7-day max, **renew daily**; Calendar `events.watch`, **no auto-renew**, payload carries no data → re-query | Graph **subscriptions**, mail/calendar **~7 days (10,080 min)**, extend via PATCH before expiry |
| **Throttling** | quota-**unit** budget (list=5, get=20, history=2, send=100 units) | HTTP **429 + `Retry-After`**; ~10,000 req/10 min per app-mailbox, 4 concurrent |
| **Back-fill** | `messages.list` (`newer_than:12m`, `maxResults` ≤500) then `messages.get` | `messages?$filter=receivedDateTime ge …&$top=…`, follow `@odata.nextLink` |
| **Send (lands in real Sent)** | `users.messages.send` (base64url MIME); thread via `threadId` + `References`/`In-Reply-To` | `sendMail` (`saveToSentItems` default true); thread via `internetMessageHeaders` / MIME |

**What must be different in code (the spec-level differences):** (1) store a **bare cursor** for Google vs the **whole deltaLink URL** for Microsoft; (2) Google mail delta is **mailbox-wide** (one `historyId`) while Graph delta is **per-folder** — iterate folders on the MS side; (3) **renew Gmail `watch` daily** but Graph subscriptions can run ~7 days; (4) handle **404/410 → full resync** on Google explicitly; (5) both auto-save to Sent, but threading headers are set differently. We wrap both behind one internal `MailProvider` interface so the matcher and composer don't branch on provider.

- **Build docs:** Gmail sync — https://developers.google.com/gmail/api/guides/sync ; Gmail push — https://developers.google.com/gmail/api/guides/push ; Graph mail delta — https://learn.microsoft.com/en-us/graph/delta-query-messages ; Graph calendar delta — https://learn.microsoft.com/en-us/graph/delta-query-events ; Graph subscriptions — https://learn.microsoft.com/en-us/graph/api/resources/subscription

### What record types this matches, and other sources we should match (your ask)

**Today this links activity to:** **People** (by email), **Companies** (by domain), and **Deals** (by open-deal heuristics). The same matcher already powers **call** matching (doc 2) and **meeting/recording** attach (Journey 5.10), so calls, emails, and meetings all resolve through one engine.

**Other sources of records we can match with the same logic (your "are we missing similar algorithmic logic" prompt):**
- **Calendar attendees** → People/Companies (already, via the meeting participant list).
- **Meeting location / conferencing link** → we already read the join URL for recording (5.10); we can also use a **physical location** string as a weak Company signal (e.g. an address matching a Company) — noted as a precision add, not core.
- **Chrome-extension / imported rows** → run through the same dedupe + match on create (doc 5a).
- **A future Lead-like object** — flagged above.
This one matcher is the shared "resolve a participant/identifier to CRM records" service; every new source (SMS in doc 3, LinkedIn in doc 5a) calls it rather than re-implementing matching.

### Monitoring, health, and automated testing for these jobs

**Monitoring & audit (your ask).** All F-jobs run on the shared pg-boss runner (doc 12), so each exposes **queue depth, failure rate, and dead-letter count** to Axiom with the standard "failed jobs > N in 10 min" alert. Sync-specific health we watch and surface in the superadmin console (doc 13): **cursor age** per account (a cursor not advancing = a stalled mailbox), **404/410 full-resync rate** (a spike means cursors are expiring too often), **push-subscription expiry** (alert before a `watch`/subscription lapses), **match rate** (% of polled messages that matched — a sudden drop flags a matching regression), and **hold-buffer size**. Every attach/purge writes to the audit log (doc 5a), so a support engineer can trace why a given email did or didn't attach.

**Automated testing (your ask) — the edge cases we must cover.** Reuse the eval-fixtures pattern (doc 7a):
- **Matcher unit fixtures:** exact-email match; domain match; subdomain/parent-domain match; multiple companies on one domain (attach-to-all); known contact on a personal domain (attach) vs unknown on a personal domain (don't create a Company); role/no-reply excludes; bulk-inbound over threshold; internal-only excluded; two-customer-domain email (attach both); meeting invitees ≠ actual attendees; manual-attach freeze.
- **Sync integration tests (mocked provider):** first-connect back-fill paging; incremental delta; **cursor-expiry → full-resync** for Gmail 404 and Calendar 410; Graph per-folder delta; push-triggered off-cycle poll; idempotency (same `providerMsgId` twice stores once).
- **Lifecycle tests:** unmatched-hold → create Person → back-attach; add exclusion → retroactive purge; un-exclude → no re-import; user suspended → sync stops but activity kept.
- **Bar:** the matcher fixtures must hit **≥98% precision** (a wrong attach is worse than a miss) with the labeled set green in CI before any sync change ships.

- **Benchmark (beat this):** Gong — importing calendar meetings and emails — https://help.gong.io/docs/about-importing-calendar-meetings-and-emails ; email/account matching — https://help.gong.io/docs/faqs-about-email-account-matching ; excluding emails — https://help.gong.io/docs/excluding-emails-from-import
- **Build docs:** the `MailProvider` interface over the Google/Microsoft docs linked above.

## Journey 5.4 — Connect and manage mailboxes

*As a rep, I want to connect my mailbox in one step and manage multiple mailboxes, so that the CRM sends and logs from my real inbox.*

**Google and Microsoft are the same journey** — both run OAuth via Journey 5.7 (Microsoft is **not** deferred; Gmail is just the first we test). Benchmarks: Attio (onboarding), SmartLead (multi-mailbox management), Apollo.

### 5.4.1 — First-run onboarding (the "why connect" screen)

*As a new user, I want connecting my inbox to be its own clear step that tells me why it matters, so that I do the single action that makes the CRM valuable.*

1. On first use, connecting the mailbox is its **own one-step screen** — big **Connect Google** / **Connect Microsoft** buttons, an image of what auto-captured activity looks like, and a one-line "why it matters": *"We log every email and meeting automatically, so you never enter activity by hand."* Step X of N, with a "Skip for now."
2. Connecting the inbox is the single highest-retention action, so it stands alone rather than being buried in a settings list.

**On the Attio onboarding benchmark (your "did you get the screenshots" ask).** Attio's *help center* does **not** host a screen-by-screen reproduction of its big onboarding screens — the closest official page is its Academy "onboarding your team" guide (rollout advice, not screenshots), plus the sync docs that carry the "why syncing matters" rationale (auto-built, always-current records). The actual onboarding **screens** are captured in third-party UX galleries (Mobbin, SaaSUI). The **critical thing you flagged — that the screen explains *why* connecting matters** — is exactly what Attio does well and what we copy: a benefit-led connect step ("we build and keep your records current from your email/calendar"). We aim to be **more explicit about the payoff and lower-friction** than Attio.

- **Benchmark (beat this):** Attio — onboarding your team (rationale + rollout) — https://attio.com/help/academy/attio-for-product-led-growth/onboarding-your-team ; why syncing matters — https://attio.com/help/reference/email-calendar/email-and-calendar-syncing ; onboarding screens (non-Attio galleries) — https://mobbin.com and https://www.saasui.design/pattern/onboarding/attio
- **Build docs:** internal onboarding step + Journey 5.7 OAuth.

### 5.4.2 — Connect, set primary, and manage mailboxes

*As a rep with one or more inboxes, I want to connect them, choose which one sends by default, and fix a broken connection, so that I can send and log from the right mailbox without silent failures.*

1. **Connect flow.** Choose provider → provider OAuth popup (mail + calendar scopes) → on success the mailbox shows **Connected** (green), and the back-fill panel (5.2a) starts. **Microsoft edge case:** if admin consent is blocked, show "ask your IT admin to approve" with the consent URL — never dead-end.
2. **Set primary.** The first mailbox connected is auto-**Primary** (the default "from"). The management list shows a **Primary** badge on one row; every other row has **Set as primary** (single-primary invariant). Any send can override the sender from a dropdown of connected mailboxes.
3. **Manage mailboxes (SmartLead-style, one screen)** at **Settings → Mailboxes**: a table of every mailbox — address, provider icon, display name, **status** (Connected / Needs reauth / Error), Primary badge, last-synced time, and a **deliverability health chip** (Journey 5.4a). Row actions: **Set as primary, Edit name/signature (Journey 5.5b), Reconnect** (re-run OAuth on token expiry), **Remove** (revoke + confirm). An expired token shows **Needs reauth** with one-click Reconnect — never a silent failure. Top-level **Add mailbox**; empty state prompts the first connect.
4. **Sync scope (per convention).** **Live:** Gmail `watch` + `history.list` / Graph delta, ~5-min incremental (Journey 5.2b). **Back-fill:** 12 months, admin override 3/6/12, backgrounded (Journey 5.2a).

- **Benchmark (beat this):** Apollo — link your mailbox — https://knowledge.apollo.io/hc/en-us/articles/4409127806093-Link-Your-Mailbox-to-Apollo ; SmartLead (multi-mailbox management)
- **Build docs:** Google — OAuth 2.0 for web apps — https://developers.google.com/identity/protocols/oauth2

## Journey 5.4a — Mailbox deliverability and health

*As a rep or admin, I want each sending mailbox checked for the things that land mail in spam — auth records, warmup, and blocklists — with clear fixes, so that my outreach actually reaches the inbox.*

**This is the mailbox-deliverability journey you asked me to spec** (previously in the backlog). It is **five distinct checks**, each with its own mechanism, an **ongoing monitor**, and **setup guidance**. They roll into a single **color-coded health score** per mailbox, shown as a chip in the Settings → Mailboxes list; clicking it opens the health panel with a row per check.

**Entry point.** **Settings → Mailboxes → [a mailbox] → Deliverability.** A **Recheck now** button re-runs the live checks on demand; a background job re-runs them on a schedule.

The panel shows five rows. For each: what it is, how we check it programmatically, and the fix we surface.

**5.4a.1 — SPF (are we authorized to send as this domain?)**
- **Check:** DNS **TXT** lookup on the domain root (`node:dns/promises` `resolveTxt`), find the single `v=spf1` record. **Pass** = exactly one SPF record, ends in `~all`/`-all` (not `+all`), and total DNS lookups ≤ 10 (over 10 = the common `permerror`).
- **Fix copy:** "Add one TXT record at your domain root. Google Workspace: include `_spf.google.com`. Microsoft 365: include `spf.protection.outlook.com`. End with `~all`. Keep total lookups under 10." Copyable record + **Recheck**.

**5.4a.2 — DKIM (are messages cryptographically signed?)**
- **Check:** DNS TXT at `<selector>._domainkey.<domain>`; **pass** = record exists with a non-empty `p=` key. Selector discovery is the catch — probe common selectors (`google` for Workspace; `selector1`/`selector2` CNAMEs for M365) or read `s=` from a sent message's `DKIM-Signature` header. For true message-level verification we parse a test send with **mailauth** `authenticate()`.
- **Fix copy (provider-specific):** Google — Admin console → Gmail → Authenticate email → generate 2048-bit key → publish `google._domainkey` TXT → Start authentication. Microsoft — Defender → Email authentication → DKIM → publish the two `selector1/2` CNAMEs → enable signing.

**5.4a.3 — DMARC (what should receivers do on failure?)**
- **Check:** DNS TXT at `_dmarc.<domain>`, parse `v=DMARC1; p=…`. **Pass** = present and valid; **grade by policy** — `p=none` = WARN (monitoring only), `p=quarantine`/`p=reject` = good. Parse `rua`/`pct`/`adkim`/`aspf` too.
- **Fix copy (a ladder):** "Start at `p=none` with a `rua=` report address → once SPF+DKIM align on your real mail, move to `p=quarantine` → then `p=reject`." Note the Google/Yahoo bulk-sender rule requires at least `p=none`.

**5.4a.4 — Warmup (does this mailbox have sending reputation yet?)**
- **What it is & why:** a new domain/mailbox has no sending history; blasting volume triggers spam filtering. Warmup gradually ramps volume with automated sends/opens/replies among a pool of real inboxes to build trust.
- **How we handle it:** warmup is a **managed service, not a live DNS check** — the pool is proprietary. We treat it as an async/cached signal: show **warmup on/off, age (days since enabled), and reported inbox-placement %**. We drive it via a provider API (e.g. SmartLead `email-accounts` endpoints: `warmup_enabled`, `total_warmup_per_day`, `daily_rampup`, `reply_rate_percentage`), and independently sanity-check inbox placement with a seed test. Guidance we show: **new domain = warm up ~30 days (1–2 months ideal), starting ~5–10/day ramping to 50–100**; existing mailbox ~2 weeks.
- **Setup guidance:** a "Start warmup" action that sets sensible ramp defaults and explains the schedule, so a rep isn't left guessing.

**5.4a.5 — Reputation / blacklist (are we blocked anywhere?)**
- **Check — DNSBL:** reverse the sending IP's octets, append the blocklist zone, request an **A record** (`resolve4`); a `127.0.0.x` answer = listed, `NXDOMAIN` = clean. Check Spamhaus ZEN (`zen.spamhaus.org`), Barracuda, SORBS; Spamhaus **DBL** for the domain. Use a **custom resolver** (`Resolver().setServers`) — Spamhaus blocks queries from public resolvers like 8.8.8.8; a `127.255.255.x` answer means "you're on a blocked/rate-limited resolver," not "listed." The **dnsbl** npm lib handles the reversal + batching.
- **Check — Postmaster reputation:** Google **Postmaster Tools API** returns `domainReputation`/`ipReputations` as `HIGH/MEDIUM/LOW/BAD` plus `userReportedSpamRatio`. Flag at **>0.10%** spam, red at **~0.30%** (the bulk-sender ceiling). This needs Google OAuth + domain verification and has a 24–72h lag → treat as a cached signal.
- **Fix copy:** on a blocklist hit, show the listing zone + a delisting link; on LOW/BAD reputation or high spam-rate, "reduce volume, fix list hygiene and engagement."

**The health score & ongoing monitor.** The five checks aggregate into a **0–100 score with per-check badges** (SPF ✓, DKIM ✓, DMARC ✓, Warmup: on/age, Blacklist: clean/listed, Reputation: HIGH…BAD). SPF/DKIM/DMARC/DNSBL are cheap live DNS checks; warmup and Postmaster are async/cached. MVP can ship the **auth-record checks (SPF/DKIM/DMARC) + DNSBL** first and layer warmup + Postmaster after.
- **Background job — `mailbox-health`.** **Trigger:** daily pg-boss cron per mailbox + on-demand Recheck. **Steps:** run the DNS/DNSBL checks live; pull cached warmup + Postmaster signals; recompute the score; if a check flips to failing, notify the mailbox owner. **pg-boss:** `mailbox-health` queue, `retryLimit: 2`, `singletonKey = mailAccountId+day`.

- **Benchmark (beat this):** SmartLead — email warmup + mailbox health — https://api.smartlead.ai/guides/email-warmup ; MxToolbox — SPF/DKIM/DMARC/blacklist checks — https://mxtoolbox.com ; dmarcian — DMARC guide — https://dmarcian.com/what-is-dmarc/ ; Google Postmaster Tools — https://developers.google.com/gmail/postmaster
- **Build docs:** `node:dns/promises`; **mailauth** — https://github.com/postalsys/mailauth ; **dnsbl** — https://www.npmjs.com/package/dnsbl ; RFCs 7208 (SPF) / 6376 (DKIM) / 7489 (DMARC).

## Journey 5.5 — Compose, send, and template email

*As a rep, I want a fast, keyboard-first composer I can keep open while I browse the app, so that writing email never pulls me off the record I'm working.*

**Composer UI — a dockable corner widget, like the dialer.** The composer opens as a **minimizable card in the bottom-right corner** (Gmail's model), so the rep can navigate anywhere in the app while the draft stays docked. Still keyboard-first (`c` to compose, ⌘K palette, `⌘;` snippets), and it minimizes to a small bar so a half-written email is never lost.

**How multiple composers look and behave (your ask).** Opening a second (or third) composer **stacks the cards side by side along the bottom edge**, right-to-left, exactly like Gmail. Each card is independent — its own To/Subject/body and its own minimize state. Minimized cards collapse to **title-bar chips** ("Re: Pricing — Jane") that line up along the bottom; clicking one re-expands it. If cards would overflow the width, the oldest collapse to chips first. The **dialer and SMS composer share this same dock**, so calls, texts, and emails all live in one consistent corner surface.

**Recipient fields — chips that link to People, not raw text (your ask).**
1. **To / Cc / Bcc are chip fields**, not plain text boxes. Each recipient renders as a **chip**: a **blue chip links to the CRM Person** (click to open the record); a **plain chip** is a raw email not in the CRM (with a quick "＋ Add to CRM"). Backspace deletes a chip atomically.
2. **Selecting people — the autocomplete and its ranking (your ask):** typing searches CRM People **and** past correspondents, ranked so the likely recipient is first: **(1) people already on this thread**, then **(2) other People at the same Company as the current record**, then **(3) recent correspondents**, then **(4) any CRM Person**, then **(5) the raw address** you typed if nothing matches. We rank by **relevance to the conversation and the account** — *not* by your manager or org chart (those are internal colleagues; for external outreach we surface contacts, not coworkers). You can still type any address to add a plain chip. Adding a teammate as Cc works the same way — they just appear under "recent correspondents."
3. **From** = primary mailbox, overridable from a dropdown of connected mailboxes.

**Metadata fields shown by default (your Gmail comparison).** Like Gmail, we don't clutter the header: **To** and **Subject** show by default. **Cc/Bcc** are hidden behind a small **"Cc/Bcc"** link at the right of the To row that reveals them. **From** is hidden and defaults to the primary mailbox **unless more than one mailbox is connected**, in which case a From selector appears. This keeps the common case (one To, one Subject) clean.

**Drafts — how and where a half-written email is saved (your ask).**
- While typing, the composer **auto-saves to an internal draft** (`EmailDraft` row) every few seconds and on minimize/close — fast, offline-tolerant, and it survives a refresh or a reopened card. This is **our** draft state, not the provider's, so it works identically for Google and Microsoft and doesn't clutter the user's real Drafts folder.
- **Gmail comparison:** Gmail saves drafts server-side in your mailbox; we default to **our own** draft store for speed and provider-neutrality. As an **option** (Settings → Mailboxes), "Mirror drafts to my mailbox" writes the draft to the provider's Drafts via API so it also appears in Gmail/Outlook — off by default. Either way, a draft is never lost.

**The toolbar and sending:**
1. From a record (or `c`), the composer opens with **To** pre-filled from the record and **from** = primary mailbox.
2. **Toolbar — one lean row:** Bold · Italic · Underline · Strikethrough · Link · Bulleted list · Numbered list · Quote · Inline image · Attachment · **Insert merge field (`{{`)** · **AI / `/` menu** · Signature picker · Send-schedule · **⋯ More**. Font family, size, and text color live behind **⋯ More** (Journey 5.5b), so they're available without cluttering the row. Markdown shortcuts (`**bold**`, `- `) work, and selecting text pops a **selection formatting bubble** (a small floating B/I/U/link toolbar above the highlighted text, like Medium/Notion — this is what the old draft's confusing "highlight bubble" meant).
3. **Merge fields:** insert two ways — type **`{{`** for inline autocomplete, or the toolbar **Insert field** button (categorized: Contact / Company / Deal / Custom / System). Inserted fields render as **styled chips, not raw `{{...}}`**: **blue chip = has data**, **amber chip = missing for this contact**. A chip is atomic and clickable to set a **fallback** (`{{first_name | there}}`). A **"Preview as [contact]"** toggle resolves all chips and flags empty required fields before send.
4. **Templates** carry these merge fields and can be tied to a **Campaign's Script**.
5. He picks the mailbox (defaults to primary), and **Send** goes through the provider (Gmail API / Graph), landing in his real Sent folder.
6. The sent message shows on the record timeline (Journey 5.2). *Sending is always an explicit click — never automatic.*

**How we compare to Attio (your "at least as good" ask).** Attio's composer is basic rich text + templates + merge fields with fallbacks + sequences, and — notably — **no unified threaded inbox**. We **match** it (rich text, templates, merge fields with fallbacks) and **beat** it with dynamic/liquid/AI merge fields (Journey 5.5a) and the corner-dock multi-compose UX. The one place Attio's per-record model and ours are equal is reading: we both show threads on the record timeline. The clear way to **exceed** Attio is a **unified threaded inbox reader** (all your synced threads in one place) — we have the synced data already (Journey 5.2), so it's a reader view over `EmailMessage`; flagged as the next composer-side addition to pull ahead.

- **Benchmark (beat this):** Gmail — corner compose (minimizable, multiple open) — https://support.google.com/mail/answer/9004954 ; Attio — send emails — https://attio.com/help/reference/email-calendar/send-emails-in-attio ; Superhuman — shortcuts — https://superhuman.com/products/mail/shortcuts
- **Build docs:** TipTap — editor overview (HTML output) — https://tiptap.dev/docs/editor/getting-started/overview ; Gmail API — sending — https://developers.google.com/gmail/api/guides/sending ; Graph — sendMail — https://learn.microsoft.com/en-us/graph/api/user-sendmail

## Journey 5.5a — Dynamic, liquid, and AI merge fields

*As a rep, I want fields that compute or generate per recipient at send time, so that mass email still reads as personal.*

Beyond static lookups, a field can be **computed or AI-generated per recipient at send time** (SmartLead's model). Three field classes:
1. **Static** — direct lookup (`{{first_name}}`).
2. **Dynamic / liquid** — system-computed: `{{time_of_day}}` → "Good morning"; `{{day_of_week}}`; date math `{{date +2d "Do MMM"}}`; and **spintax** `{Hi|Hey|Hello}` picked at random per send for inbox variety.
3. **AI** — the user writes a prompt; an LLM generates the text per recipient from CRM context.

**Authoring an AI variable (the journey):**
1. **Trigger:** type `/ai` or pick "AI variable" from the `{{` menu.
2. **Prompt editor:** a popover asks for a **label** (`opener`), a **prompt** ("Write a one-line opener referencing their recent role change"), and the **CRM fields the AI may read** (referenced with `{{...}}` inside the prompt, so grounding is explicit and auditable).
3. **Insert:** collapses into a distinct **purple AI chip**.
4. **Generate & review:** a "Generate previews" step runs the AI **per recipient** and shows results in a **per-contact table** to spot-check/edit — **never auto-send unreviewed AI copy.**
5. **Guardrails:** each AI field has a **static fallback** if generation fails, a character cap, and a regenerate action.
6. **Send-time:** liquid computes, spintax rolls, AI resolves to its reviewed/cached value; chips become plain text.

- **Benchmark (beat this):** SmartLead — AI personalization — https://www.smartlead.ai/blog/cold-email-personalization-with-ai ; spintax — https://www.smartlead.ai/blog/what-is-spintax
- **Build docs:** the AI model is the super-admin-set backend model (global edit); render tokens as a deterministic pass, AI cached per recipient.

## Journey 5.5b — Signatures: configure, choose, and manage

*As a rep, I want to create and pick email signatures with sensible options, so that every email I send looks right without retyping my sign-off.*

**Your feedback revealed this missing journey.** We **create and manage our own signatures** (we don't silently reuse the provider's) — but on first mailbox connect we **offer to import** the signature already set in Gmail/Outlook as a starting point, so a rep isn't retyping it.

**Entry point.** **Settings → Mailboxes → [a mailbox] → Signatures** (also reachable from the composer's Signature picker → "Manage signatures").

1. **Create (C).** Click **New signature** → name it ("Default," "Short") → build it in the same rich-text editor as the composer (logo image, links, formatting). Save.
2. **Read/list (R).** The Signatures screen lists all signatures for the mailbox, showing which is the **default**.
3. **Update (U) / Delete (D).** Edit any signature; delete any except while it's the only default (deleting the default prompts you to pick a new one).
4. **Choose one.** Each mailbox has a **default signature** auto-appended to new emails; the composer's **Signature picker** swaps to any other signature (or none) per email.
5. **Options (the settings your feedback listed):**
   - **Placement on replies** — "Insert signature **above** the quoted reply" (Gmail's option) vs at the very bottom.
   - **Delimiter** — "Prepend the `-- ` delimiter line" (the RFC signature marker) toggle.
   - **Auto-linkify URLs** — on by default; and in the editor a link can be **selected → Remove link** to strip an unwanted hyperlink (so we don't force-link something).
   - **Per-mailbox default** — different signatures for different connected mailboxes.
6. **Import on connect (optional).** On first connect we can read the provider's existing signature and pre-load it as "Imported signature" for the user to keep or edit.

- **Benchmark (beat this):** Gmail — signatures (multiple, default, above-reply option, `--` delimiter) — https://support.google.com/mail/answer/8395
- **Build docs:** TipTap editor (reuse the composer editor); signature stored as sanitized HTML on `MailAccount`/`Signature`.

## Journey 5.6 — Calendar: view, draft, and send events

*As a rep, I want a light in-CRM calendar tied to my records, so that I can see and book follow-ups without leaving the CRM.*

**Scope — a thin, CRM-focused calendar.** An **agenda list** of upcoming events (default) with a **simple read-only week view**, each event tied to its CRM records. We do **not** build drag-to-create grids, multi-calendar overlays, availability/scheduling links, recurring-event editing, or working-hours management — that's what the real calendar is for.

1. The user opens the **Calendar** page and sees **upcoming events** synced from his connected account (job F1), each showing its matched People/Deal.
2. Clicking an event opens a panel with its CRM links (and it also shows on those records' timelines, Journey 5.2).
3. He can **draft a simple event** — title, time, attendees, description — and **Send**; it writes to his real calendar and invites go out through the provider. This covers the common "book a follow-up with this contact" case, not full calendar management.
4. The new event appears on the record timeline right away.

**How developed is this vs Attio (your "at least as good" ask).** **Attio's calendar is thin and read-only** — one-way sync, **no** week/day grid, **no** in-app event creation, **no** scheduling links; meetings only surface on record timelines, a Home "today" widget, and the ⌘K agenda peek. So our thin calendar is **already at least as good as Attio, and beats it** on one axis: **we let the user create and send an event in-app (step 3), which Attio does not.** To go *further* than "as good as Attio" — a real week/day grid and scheduling/availability links — is optional and flagged as the upgrade path; it isn't needed to meet the "at least as good" bar, which we clear.

**Rule — link out to the source app.** Anywhere we show data that lives in an externally integrated app (Calendar, Mail), we include an **"Open in Google Calendar ↗" / "Open in Gmail ↗"** link that opens the source item in a new tab — for anything beyond our thin surface (editing a recurring series, changing responses, the full thread). We handle the 80% inline and hand off the rest.

- **Benchmark (beat this):** Attio — email & calendar (the thin bar we already beat with in-app event creation) — https://attio.com/help/reference/email-calendar/view-emails-and-meetings
- **Build docs:** Google Calendar — create events — https://developers.google.com/workspace/calendar/api/guides/create-events ; Graph — create event — https://learn.microsoft.com/en-us/graph/api/user-post-events

## Journey 5.7 — Integrations: Google and Microsoft OAuth

*As a user, I want to connect and manage my Google or Microsoft account, so that mail and calendar sync works and I can disconnect cleanly.*

1. In **Settings → Integrations**, the user connects **Google Workspace** (email + calendar) or **Microsoft 365**.
2. Each runs the provider's OAuth consent for mail + calendar scopes (least-privilege — Journey 5.2 scope list); we store tokens encrypted (see tech choices).
3. **On return, we verify the granted scopes — not just that the connection succeeded** (Journey 5.7a). Only when the required scopes are present does the mailbox show **Connected** (green) and back-fill start.
4. He can **Test** (a health ping), **Refresh** (force a token refresh), or **Disconnect** (revoke + stop syncing).
5. If a provider **revokes** the token, sync pauses and the connection shows an error with a one-click reconnect.
6. **Job F7** refreshes access tokens before they expire so sync never silently stalls.

- **Benchmark (beat this):** Attio — sync your email and calendar — https://attio.com/help/reference/email-calendar/email-and-calendar-syncing
- **Build docs:** Google — OAuth 2.0 — https://developers.google.com/identity/protocols/oauth2 ; Microsoft Graph — auth on behalf of a user — https://learn.microsoft.com/en-us/graph/auth-v2-user

## Journey 5.7a — Verify granted scopes and repair a partial grant

*As a user, I want the app to notice if I didn't grant every permission it needs, so that I'm told exactly what's missing instead of hitting a silent half-broken sync.*

**The problem this fixes.** OAuth "success" is not the same as "we got the scopes we asked for." On Google's granular consent screen the permissions are **independent checkboxes** — a user can grant *Read* but untick *Send*, or grant mail but not *Calendar*. If we only check that the callback returned a token (the old behavior), we'd store a connection that looks Connected but can't send, and the failure would surface later as a confusing error mid-compose. So we **verify the actual grant on connect** and again on refresh.

1. **On the OAuth callback, read the scopes actually granted** — Google returns the granted `scope` set in the token response (and it's re-checkable via `tokeninfo`); Microsoft returns the granted `scp` claim on the access token. We compare that set against the **required** set for what the user is turning on (mail read, mail send, calendar).
2. **If all required scopes are present** → mark **Connected**, store the granted `scopes`, start back-fill (5.2a). Done.
3. **If some are missing** → the connection is marked **"Limited — missing permission"** (amber, not green), and we show precisely **what works and what doesn't**, e.g.:
   > "Connected for reading email, but you didn't grant permission to **send**. Sending and logging replies is off until you allow it."
   The affected features degrade gracefully rather than erroring: the composer's Send is disabled with an inline "Grant send permission to enable," and a banner offers **Fix permissions**.
4. **Fix permissions → incremental re-consent.** Clicking **Fix permissions** re-runs OAuth requesting **only the missing scopes** (Google **incremental authorization**, `include_granted_scopes=true`, so the user isn't re-approving what he already gave; Microsoft: re-consent for the missing scope). On return we re-verify (back to step 1). This loops until the grant is complete or the user cancels.
5. **Calendar-only / mail-only is a valid choice, not just an error.** If the user *intends* mail-only (skipped calendar), we don't nag — we mark calendar as "not connected" with a one-click **Add calendar** later. The amber "missing permission" state is only for scopes required by a feature he's trying to use.
6. **Re-check on refresh (scopes can be narrowed after the fact).** Job F7 (token refresh) and Test (5.7 step 4) re-read the granted scopes; if a previously-granted scope disappears (user narrowed it in their Google account, or an admin policy changed), the connection flips to **Limited** and the same Fix-permissions path appears — never a silent stall.

**Defensive points (design-principles §III — never a silent failure).** We never present a half-granted connection as fully Connected. Every feature that needs a scope checks the stored `scopes` before acting and, if missing, shows the specific grant needed with a one-click fix — accept-but-explain, applied to permissions. Microsoft **admin-consent-blocked** (org policy) keeps its existing handling: "ask your IT admin to approve," with the consent URL, never a dead-end.

- **Benchmark (beat this):** **Google — incremental authorization & checking granted scopes** (the model for granular consent + re-consent for just the missing scope) — https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth ; **Attio / Nylas** "reconnect for missing permission" reconnection UX — https://attio.com/help/reference/email-calendar/email-and-calendar-syncing .
- **Build docs:** Google — verify granted scopes (`tokeninfo` / token response `scope`) — https://developers.google.com/identity/protocols/oauth2/web-server ; Microsoft — access-token `scp` claim / incremental consent — https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc . The `OAuthConnection.scopes` field (already in the data model) is now **read** by every scope-gated feature, not just stored.

## Journey 5.10 — Record a meeting with a Recall.ai bot

*As a rep, I want the right meetings recorded, transcribed, and attached to the deal automatically, so that I get call-intelligence on meetings without lifting a finger.*

**Enabling recording is controlled by settings — the enable journey (your ask).** Recording is **off until an admin turns it on.** At **Settings → Recording**, an admin flips a master **"Enable meeting recording"** switch (which surfaces the consent notice and the recording-rules editor, Journey 5.11); each user then has a personal **opt-in** ("Record my meetings"). So there are two gates — the workspace switch and the per-user opt-in — before any bot is scheduled. A rep who hasn't opted in sees an explainer and an opt-in button, not silent recording.

**Which meetings get recorded, and how we find the join URL.** Once recording is enabled and the calendar is connected, we evaluate each event against the **recording rules (Journey 5.11)**. For a matching event we read the **join URL from the event's conferencing field** (the Meet/Teams/Zoom link), falling back to links scanned from the description/location. A meeting with no join link is not recordable.

**What the user sees vs what's behind the scenes (your ask).** The scheduling, joining, uploading, and transcribing all happen in the background (job F5). **The user never sees the internal state table** — that machine is behind the scenes. What the user sees is **one friendly status label on the meeting card**, mapped from the internal states:

| Internal state | Label the user sees |
|---|---|
| scheduled | **Recording scheduled** |
| joining / not_recording | **Joining…** |
| recording | **Recording** |
| processing | **Processing** |
| ready | **Ready** |
| failed | **Couldn't record** (with the reason) |

- **Notifications:** no interruptive notification while in progress (just the live status). On **Ready**, a completion notification (in-app + optional email/Slack): *"Your recording of [meeting] is ready,"* linking to the transcript/summary. On **Couldn't record** / permission-denied, a notification with the reason and a "record manually" fallback.

**The main journey (rewritten in plain sentences, as you asked):**
1. The rep books or receives a meeting with an external contact. On the next calendar sync, the recording rules mark it as a meeting to record, and its card shows **Recording scheduled**.
2. At start time, our bot joins through Recall.ai. The card shows **Joining…**, then **Recording** once it's capturing. The rep does nothing.
3. When the meeting ends, the card shows **Processing** while media uploads and transcribes.
4. When it's done, the card shows **Ready** and the rep gets the completion notification. The recording **attaches to the Deal/People** on the event and appears on their timelines.
5. **Structured extraction runs exactly like a call** — reusing the calling-core **Journey 2.7** templates (model = super-admin-set backend model) — so the meeting gets the same summary and field extraction a call gets. Unknown attendees become People (doc 5a 5.3a, if enabled).

**Ad-hoc / one-off recording — the full journey (your ask).**
1. **Entry point:** a **Record a meeting** button (in the Recordings area and in the composer dock's channel switcher).
2. He **pastes any Zoom/Meet/Teams link** into a small dialog and clicks **Start recording**. No calendar event is needed.
3. A bot is **dispatched immediately**; a **status card appears** in the Recordings area and walks the same labels (Joining… → Recording → Processing → Ready).
4. On **Ready**, he's prompted to **link it to a Deal/Person** (since there was no calendar event to infer from), then it behaves like any recording — transcript, summary, extraction.

**Algorithm & the build-vs-buy question — why we do the calendar→recording linking ourselves (your ask).** We use **Recall.ai for the bot and the recording/transcription** (one API across Zoom/Meet/Teams), but **we do the event selection ourselves** through our recording rules (5.11) rather than handing Recall our whole calendar. The data flow: **F1** syncs the calendar → **our rules (5.11)** decide which events qualify (external only, keyword filters, host conditions) → **F5** schedules a Recall bot only for those events → Recall's **webhooks** drive the state machine → we store the recording + transcript and attach it. **Why do the selection ourselves instead of using Recall's own calendar integration:** control and privacy. We **don't want every event recorded** — internal 1:1s, interviews, personal events must never get a bot — and doing the selection in our own rules engine means the *decision* of what to record lives with us (auditable, consent-aware, keyword-filtered), not delegated to a third party's calendar connection. Recall still does the heavy lifting (joining, media, transcript); we own "should this specific meeting be recorded?"

- **Benchmark (beat this):** Recall.ai — bot status events (lifecycle) — https://docs.recall.ai/docs/bot-status-change-events ; calendar integration FAQ (join-URL) — https://docs.recall.ai/docs/calendar-integration-faq ; Gong — call recording — https://help.gong.io/docs/understanding-call-recording
- **Build docs:** Recall.ai — creating and scheduling bots — https://docs.recall.ai/docs/creating-and-scheduling-bots

## Journey 5.11 — Recording rules (the settings for meeting recording)

*As a user, I want to control exactly which meetings get a bot, so that only the right conversations are recorded.*

This is where the user configures **which meetings get a bot** — the config journey for 5.10. A rules engine evaluates every calendar event at sync time.

1. In **Settings → Recording rules**, he CRUDs rules. **The rule form:**
   - **Scope** — which connected calendar(s) the rule covers.
   - **Meeting type** — `Record external meetings` (**default ON**) and `Record internal meetings` (**default OFF**) — matching Recall's/Gong's posture.
   - **Host condition** — `Only when I'm the host` / `Also when I'm a guest`.
   - **Confirmation filter** — `Only record accepted invites` (default ON).
   - **Recurring** — `Include recurring meetings` (default ON).
   - **Keyword filters** — include/exclude lists matched on the event **title** (exclude "1:1", "interview"; include "demo", "discovery").
   - **Precedence** — exclude beats include; a per-event override beats all rules.
2. **Internal vs external detection:** on sync, compare each attendee's email domain against the workspace **internal-domains allowlist** (Journey 5.2f). Zero external attendees → internal; ≥1 external → external. If attendees change, re-evaluate and reschedule the bot.
3. **Auto-schedule:** a matching event gets a bot scheduled to join at start time (Recall.ai calendar scheduling, job F5).
4. **Per-event override:** each upcoming matched event shows a **Record / Don't record this meeting** toggle. Off cancels the scheduled bot for that one event without touching standing rules; On forces recording for an event the rules skipped.

*Consent: meeting recording follows the same consent posture as calling-core Journey 2.3 — external detection never overrides a consent block.*

- **Benchmark (beat this):** Recall.ai — recording preferences — https://docs.recall.ai/docs/calendar-v1-recording-preferences
- **Build docs:** Recall.ai — schedule bot for a calendar event — https://docs.recall.ai/reference/calendar_events_bot_create

---

## Background jobs (this doc)

- **F1 — Mailbox + calendar sync.** Incremental delta poll (Gmail history / Graph delta / calendar syncToken/delta) + push-triggered off-cycle runs. Trigger/steps/pg-boss in Journey 5.2b.
- **F2 — Match, back-fill, re-match, purge.** The matcher pipeline: `mail-backfill` (5.2a), `mail-rematch` (5.2e), `capture-purge` (5.2f). Auto-create (doc 5a 5.3a) is triggered from here.
- **F5 — Recording pipeline.** **Trigger:** a `RecordingRule` match schedules a bot (5.11); Recall.ai webhooks then drive the lifecycle. **Steps:** schedule bot (setting Recall's **`deduplication_key`** and binding the recording to the **specific event instance** — the matching-hardening in [doc 6a Journey 6a.7](6a-meeting-video-intelligence.md)) → on a **calendar delta that reschedules/cancels the event, reschedule/cancel the bot** (full `bot_config`, no partial) → on each webhook advance `MeetingRecording.state` → on `ready` store recording/transcript and hand to extraction (calling-core Journey 2.7) → attach to the Deal/People via the shared matcher, **holding ambiguous ties for review** rather than guessing. **pg-boss:** `recording-pipeline` queue, `retryLimit: 3`, **idempotent per `(recallBotId, eventType)`** (a bot event can fire twice), verify webhook signatures, `singletonKey = recallBotId` to serialize one bot's events. *(The full downstream meeting-intelligence experience — video player, live assist, extraction review, timeline playback — lives in [doc 6a](6a-meeting-video-intelligence.md).)*
- **F7 — Token refresh + push-subscription renewal.** **Trigger:** a pg-boss cron every ~30 min, plus a pre-expiry scheduled job per connection. **Steps:** refresh OAuth access tokens before expiry; **renew push subscriptions** (Gmail `watch` daily, Graph subscriptions before their ~7-day expiry, Google Calendar channels before expiry); on a revoked/expired refresh token flip `OAuthConnection.status = error` and pause F1. **pg-boss:** `token-refresh` queue, `retryLimit: 5` with backoff, idempotent per `connectionId`.
- **`mailbox-health`** — deliverability checks (Journey 5.4a).

**Monitoring** for all of the above is covered in Journey 5.2 (Monitoring, health, and testing) and doc 12.

## Decisions for you (comms)

**1. Email sync depth?** **Full history back-fill + ongoing sync (my pick)** — every past thread lands on the record, best CRM value. vs forward-only (lighter, records start empty).

**2. Meeting recorder — bot vs native?** **Recall.ai bot for Zoom/Meet/Teams, our own event selection (my pick)** — one API for all three, and we keep control of *which* meetings record. vs native per-platform APIs (three integrations to maintain).

**3. Email composer editor?** **TipTap → sanitized HTML (my pick)** — same editor as notes/signatures, one component everywhere. vs plain-text only (no formatting/images/signatures).

**4. Drafts — internal vs provider?** **Internal draft store, optional provider mirror (my pick)** — fast, provider-neutral, no Drafts-folder clutter; mirror to the mailbox only if the user opts in. vs always writing provider drafts (more API complexity, provider-specific).

## Technology choices (this doc)

Builds on the prior stack (React + Vite SPA + TS API, Postgres+Prisma, Twilio, Deepgram, TipTap).

- **Email + calendar sync — provider APIs directly (Gmail API + Graph), not IMAP.** Gmail `watch` + `history.list` give cheap incremental sync + push; Graph gives delta queries; sends land in the real Sent folder. One internal `MailProvider` interface hides the Google/Microsoft differences (Journey 5.2 "Google vs Microsoft"). IMAP is a fallback only for "other" mailboxes later.
- **Meeting bots — Recall.ai, not native SDKs.** One integration covers Zoom/Meet/Teams and hands audio/transcript into the same extraction path (Journey 2.7). We own the event-selection layer (5.11).
- **Rich-text email + signatures — TipTap serialized to sanitized HTML.** One editor for notes, composer, and signatures. We sanitize on send and on display (inbound HTML is untrusted).
- **OAuth token storage — encrypted at rest, refreshed by F7.** Tokens live in `OAuthConnection` encrypted with a KMS-managed key (envelope encryption), never plaintext or logged. Least-privilege scopes (mail + calendar). Revocation flips the connection to an error state.
- **Deliverability checks — pure DNS + cached provider signals.** SPF/DKIM/DMARC/DNSBL are in-process DNS lookups (`node:dns/promises`, `mailauth`, `dnsbl`); warmup (managed provider API) and Postmaster reputation (OAuth, 24–72h lag) are async/cached (Journey 5.4a).

## Data model (Prisma) — additions in this doc

Extends the cumulative schema. New models marked `// NEW`; `// added` marks new fields on existing models.

```prisma
model Record {
  // ...existing fields, plus:
  campaignId  String?   // added: outreach grouping
}

model Campaign {              // NEW — groups outreach (global edit)
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  status      String  @default("active") // active | paused | archived
  createdAt   DateTime @default(now())
  scripts     Script[]
}

model Script {                // NEW — call/email copy tied to a campaign
  id          String  @id @default(cuid())
  workspaceId String
  campaignId  String
  kind        String  // call | email
  title       String
  bodyJson    Json
}

model MailAccount {           // NEW — a connected mailbox (Journey 5.4)
  id            String  @id @default(cuid())
  workspaceId   String
  provider      String  // google | microsoft
  emailAddress  String
  displayName   String?
  isPrimary     Boolean @default(false)
  syncState     String  @default("synced") // synced | needs_reauth | paused | error
  historyCursor String?        // Gmail historyId / Graph deltaLink URL
  calendarCursor String?       // Google syncToken / Graph delta
  mirrorDrafts  Boolean @default(false) // write drafts to provider too (5.5)
  healthScore   Int?           // deliverability score (5.4a)
  healthJson    Json?          // per-check SPF/DKIM/DMARC/warmup/blacklist results
  connectionId  String         // -> OAuthConnection
}

model Signature {             // NEW — Journey 5.5b
  id            String  @id @default(cuid())
  workspaceId   String
  mailAccountId String
  name          String
  bodyHtml      String
  isDefault     Boolean @default(false)
  aboveReply    Boolean @default(true)
  useDelimiter  Boolean @default(false) // prepend "-- "
}

model EmailMessage {          // NEW — a synced or sent email (Journey 5.2)
  id           String   @id @default(cuid())
  workspaceId  String
  mailAccountId String
  providerMsgId String
  direction    String  // inbound | outbound
  fromAddr     String
  toAddrs      String[]
  ccAddrs      String[]
  subject      String?
  bodyHtml     String?
  threadId     String?
  campaignId   String?
  templateId   String?
  manualAttach Boolean @default(false) // freezes auto-rematch (Gong behavior, 5.2c)
  sentAt       DateTime?
  createdAt    DateTime @default(now())
  @@unique([mailAccountId, providerMsgId])
}

model EmailDraft {            // NEW — internal draft store (Journey 5.5)
  id           String   @id @default(cuid())
  workspaceId  String
  userId       String
  toAddrs      String[]
  ccAddrs      String[]
  bccAddrs     String[]
  subject      String?
  bodyHtml     String?
  mailAccountId String?
  updatedAt    DateTime @updatedAt
}

model EmailTemplate {         // NEW — Journey 5.5 (merge fields)
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  subject     String
  bodyHtml    String  // {{merge_fields}} rendered as chips
  tokensJson  Json?   // static | liquid | spintax | ai (Journey 5.5a)
  campaignId  String?
}

model CalendarEvent {         // NEW — synced or drafted event (Journeys 5.6/5.10)
  id           String   @id @default(cuid())
  workspaceId  String
  providerEvtId String?
  title        String
  startAt      DateTime
  endAt        DateTime
  attendees    Json     // [{email, name, isExternal, response, isOrganizer}]
  isExternal   Boolean  @default(false)
  meetingUrl   String?
  createdAt    DateTime @default(now())
}

model ActivityLink {          // NEW — an activity attached to a CRM record (Journey 5.2c)
  id              String   @id @default(cuid())
  workspaceId     String
  kind            String   // email | event
  emailMessageId  String?
  calendarEventId String?
  activityId      String   // whichever of the two above applies, NOT NULL so the unique holds
  recordId        String   // -> Record (a Person or a Company)
  isPrimary       Boolean  @default(false)  // the one shown first; the rest still get the activity
  manualAttach    Boolean  @default(false)  // a link a person made; the re-matcher never removes it
  createdAt       DateTime @default(now())
  @@unique([kind, activityId, recordId])
}

model UnmatchedActivity {     // NEW — the 30-day hold (Journey 5.2e)
  id             String   @id @default(cuid())
  workspaceId    String
  mailAccountId  String
  kind           String   // email | event
  providerItemId String
  participants   String[] // lower-cased addresses, the only thing a re-match searches
  occurredAt     DateTime
  payload        Json     // enough of the item to store it for real if it matches later
  createdAt      DateTime @default(now())
  @@unique([mailAccountId, kind, providerItemId])
}

model OAuthConnection {       // NEW — Google/Microsoft tokens (Journey 5.7)
  id            String  @id @default(cuid())
  workspaceId   String
  provider      String  // google | microsoft
  scopes        String[]
  accessTokenEnc  String       // encrypted (KMS envelope)
  refreshTokenEnc String
  expiresAt     DateTime
  status        String  @default("connected") // connected | error | revoked
}

model MeetingRecording {      // NEW — Recall.ai output (Journey 5.10)
  id           String   @id @default(cuid())
  workspaceId  String
  eventId      String?         // -> CalendarEvent
  recallBotId  String
  platform     String  // zoom | meet | teams
  state        String  @default("scheduled") // scheduled|joining|recording|not_recording|processing|ready|failed
  storageKey   String?
  transcriptId String?         // reuses Transcript from calling-core
  relatedRecordId String?
  calendarEventInstanceId String? // matching-hardening: bind to the recurring INSTANCE, not the series (doc 6a Journey 6a.7)
  dedupKey     String?         // "{eventInstanceStart}-{meetingUrl}" -> Recall deduplication_key (doc 6a 6a.7)
  matchState   String  @default("auto") // auto | needs_review | manual | failed (doc 6a 6a.7)
  captureFailReason String?    // waiting_room | host_blocked | no_recording | ... (couldn't-record guard, doc 6a 6a.7)
  createdAt    DateTime @default(now())
}

model RecordingRule {         // NEW — Journey 5.11
  id             String   @id @default(cuid())
  workspaceId    String
  recordExternal Boolean  @default(true)
  recordInternal Boolean  @default(false)
  hostOnly       Boolean  @default(false)
  acceptedOnly   Boolean  @default(true)
  includeRecurring Boolean @default(true)
  titleInclude   String[]
  titleExclude   String[]
  isEnabled      Boolean  @default(true)
}

model WorkspaceIntegrationSettings { // NEW — capture + record-creation policy (5.2f/5.3a)
  id              String   @id @default(cuid())
  workspaceId     String   @unique
  recordCreation  String   @default("selective") // all | selective | off (doc 5a 5.3a)
  autoCreateCompanies Boolean @default(true)
  internalDomains String[]
  excludeDomains  String[]
  excludeAddresses String[]
  subjectExcludes String[]
  bulkInboundMax  Int      @default(15)
  logActivityTypes String  @default("both") // email | meetings | both
  backfillMonths  Int      @default(12)     // 3 | 6 | 12
  allowDomains    String[]                  // non-empty = capture ONLY these domains
  excludeRoleAddresses Boolean @default(true) // no-reply@, help@, billing@ and friends
}

// The per-user opt-out from Journey 5.2f's settings table. Its own table rather than a
// column, because it is per PERSON inside a workspace and the settings row is per
// workspace. A ROW MEANS OPTED OUT — no boolean, so there is only one way to say
// "capture me", and deleting the row is opting back in.
model MailCaptureOptOut {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  @@unique([workspaceId, userId])
}
```

## Technical decisions, trade-offs & edge cases

- **OAuth refresh + revocation** (F7, `OAuthConnection`): refresh access tokens ahead of expiry; on a revoked/expired refresh token, flip the connection to `error`, pause F1, show one-click reconnect. Tokens encrypted (KMS envelope), least-privilege, never logged.
- **Gmail history sync + rate limits** (F1): incremental sync uses `history.list` from a stored `historyId`; on a 404 (history expired) fall back to a bounded full re-page; Calendar `syncToken` 410 → full wipe + resync; Graph uses opaque deltaLinks. Respect Gmail quota-unit backoff and Graph 429 `Retry-After`. Queue and throttle outbound sends.
- **Matcher precision over recall** (5.2c): a wrong attach pollutes the CRM, so the matcher tunes for precision (≥98% on fixtures); unknown participants are held, not force-created; manual attaches freeze.
- **Recall.ai webhook handling** (F5): verify signatures, make handlers idempotent (an event can fire twice), handle "could not join" / "no recording" gracefully. Extraction reuses calling-core C2b/C3 so meetings and calls share one summary/extraction path.
- **Consent for recording** carries over from calling-core Journey 2.3: external-meeting detection never overrides a consent block; recording is off until an admin enables it and a user opts in (5.10).
- **User suspended/removed** (5.2): stop syncing immediately, revoke the mailbox token, but **keep** already-logged activities (they belong to the account, not the user); on full removal, offer to reassign to the account owner.
