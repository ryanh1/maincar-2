# Capability Map: Integration Hub

Connect a rep's Google or Microsoft mailbox to Maincar, once, in Settings. After
that the app can **send as them**, **read their mail**, and **read and write their
calendar**, through one internal contract that hides every provider difference.

Reference implementations, both read before this was written:

| Repo | File | What it is good at |
|---|---|---|
| `maincar` | `vite/src/pages/settings/Integrations.tsx` + `_ProviderCard.tsx` | The hub UI. Partial grants shown amber, never green. Recovery blocks keyed to a stable error code. "Verified 2m ago". |
| `maincar` | `server/src/routes/integrations.ts` | Popup consent, incremental re-consent for only the missing scopes, per-capability Test. |
| `maincar` | `server/src/lib/mail/oauthConnections.ts` | One file decrypts a token. `withFreshAccessToken()` is the only way to get one. |
| `loadwire` | `server/src/services/integrationsCrypto.ts` | AES-256-GCM with AAD binding ciphertext to `provider:user`. |
| `loadwire` | `server/src/services/integrationsState.ts` | HMAC-signed stateless OAuth `state` carrying userId/orgId/returnTo with a 10-minute TTL. |
| `loadwire` | `server/src/services/integrationsGoogle.ts` / `…Microsoft.ts` | Per-capability probes, granted-vs-missing scope diffing, `admin_approval_required` detection. |
| `loadwire` | `vite/src/components/integrations/MailboxSettingsDrawer.tsx` | Per-mailbox settings as a deep-linkable drawer. |

## Decisions taken (2026-08-20, Ryan)

1. **Google and Microsoft. No Slack, no Teams.** Loadwire ships both, org-scoped,
   at roughly 1,100 lines of provider service each. maincar-2 has no notification
   feature to post to, so those cards would be connected and inert. Excluded on
   purpose, not forgotten.
2. **Full scopes now: read, send, and calendar.** Wider than
   [SPEC-composer-mailbox.md](SPEC-composer-mailbox.md)'s send-only brief, which
   this map supersedes. Two consequences are accepted, not discovered later:
   - Google **restricted-scope verification** (`gmail.readonly`, `gmail.modify`)
     needs a third-party security assessment and takes weeks. It is submitted in
     `int-oauth`, at the **start**, and is the long pole for production.
   - maincar-2 has **no CRM** — `Person` and `Company` are a proposal in
     [SPEC-CRM-SCHEMA.md](SPEC-CRM-SCHEMA.md), not tables. Captured email and
     meetings have nowhere to attach.
3. **Therefore: this initiative grants and proves capability. It does not build a
   capture pipeline.** `MailProvider` exposes `listMessagesSince`,
   `listEventsSince`, and `createEvent` as real, tested methods against a mocked
   provider. Nothing calls them on a schedule. No "Sync" toggle ships, because a
   toggle with no pipeline behind it is exactly the live-looking control
   [CLAUDE.md](../../CLAUDE.md) forbids. The sync job is a later initiative that
   codes against this seam and needs no change here.
4. **Popup consent, not a full-page redirect.** The rep keeps the page they were
   on. maincar's approach; loadwire redirects and has to reconstruct `returnTo`.

## Module dependencies

| Module id | Responsibility | Depends on | Status |
|---|---|---|---|
| `int-schema` | `OAuthConnection`, `MailAccount`, token encryption, `withFreshAccessToken()` | — | **Foundational** |
| `int-oauth` | Consent URL, signed `state`, callback, scope grant evaluation, partial-grant repair | `int-schema` | **Core** |
| `int-seam` | `MailProvider` — the published interface — plus the Google and Microsoft implementations | `int-schema` | **Core** |
| `int-health` | Per-capability Test, refresh, and the org-wide broken-connection signal | `int-oauth`, `int-seam` | **Core** |
| `int-hub-ui` | Settings → Integrations: one card per provider, status, recovery, connect/fix/test/disconnect | `int-oauth`, `int-health` | **Core** |
| `int-mailboxes` | The mailbox list under each card, the primary mailbox, and the per-mailbox settings drawer | `int-hub-ui` | **Enhancement** |

No cycles. `int-oauth` and `int-seam` share only `int-schema`.

## Build order

**Phase 1 — foundation:** `int-schema`
**Phase 2 — parallel:** `int-oauth` + `int-seam`
**Phase 3:** `int-health`
**Phase 4:** `int-hub-ui`
**Phase 5:** `int-mailboxes`

Phase 4 is the first shippable point: a rep connects a mailbox, sees its real
status, tests it, and disconnects it. Phases 1–3 have no user-facing surface, so
nothing half-wired is visible before then.

## Module scope (one sentence each)

- **int-schema**: A refresh token is stored encrypted, and exactly one function in the codebase can turn it back into a usable access token.
- **int-oauth**: A rep clicks Connect, allows some or all of what Maincar asks for, and the app records honestly which of those it actually got.
- **int-seam**: Every caller sends mail, reads mail, and writes calendar events through one interface and never learns which provider is underneath.
- **int-health**: A rep clicks Test and finds out which specific permission is broken, not that "something" is wrong.
- **int-hub-ui**: A rep sees one card per provider whose colour tells the truth — green only when every permission is there.
- **int-mailboxes**: A rep with two connected addresses picks which one Maincar sends from.

## Key interfaces (module boundaries)

- **int-schema → everything**: `withFreshAccessToken(connectionId)` returns a live
  access token, refreshing transparently. It is the **only** function that decrypts.
  No caller handles a 401 itself.
- **int-oauth → int-hub-ui**: `GET /api/integrations/orgs/:orgId` returns one entry
  per **provider**, not per connection, so the page renders both cards without
  owning the provider list or the copy.
- **int-seam → composer-send**: `getMailProvider(mailAccountId)` returns a
  `MailProvider`, or throws `MailboxNotFoundError`. **This signature is the
  contract with the Email Composer Dock project** and is published in
  [SPEC-composer-mailbox.md](SPEC-composer-mailbox.md).
- **int-health → int-hub-ui**: every failure carries a stable `errorCode` string.
  The client maps that code to recovery steps in `ERROR_CODE_RECOVERY`. A code the
  client does not know falls back to `unknown` and still renders a block.
- **int-oauth → int-mailboxes**: completing consent upserts exactly one
  `MailAccount` per address, on **every** path — first connect, repair, reconnect.
  Doing it in `saveConnection` rather than in the route means no route can forget.

## The one rule that governs all six modules

**A partially-granted connection is never shown as connected.** A rep who allowed
reading but refused sending has a mailbox that works for one thing and not the
other, and the screen says exactly that, in amber, with a one-click repair that
asks for **only** the missing scopes. Green means every permission is present.
That is the only thing green is allowed to mean.

## Assumptions (review before approving)

1. **One shared OAuth app for all orgs**, not per-org client credentials. Per-org
   apps multiply the verification burden with no benefit at this stage.
2. **A mailbox belongs to a rep, not to the org.** Every connection is scoped to
   `(orgId, userId)`. There are no shared or delegated mailboxes in this
   initiative — loadwire has them; they need a visibility model and an approver,
   and that is a separate feature.
3. **Tokens never leave the server.** No route, log line, error message, or test
   snapshot contains one. This is asserted by a test, not assumed.
4. **`provider === 'google'` may appear in `server/src/dependencies/` and
   `server/src/lib/mail/`, and nowhere else in the repo.** A grep proves it.
5. **Verification is a business task with an engineering trigger.** `int-oauth`
   ships the consent flow against an unverified app, which works for up to 100 test
   users. Production needs the assessment finished.
