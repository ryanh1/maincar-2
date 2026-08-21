# Linear Issues: Integration Hub

**Linear project:** `Integration Hub` — **one project, 30 issues + 3 checkpoints**
**Team:** `MAI`
**Tracking label:** `integrations`
**Spec:** [docs/specs/CAPABILITY-MAP-INTEGRATIONS.md](../docs/specs/CAPABILITY-MAP-INTEGRATIONS.md)
**Plan:** [tasks/plan-integrations.md](plan-integrations.md)

Local ids are `IH-n`. Linear assigns the real `MAI-n` keys on import; the mapping
table is at the bottom. Dependencies below are written against the local ids.

Every issue inherits the project-wide Definition of Done: `npm test`,
`npm run typecheck`, and `npm run lint` all pass, and anything user-facing is
walked in a browser in **both themes** ([CLAUDE.md](../CLAUDE.md) → Verification).

---

## PHASE 1 — `int-schema` (IH-1 … IH-4)

### IH-1: Token encryption with AAD binding

**Module:** int-schema · **Phase:** p1-schema · **Points:** 3
**Labels:** backend, security, p1-schema, integrations
**Dependencies:** None

**Description:**
AES-256-GCM encryption for OAuth tokens, in a versioned self-describing format,
with AAD binding each ciphertext to `${provider}:${userId}`. A row copied onto
another user's connection must fail to decrypt even with the master key.

**Acceptance Criteria:**
- [ ] `encryptToken(plaintext, aad)` returns `v1.<iv>.<ciphertext>.<tag>`, all base64url
- [ ] The IV is 12 random bytes per call — never reused, never derived
- [ ] `decryptToken(value, aad)` throws on a wrong AAD, a tampered tag, or an unknown version prefix
- [ ] `TOKEN_ENC_KEY` is read only in `server/src/config.ts`, with `!` and no fallback, and fails fast at startup when missing or not 32 bytes
- [ ] The version prefix carries the comment explaining that rotation adds `v2` rather than migrating

**Verification:**
- [ ] `npm test --workspace server -- tokenCrypto` passes
- [ ] Tests cover: round-trip; **wrong AAD throws**; tampered tag throws; unknown version throws
- [ ] Booting the server with `TOKEN_ENC_KEY` unset fails with a named error, not a stack trace at first use

**Files:** `server/src/lib/tokenCrypto.ts`, `server/src/lib/__tests__/tokenCrypto.test.ts`, `server/src/config.ts`
**Scope:** S · **Spec:** SPEC-int-schema.md § Code style

---

### IH-2: OAuthConnection and MailAccount schema + migration

**Module:** int-schema · **Phase:** p1-schema · **Points:** 3
**Labels:** database, schema, p1-schema, integrations
**Dependencies:** None

**Description:**
The two tables the whole initiative sits on. `OAuthConnection` holds the encrypted
grant and the honest status; `MailAccount` holds the mailbox that grant reaches.

**Acceptance Criteria:**
- [ ] `OAuthConnection` stores: id, orgId, userId, provider, providerAccountId, emailAddress, refreshToken, accessToken?, expiresAt?, scopes[], status, errorCode?, statusDetail?, lastValidatedAt?, lastRefreshAt?, createdAt, updatedAt
- [ ] `MailAccount` stores: id, orgId, userId, connectionId, provider, emailAddress, displayName?, isPrimary, createdAt, updatedAt
- [ ] `@@unique([orgId, userId, provider])` on the connection and `@@unique([orgId, emailAddress])` on the mailbox — reconnecting updates rather than duplicates
- [ ] `MailAccount.connectionId` is `@unique` and cascades from `OAuthConnection`
- [ ] Both cascade from `Org` and from `User`
- [ ] `provider` and `status` are `String` with the allowed values in a comment beside them — **no Prisma enum**
- [ ] The token fields carry the comment saying they are never logged, never returned, and never in a response body

**Verification:**
- [ ] `npm run db:migrate` generates and applies cleanly — no hand-written SQL
- [ ] `npx prisma validate` passes
- [ ] Rolling the migration back and forward leaves no drift
- [ ] Deleting an `Org` removes its connections and mailboxes

**Files:** `server/prisma/schema.prisma`, `server/prisma/migrations/*`
**Scope:** S · **Spec:** SPEC-int-schema.md § Data model

---

### IH-3: oauthConnections.ts — the only file that decrypts

**Module:** int-schema · **Phase:** p1-schema · **Points:** 5
**Labels:** backend, security, p1-schema, integrations
**Dependencies:** IH-1, IH-2

**Description:**
`withFreshAccessToken()` and the connection read/write helpers. This is the single
chokepoint: every token in the app comes from here, and nowhere else calls
`decryptToken`.

**Acceptance Criteria:**
- [ ] `withFreshAccessToken(connectionId)` refreshes when the stored token expires within 60 s, writes the new one back, and returns it
- [ ] **Two concurrent calls for the same connection perform one refresh**, via an in-flight promise map keyed by connection id
- [ ] A refresh failing `invalid_grant` sets `status = 'error'` / `errorCode = 'token_revoked'` and throws
- [ ] An undecryptable token sets `errorCode = 'token_unreadable'` and throws — never treated as absent
- [ ] `serializeConnection(row)` is built from an explicit `select` and has no token field
- [ ] Every query filters on `orgId`; mutations use `updateMany`, never `update({ where: { id } })`
- [ ] The single-flight map carries the comment explaining that a second refresh would invalidate the first caller's brand-new token

**Verification:**
- [ ] `npm test --workspace server -- oauthConnections` passes
- [ ] Tests cover: 30 s-to-expiry refreshes and 10 min does not; `invalid_grant` → `token_revoked`; undecryptable → `token_unreadable`; **two concurrent calls → one refresh**
- [ ] A test asserts `JSON.stringify(serializeConnection(row))` contains **no substring** of either token
- [ ] `grep -rn "decryptToken" server/src` matches only `tokenCrypto.ts` and this file

**Files:** `server/src/lib/mail/oauthConnections.ts`, `server/src/lib/mail/__tests__/oauthConnections.test.ts`
**Scope:** M · **Spec:** SPEC-int-schema.md § Code style

---

### IH-4: mailAccounts.ts — atomic primary, and the typed error set

**Module:** int-schema · **Phase:** p1-schema · **Points:** 2
**Labels:** backend, p1-schema, integrations
**Dependencies:** IH-2

**Description:**
Mailbox upsert and the primary-mailbox move, plus `mailErrors.ts`, the typed error
set every later module throws from.

**Acceptance Criteria:**
- [ ] `upsertMailAccount(connection)` creates or updates exactly one mailbox per address
- [ ] The first mailbox for an `(orgId, userId)` is created with `isPrimary: true`
- [ ] `setPrimaryMailbox(id, orgId, userId)` clears and sets inside **one** `$transaction`
- [ ] The transaction carries the comment explaining that two statements outside one leave a window with zero primaries, during which the composer reads "no mailbox connected"
- [ ] `mailErrors.ts` exports `MailApiError`, `MailboxNotFoundError`, `MailAuthError`, `CursorExpiredError`, `RateLimitedError`, each carrying a stable name

**Verification:**
- [ ] `npm test --workspace server -- mailAccounts` passes
- [ ] Tests cover: first mailbox is primary and second is not; promoting the second leaves **exactly one** primary; upserting the same address twice leaves one row; another org's id returns null rather than throwing a leaky error

**Files:** `server/src/lib/mail/mailAccounts.ts`, `server/src/lib/mail/mailErrors.ts`, `server/src/lib/mail/__tests__/mailAccounts.test.ts`
**Scope:** S · **Spec:** SPEC-int-schema.md § Code style

---

### CHECKPOINT — Foundation (after IH-4)

**Labels:** checkpoint, p1-schema, integrations

- [ ] A token round-trips through encryption, and the wrong-AAD test is green
- [ ] `grep -rn "decryptToken" server/src` matches exactly two files
- [ ] No token appears in any log, response, or test snapshot
- [ ] `npm test && npm run typecheck && npm run lint` pass
- [ ] Specs updated wherever the build diverged from them

---

## PHASE 2a — `int-oauth` (IH-5 … IH-11)

### IH-5: HMAC-signed OAuth state

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 3
**Labels:** backend, security, p2-oauth, integrations
**Dependencies:** None

**Description:**
Stateless CSRF protection that also carries who the consent belongs to across the
OAuth round-trip, so the unauthenticated callback needs no session.

**Acceptance Criteria:**
- [ ] `signState()` returns `<payloadB64url>.<hmacB64url>` over HMAC-SHA256
- [ ] The payload carries provider, userId, orgId, mode, connectionId, nonce, iat, exp
- [ ] TTL is 10 minutes, and expiry is checked **after** the signature, never before
- [ ] The signature is compared with `crypto.timingSafeEqual` on equal-length buffers
- [ ] `verifyState()` returns a discriminated result — `{ ok: true, payload }` or `{ ok: false, reason }` — and never throws
- [ ] `OAUTH_STATE_SECRET` is read only in `config.ts`, must be ≥ 32 chars, and fails fast

**Verification:**
- [ ] `npm test --workspace server -- oauthState` passes
- [ ] Tests cover: round-trip; **one changed payload character fails**; a truncated token fails as `malformed`; an expired token fails as `expired`; a payload missing `orgId` fails as `invalid_payload`

**Files:** `server/src/lib/oauthState.ts`, `server/src/lib/__tests__/oauthState.test.ts`, `server/src/config.ts`
**Scope:** S · **Spec:** SPEC-int-oauth.md § Acceptance criteria 2

---

### IH-6: Scope table and grant evaluation

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 3
**Labels:** backend, p2-oauth, integrations
**Dependencies:** None

**Description:**
The one place that knows which scopes Maincar asks for, what each one means in
plain words, and how to compare what was asked against what was granted. The amber
state comes entirely from this file.

**Acceptance Criteria:**
- [ ] `REQUIRED_SCOPES` lists, per provider, `{ param, label, consequence, capability }` for read, send, and calendar, per the spec's scope table
- [ ] `evaluateGrant(provider, granted)` returns `connected` with no error when every scope is present
- [ ] It returns `limited` / `partial_access` when some are present, and `statusDetail` names the **consequence** in plain words — never the scope string
- [ ] `missingScopeParams(provider, granted)` returns only the missing params, for incremental re-consent
- [ ] `allRequestedScopes(provider)` and `providerLabel(provider)` are exported from here, so no other file owns the copy
- [ ] `evaluateGrant` carries the comment explaining that "gmail.send was not granted" tells a rep nothing they can act on

**Verification:**
- [ ] `npm test --workspace server -- oauthScopes` passes
- [ ] Tests cover: full grant → connected; two of three → limited naming the third's consequence; zero → limited with every consequence named; `missingScopeParams` returns exactly the missing one
- [ ] A test asserts no `statusDetail` string contains a raw scope URL

**Files:** `server/src/lib/oauthScopes.ts`, `server/src/lib/__tests__/oauthScopes.test.ts`
**Scope:** S · **Spec:** SPEC-int-oauth.md § Scopes requested

---

### IH-7: Google and Microsoft OAuth clients, and the one provider registry

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 5
**Labels:** backend, integration, p2-oauth, integrations
**Dependencies:** IH-6

**Description:**
Both providers' OAuth halves, each wrapped in one file under `dependencies/`, plus
`oauthProviders.ts` — the single registry that maps a provider string to a client.
There is never a second registry.

**Acceptance Criteria:**
- [ ] `OAuthClient` in `oauthTypes.ts` declares `buildAuthorizeUrl`, `exchangeCode`, `refreshAccessToken`, `fetchIdentity`
- [ ] `googleOAuth.ts` and `microsoftOAuth.ts` each implement it, and each constructs its own HTTP client **inside the file** — no SDK is built in a route
- [ ] PKCE `S256` on both: `buildAuthorizeUrl` takes a `codeChallenge`, `exchangeCode` takes the verifier
- [ ] Google sets `access_type=offline` and `prompt=consent`, with the comment saying Google returns a refresh token only when consent is forced
- [ ] Microsoft targets the `organizations` tenant, with the comment recording that personal accounts are out of scope
- [ ] `exchangeCode` returns the **granted** scopes as the provider reported them, never the requested ones
- [ ] `oauthProviders.ts` exports `PROVIDERS`, `isProvider(value)`, and `oauthClientFor(provider)`
- [ ] The six OAuth env vars are read only in `config.ts`, with `!` and no fallbacks, and are in `.env.example`

**Verification:**
- [ ] `npm test --workspace server -- oauthProviders` passes
- [ ] Tests cover: the authorize URL carries the challenge, method, state, and every requested scope; `exchangeCode` returns granted scopes; a provider string not in `PROVIDERS` fails `isProvider`
- [ ] Provider HTTP is mocked — **no test reaches Google or Microsoft**
- [ ] `grep -rn "googleapis\|graph.microsoft" server/src --include=*.ts` matches only files under `dependencies/`

**Files:** `server/src/dependencies/googleOAuth.ts`, `server/src/dependencies/microsoftOAuth.ts`, `server/src/dependencies/oauthTypes.ts`, `server/src/lib/mail/oauthProviders.ts`, `server/src/config.ts`, `.env.example`
**Scope:** M · **Spec:** SPEC-int-oauth.md § Project structure

---

### IH-8: The error-code table

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 2
**Labels:** backend, p2-oauth, integrations
**Dependencies:** None

**Description:**
One table of stable error codes, and the mapper from a provider's own error onto
it. The client keys its recovery steps off these strings, so they are an API and
they do not change casually.

**Acceptance Criteria:**
- [ ] `INTEGRATION_ERROR_CODES` includes at least: `partial_access`, `token_revoked`, `missing_refresh_token`, `admin_approval_required`, `user_cancelled`, `state_invalid`, `token_exchange_failed`, `identity_fetch_failed`, `token_unreadable`, `provider_unreachable`, `redirect_uri_mismatch`, `client_secret_invalid`, `unknown`
- [ ] `mapProviderError(provider, raw)` returns a code from that set and never a provider string
- [ ] Microsoft `AADSTS65001` and Google `admin_policy_enforced` both map to `admin_approval_required`
- [ ] An unmapped error maps to `unknown` **and is logged with the raw code**, so the table can grow from real traffic
- [ ] The file carries the comment saying these strings are an API the client keys off

**Verification:**
- [ ] `npm test --workspace server -- integrationErrors` passes
- [ ] Tests cover: `AADSTS65001` → `admin_approval_required`; `access_denied` → `user_cancelled`; an invented error → `unknown` and one log line
- [ ] A test asserts every code in the table is a lowercase snake_case string with no provider name in it

**Files:** `server/src/lib/mail/integrationErrors.ts`, `server/src/lib/mail/__tests__/integrationErrors.test.ts`
**Scope:** XS · **Spec:** SPEC-int-oauth.md § Acceptance criteria 10

---

### IH-9: Authorize and list routes

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 5
**Labels:** backend, api, p2-oauth, integrations
**Dependencies:** IH-3, IH-5, IH-6, IH-7

**Description:**
The two authenticated routes the hub page reads and clicks. `GET` returns one entry
per **provider**, not per connection, so the client never owns the provider list.

**Acceptance Criteria:**
- [ ] `POST /api/integrations/orgs/:orgId/:provider/authorize` takes `{ mode, connectionId? }` and returns `{ url }` — it never redirects
- [ ] An unknown `:provider` is 404, checked with `isProvider()` and never trusted as a bare string
- [ ] `mode: 'fix'` requests **only** the missing scopes and sets `login_hint` to the existing address
- [ ] `mode: 'fix'` with a `connectionId` from another rep is 404
- [ ] `GET /api/integrations/orgs/:orgId` returns `{ integrations: [...] }` with one entry per provider, each carrying `provider`, `providerLabel`, `requiredPermissions`, and `connection` — `null` when nothing is connected
- [ ] Both routes re-prove org membership **from the path**, never from an inferred tenant
- [ ] Handlers are wrapped in `wrapRoute()` and carry the house section comments
- [ ] The route file's header comment records why these are `/orgs/:orgId/…` while the callback is not

**Verification:**
- [ ] `npm test --workspace server -- integrations` passes
- [ ] Tests cover: authorize returns a URL carrying state and scopes; unknown provider → 404; fix requests one scope; another rep's connectionId → 404; list returns two entries with one `connection: null`; a non-member of `:orgId` → 403
- [ ] A test asserts no response body contains a token or an authorization code

**Files:** `server/src/routes/integrations.ts`, `server/src/routes/__tests__/integrations.test.ts`, `server/src/app.ts`
**Scope:** M · **Spec:** SPEC-int-oauth.md § API

---

### IH-10: The OAuth callback

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 5
**Labels:** backend, api, security, p2-oauth, integrations
**Dependencies:** IH-4, IH-8, IH-9

**Description:**
Where the provider sends the rep back. The only unauthenticated route in the
module, and the place the grant is evaluated honestly and written down.

**Acceptance Criteria:**
- [ ] `GET /api/integrations/:provider/callback` verifies the signed `state` **before reading a single field from it**
- [ ] It exchanges the code, fetches the identity, evaluates the grant with `evaluateGrant`, and writes `status`, `errorCode`, `statusDetail`, and the **granted** scopes
- [ ] **Google returning no refresh token writes `error` / `missing_refresh_token`**, never `connected`
- [ ] Re-consent for an existing address updates that row — one connection and one mailbox afterwards, on every path
- [ ] `saveConnection` calls `upsertMailAccount` itself, so no route can forget it
- [ ] The response is an HTML page that `postMessage`s the result to `window.opener` **targeted at the app's own origin**, never `*`, then closes
- [ ] Provider-supplied text is JSON-encoded with `<` escaped, and the visible heading is HTML-escaped
- [ ] The error path writes the same row shape as the success path, so a failed repair cannot leave the row reading green from the previous attempt
- [ ] The route's comment records that it is unauthenticated by necessity and carries no secret

**Verification:**
- [ ] `npm test --workspace server -- integrations` passes
- [ ] Tests cover: full grant → connected; two of three → limited/`partial_access` with the consequence named; **no refresh token → `missing_refresh_token`**; second consent leaves one connection and one mailbox; a tampered state → `state_invalid` and no row written; `AADSTS65001` → `admin_approval_required`; a state naming another org does not write into this org
- [ ] A test renders the callback page with an error containing `</script>` and asserts it is escaped
- [ ] **Manual:** connect a real Google account in the browser, refuse the send permission, and confirm the row is `limited`

**Files:** `server/src/routes/integrations.ts`, `server/src/lib/mail/oauthConnections.ts`, `server/src/routes/__tests__/integrations.test.ts`
**Scope:** M · **Spec:** SPEC-int-oauth.md § Acceptance criteria 4–11

---

### IH-11: Submit Google restricted-scope verification

**Module:** int-oauth · **Phase:** p2-oauth · **Points:** 1
**Labels:** ops, blocked-external, p2-oauth, integrations
**Dependencies:** IH-7

**Description:**
`gmail.readonly` and `gmail.modify` are **restricted** scopes. Google requires a
verified app and a third-party security assessment, and the review runs for weeks.
This ticket is scheduled here because it is the only task in the initiative whose
duration nobody on this team controls. **It ships no code.**

**Acceptance Criteria:**
- [ ] The OAuth consent screen is configured: app name, support email, logo, homepage, privacy policy, and terms
- [ ] Every requested scope is listed with a written justification
- [ ] A demo video showing each scope in use is recorded and attached
- [ ] Verification is **submitted**, and the submission id or ticket link is recorded in this issue
- [ ] Up to 100 test users are added so development continues while review runs
- [ ] Microsoft's admin-consent URL for tenants that require it is documented in the same place

**Verification:**
- [ ] A test user not on the allow-list sees Google's unverified-app screen, and the "Before you connect" copy in IH-23 matches what they actually see
- [ ] The submission confirmation is linked in the issue

**Files:** none — external
**Scope:** XS · **Spec:** SPEC-int-oauth.md § Scopes requested

---

## PHASE 2b — `int-seam` (IH-12 … IH-17)

### IH-12: MailProvider — the published interface

**Module:** int-seam · **Phase:** p2-seam · **Points:** 3
**Labels:** backend, architecture, p2-seam, integrations
**Dependencies:** None

**Description:**
The seam. Five methods and the types crossing them. This is the contract the Email
Composer Dock project codes against, so the signatures are published: they get
added to, never renamed.

**Acceptance Criteria:**
- [ ] `MailProvider` declares `sendEmail`, `listMessagesSince`, `getMessage`, `listEventsSince`, `createEvent`, and a readonly `provider`
- [ ] `MailAddress`, `OutboundEmail`, `SentEmail`, `InboundMessage`, `CalendarEvent` are exported exactly as the spec writes them
- [ ] `SentEmail.sentAt` is documented as **the provider's** timestamp, never one computed locally
- [ ] `listMessagesSince` and `listEventsSince` are cursor-based and return `{ …, nextCursor }` — never offset-based
- [ ] Every `Date` crossing the seam is UTC, and the file says so
- [ ] The header comment names this as the contract with the composer project and links `SPEC-composer-mailbox.md`
- [ ] The file has **no implementation and no import of any provider SDK**

**Verification:**
- [ ] `npm run typecheck` passes
- [ ] A type-level test asserts a stub object satisfying `MailProvider` compiles
- [ ] `grep -n "google\|microsoft\|graph" server/src/lib/mail/MailProvider.ts` matches only the `provider` union and comments

**Files:** `server/src/lib/mail/MailProvider.ts`
**Scope:** S · **Spec:** SPEC-int-seam.md § The seam

---

### IH-13: Gmail and Graph SDK wrappers

**Module:** int-seam · **Phase:** p2-seam · **Points:** 3
**Labels:** backend, integration, p2-seam, integrations
**Dependencies:** None

**Description:**
One file per provider under `dependencies/`, each constructing its own SDK client
and exposing the raw calls the implementations need. Swapping a provider must touch
one file.

**Acceptance Criteria:**
- [ ] `gmail.ts` wraps `googleapis` and `graph.ts` wraps `@microsoft/microsoft-graph-client`
- [ ] Each takes an access token and returns a thin client — **neither reads config or the database**
- [ ] Base URLs, default headers, and client construction live inside these two files
- [ ] Both surface the provider's HTTP status and error body to the caller unchanged, so IH-15 and IH-16 can map them
- [ ] Neither file imports Prisma

**Verification:**
- [ ] `npm test --workspace server -- dependencies` passes with the HTTP layer mocked
- [ ] Tests cover: a 401 surfaces as a 401; a 429 surfaces with its `Retry-After`
- [ ] `grep -rn "from 'googleapis'\|microsoft-graph-client" server/src` matches only these two files

**Files:** `server/src/dependencies/gmail.ts`, `server/src/dependencies/graph.ts`, `server/src/dependencies/__tests__/`
**Scope:** S · **Spec:** SPEC-int-seam.md § Project structure

---

### IH-14: The shared contract test suite

**Module:** int-seam · **Phase:** p2-seam · **Points:** 5
**Labels:** testing, architecture, p2-seam, integrations
**Dependencies:** IH-12

**Description:**
One file of tests, written against the interface and run twice — once per
implementation. **This lands before either implementation**, so the suite describes
the seam rather than describing whichever provider was built first.

**Acceptance Criteria:**
- [ ] `mailProviderContract(name, makeProvider)` is exported and callable from any implementation's test file
- [ ] It covers: `sendEmail` returns the provider's ids and **its** timestamp; bcc is in the envelope and not a visible header; `listMessagesSince(null, 10)` returns oldest-first with a cursor; **replaying that cursor returns the next page, not the same one**; an expired cursor throws `CursorExpiredError`; a 401 after a fresh token throws `MailAuthError` and does not retry; a 429 throws `RateLimitedError` carrying `retryAfterMs`; `createEvent` round-trips title, start, end, attendees; every returned `Date` is UTC; a malformed payload throws `MailApiError` and never a `TypeError`
- [ ] The suite imports **no provider SDK** and knows no provider name
- [ ] The file's header says a test that passes for one provider and fails for the other is the seam leaking

**Verification:**
- [ ] The suite runs green against an in-memory fake provider committed alongside it
- [ ] `npm run typecheck` passes

**Files:** `server/src/lib/mail/__tests__/mailProvider.contract.ts`
**Scope:** M · **Spec:** SPEC-int-seam.md § Testing strategy

---

### IH-15: googleMail — the Gmail and Google Calendar implementation

**Module:** int-seam · **Phase:** p2-seam · **Points:** 5
**Labels:** backend, integration, p2-seam, integrations
**Dependencies:** IH-3, IH-13, IH-14

**Description:**
Gmail and Google Calendar behind `MailProvider`, passing the shared suite
unmodified.

**Acceptance Criteria:**
- [ ] All five methods implemented, and `mailProviderContract` passes against them
- [ ] Every call goes through `withFreshAccessToken()` — **the file handles no 401 itself**; a 401 after a fresh token throws `MailAuthError`
- [ ] Every provider response is parsed with `zod` before it is trusted, and a parse failure throws `MailApiError` with a readable message
- [ ] `listMessagesSince` uses `history.list` as the delta cursor, with the comment saying it maps onto Graph's `deltaLink` so both providers share one cursor concept
- [ ] `sendEmail` builds a base64url RFC 822 message that decodes cleanly
- [ ] Errors map through `mailErrors.ts` — a caller never catches a Google error type
- [ ] No message body is ever logged

**Verification:**
- [ ] `npm test --workspace server -- googleMail` passes, running the shared suite
- [ ] Extra tests cover: the raw message decodes to valid RFC 822 with the right headers; an expired `historyId` throws `CursorExpiredError`
- [ ] Provider HTTP is mocked — **no test reaches Google**

**Files:** `server/src/lib/mail/googleMail.ts`, `server/src/lib/mail/__tests__/googleMail.test.ts`
**Scope:** M · **Spec:** SPEC-int-seam.md § Code style

---

### IH-16: microsoftMail — the Graph mail and calendar implementation

**Module:** int-seam · **Phase:** p2-seam · **Points:** 5
**Labels:** backend, integration, p2-seam, integrations
**Dependencies:** IH-3, IH-13, IH-14

**Description:**
Microsoft Graph behind the same `MailProvider`, passing the same suite. Buildable
in parallel with IH-15 — the two share no file.

**Acceptance Criteria:**
- [ ] All five methods implemented, and `mailProviderContract` passes against them
- [ ] Every call goes through `withFreshAccessToken()`; a 401 after a fresh token throws `MailAuthError`
- [ ] Every response is `zod`-parsed before it is trusted
- [ ] `listMessagesSince` stores Graph's `@odata.deltaLink` as the cursor and replays it correctly
- [ ] Errors map through `mailErrors.ts`
- [ ] No message body is ever logged

**Verification:**
- [ ] `npm test --workspace server -- microsoftMail` passes, running the shared suite
- [ ] Extra tests cover: a `deltaLink` round-trips as a cursor; an invalidated delta token throws `CursorExpiredError`
- [ ] Provider HTTP is mocked — **no test reaches Microsoft**

**Files:** `server/src/lib/mail/microsoftMail.ts`, `server/src/lib/mail/__tests__/microsoftMail.test.ts`
**Scope:** M · **Spec:** SPEC-int-seam.md § Code style

---

### IH-17: getMailProvider — the factory, and the only switch on provider

**Module:** int-seam · **Phase:** p2-seam · **Points:** 3
**Labels:** backend, architecture, p2-seam, integrations
**Dependencies:** IH-15, IH-16

**Description:**
`getMailProvider(mailAccountId, orgId)`. **This is what unblocks `composer-send`.**
It is also the one place in the repo that branches on which provider a mailbox is.

**Acceptance Criteria:**
- [ ] `getMailProvider(mailAccountId, orgId)` returns a `MailProvider` or throws `MailboxNotFoundError`
- [ ] The lookup is scoped to `orgId` — a mailbox id from another org throws `MailboxNotFoundError`, not a leak
- [ ] The `switch` carries the comment saying a provider string in the database with no implementation is a bug in `int-oauth`, not a runtime condition to degrade around
- [ ] The Email Composer Dock issue for `composer-send` is linked from here

**Verification:**
- [ ] `npm test --workspace server -- getMailProvider` passes
- [ ] Tests cover: a Google mailbox returns a provider whose `sendEmail` works against the mock; a Microsoft mailbox likewise; a deleted mailbox throws `MailboxNotFoundError`; another org's mailbox throws the same
- [ ] **`grep -rn "provider === 'google'" server/src vite/src` matches only files under `server/src/dependencies/` and `server/src/lib/mail/`**

**Files:** `server/src/lib/mail/getMailProvider.ts`, `server/src/lib/mail/__tests__/getMailProvider.test.ts`
**Scope:** S · **Spec:** SPEC-int-seam.md § Code style

---

### CHECKPOINT — The seam is real (after IH-17)

**Labels:** checkpoint, p2-seam, integrations

- [ ] The shared contract suite passes against **both** implementations
- [ ] `grep -rn "provider === 'google'" server/src vite/src` matches only `dependencies/` and `lib/mail/`
- [ ] A rep can complete consent against a real Google account and the row reads honestly
- [ ] Google verification is submitted, with the link recorded on IH-11
- [ ] `npm test && npm run typecheck && npm run lint` pass
- [ ] Specs updated wherever the build diverged from them

---

## PHASE 3 — `int-health` (IH-18 … IH-20)

### IH-18: Per-capability connection probes

**Module:** int-health · **Phase:** p3-health · **Points:** 5
**Labels:** backend, p3-health, integrations
**Dependencies:** IH-17

**Description:**
`testConnection()` — three independent, read-only probes returning a verdict per
capability. A rep must learn **which** permission is broken, not that something is.

**Acceptance Criteria:**
- [ ] Returns `CapabilityResult[]` for `read_email`, `send_email`, and `calendar` — never a single boolean
- [ ] `label` is the **same** plain-words string `REQUIRED_SCOPES` gives the card, so the Test result and the card use one wording
- [ ] Probes are read-only: **nothing sends an email and nothing creates an event**
- [ ] `send_email` is judged from the granted scope plus a live identity call, and its `reason` says the permission is missing — never that a test message failed, because none was sent
- [ ] Each probe is independent, so one failure does not hide the other two verdicts
- [ ] A probe past 10 s returns `provider_unreachable`
- [ ] The `Promise.all` carries the comment explaining that one try/catch around all three would hide two verdicts

**Verification:**
- [ ] `npm test --workspace server -- connectionTest` passes
- [ ] Tests cover: a full grant → three green; **missing `gmail.send` → read and calendar green, send red**; a hanging provider → `provider_unreachable`; a revoked token → `token_revoked` without throwing
- [ ] A test asserts the mocked provider's `sendEmail` and `createEvent` were **never called**

**Files:** `server/src/lib/mail/connectionTest.ts`, `server/src/lib/mail/__tests__/connectionTest.test.ts`
**Scope:** M · **Spec:** SPEC-int-health.md § The probes

---

### IH-19: Test and refresh routes

**Module:** int-health · **Phase:** p3-health · **Points:** 3
**Labels:** backend, api, p3-health, integrations
**Dependencies:** IH-9, IH-18

**Description:**
The two buttons on a connected card. Test is a **repair of the record**, not just a
read: what it finds gets written back.

**Acceptance Criteria:**
- [ ] `POST …/:connectionId/test` returns `{ result: { ok, detail, errorCode, capabilities, connection } }`
- [ ] It writes the verdict back to the row — status, `errorCode`, `statusDetail`
- [ ] **`lastValidatedAt` is set only on success.** A failed Test must not refresh it, or the freshest-looking connection becomes the broken one
- [ ] A broken integration returns **200 with `ok: false`**, never a 500 — it is an expected state
- [ ] `POST …/:connectionId/refresh` re-reads granted scopes with no consent screen and re-evaluates status
- [ ] Both are scoped to `(orgId, userId)`; another rep's `connectionId` is 404

**Verification:**
- [ ] `npm test --workspace server -- integrations` passes
- [ ] Tests cover: success sets `lastValidatedAt`; **failure does not**; a revoked token → 200 with `ok: false` and `token_revoked` on the row; refresh moves `limited` → `connected` once the admin grants the scope; another rep's id → 404
- [ ] A test asserts neither response contains a token

**Files:** `server/src/routes/integrations.ts`, `server/src/routes/__tests__/integrations.test.ts`
**Scope:** S · **Spec:** SPEC-int-health.md § API

---

### IH-20: The broken-connection signal

**Module:** int-health · **Phase:** p3-health · **Points:** 3
**Labels:** backend, api, p3-health, integrations
**Dependencies:** IH-19

**Description:**
`GET …/health` — what the app-wide badge counts. It must mean "something you rely
on has stopped working", or reps learn to ignore it and it stops working as a
signal.

**Acceptance Criteria:**
- [ ] Returns `{ broken: BrokenConnection[] }` with `connectionId`, `provider`, `providerLabel`, `emailAddress`, `errorCode`, `detail`
- [ ] **Returns only connections in `error`.** A `limited` connection is never in it — that may be a deliberate choice by the rep
- [ ] Scoped to `(orgId, userId)`; another org's broken connection never appears
- [ ] Ordered newest-broken first
- [ ] The route's comment records why `limited` is excluded

**Verification:**
- [ ] `npm test --workspace server -- integrations` passes
- [ ] Tests cover: an `error` connection appears; **a `limited` connection does not**; a `connected` one does not; org A's response omits org B's broken row; an empty list is `{ broken: [] }` and not a 404

**Files:** `server/src/lib/mail/connectionHealth.ts`, `server/src/routes/integrations.ts`, `server/src/routes/__tests__/integrations.test.ts`
**Scope:** S · **Spec:** SPEC-int-health.md § Acceptance criteria 7

---

## PHASE 4 — `int-hub-ui` (IH-21 … IH-26)

### IH-21: Client types, recovery table, and query keys

**Module:** int-hub-ui · **Phase:** p4-ui · **Points:** 3
**Labels:** frontend, p4-ui, integrations
**Dependencies:** IH-9

**Description:**
The shapes the hub reads, and the two copy tables that turn a stable error code
into something a rep can act on.

**Acceptance Criteria:**
- [ ] `integrationTypes.ts` mirrors the server: `IntegrationCard`, `IntegrationConnection`, `CapabilityResult`, `TestConnectionResponse`, `BrokenConnection`
- [ ] `ERROR_CODE_RECOVERY` has an entry for **every** code IH-8 defines, each `{ title, fixes: string[] }`, and every `fixes` entry ends in something the rep can click or ask for
- [ ] It includes an `unknown` entry, so a code the client has never seen still renders a block
- [ ] `PRE_CONNECT_NOTES` carries the Google unverified-app note, the Google admin-block note, and the Microsoft admin-approval note
- [ ] `queryKeys.integrations` is added with `all(orgId)`, `list(orgId)`, `health(orgId)` — keyed by org like `orgs.members`
- [ ] Every string obeys `rules/copy.md`: one sentence, names the next action, "organization" never "workspace"
- [ ] `isOAuthPopupMessage()` narrows an unknown `MessageEvent.data`

**Verification:**
- [ ] `npm run typecheck` passes
- [ ] A test asserts every code in `INTEGRATION_ERROR_CODES` has an `ERROR_CODE_RECOVERY` entry — the two tables cannot drift
- [ ] A test asserts no recovery `fixes` array is empty

**Files:** `vite/src/lib/integrationTypes.ts`, `vite/src/lib/queryKeys.ts`, `vite/src/lib/__tests__/integrationTypes.test.ts`
**Scope:** S · **Spec:** SPEC-int-hub-ui.md § Project structure

---

### IH-22: The integrations hook barrel

**Module:** int-hub-ui · **Phase:** p4-ui · **Points:** 3
**Labels:** frontend, p4-ui, integrations
**Dependencies:** IH-19, IH-20, IH-21

**Description:**
Six hooks, one per file, re-exported from `index.ts` so a component imports from
`@/hooks/integrations` and never from a path inside it.

**Acceptance Criteria:**
- [ ] `useGetIntegrations`, `useGetIntegrationHealth`, `useConnectIntegration`, `useTestIntegration`, `useRefreshIntegration`, `useDisconnectIntegration` — one per file
- [ ] Every call goes through `jsonFetch` from `@/lib/api`, never a bare `fetch`
- [ ] Every key comes from `queryKeys`, never an inline array
- [ ] Each mutation invalidates `queryKeys.integrations.all(orgId)` on settle
- [ ] Each hook is under ~100 LOC
- [ ] `index.ts` re-exports all six plus the types

**Verification:**
- [ ] `npm test --workspace vite -- hooks/integrations` passes
- [ ] Tests cover: the read hook returns the mapped list; a mutation invalidates the right key; a 4xx surfaces the server's message and a 5xx surfaces the generic one
- [ ] `grep -rn "hooks/integrations/use" vite/src/pages` returns nothing — every import is from the barrel

**Files:** `vite/src/hooks/integrations/*.ts`
**Scope:** S · **Spec:** SPEC-int-hub-ui.md § Project structure

---

### IH-23: The provider card

**Module:** int-hub-ui · **Phase:** p4-ui · **Points:** 5
**Labels:** frontend, ui, p4-ui, integrations
**Dependencies:** IH-21

**Description:**
One card per provider, and the whole point of the initiative: **a partially-granted
connection is amber and says so.** It is never green, and it is never a red error
either, because reading-without-sending is a legitimate choice.

**Acceptance Criteria:**
- [ ] Three statuses, each carrying an **icon and a word** as well as a colour: Connected (green, check) · Limited — missing permission (amber, triangle) · Reconnect needed (red, alert)
- [ ] A connected card shows the address and "Verified 2m ago" from `lastValidatedAt`, and **shows no timestamp at all** when it is null
- [ ] Granted permissions list with a check; missing ones with a triangle and "— not allowed"
- [ ] Any card that is not fully healthy renders a **recovery block** with a title and steps, from `ERROR_CODE_RECOVERY`, falling back to `unknown`
- [ ] A not-connected card carries a collapsed "Before you connect" disclosure from `PRE_CONNECT_NOTES`
- [ ] **One primary action per card:** Connect · Fix permissions · Reconnect · Test, by status. Everything else is secondary
- [ ] Disconnect is `destructive` behind an `AlertDialog` naming the address and what stops working
- [ ] A Test result lists every capability with the failure named — never a bare "Test failed"
- [ ] The header comment records that green means every permission, and nothing else
- [ ] Icons are decorative `aria-hidden`; the status word is the accessible name

**Verification:**
- [ ] `npm test --workspace vite -- ProviderCard` passes
- [ ] Tests cover: `connection: null` → "Not connected" and one Connect; connected → green with "Verified"; **limited → amber, names the missing permission, primary button reads "Fix permissions"**; error → red with Reconnect; **an unrecognised `errorCode` still renders a recovery block**; a Test with one failed capability lists all three; the disclosure is collapsed by default
- [ ] No test asserts on colour alone — each asserts the word or the icon
- [ ] Manual: both themes

**Files:** `vite/src/pages/Settings_Integrations_ProviderCard.tsx`, `Settings_Integrations_ProviderMark.tsx`, `Settings_Integrations_ProviderCard.test.tsx`
**Scope:** M · **Spec:** SPEC-int-hub-ui.md § Acceptance criteria 3–12

---

### IH-24: The Integrations tab and the popup consent flow

**Module:** int-hub-ui · **Phase:** p4-ui · **Points:** 5
**Labels:** frontend, ui, p4-ui, integrations
**Dependencies:** IH-22, IH-23

**Description:**
The pane, wired into Settings, and the popup dance. The rep keeps the page they
were on while they consent.

**Acceptance Criteria:**
- [ ] Settings gains an **Integrations** tab, hidden for a user with no org, exactly as Organization and Members already are
- [ ] The window is opened **synchronously inside the click** and its URL set after the server answers — with the comment saying opening it after an `await` is what pop-up blockers stop
- [ ] A blocked popup shows "Allow pop-ups for this site, then click Connect again." and leaves no spinner running
- [ ] A `message` event is trusted only from the app's own origin
- [ ] A 500 ms poll detects the rep closing the popup by hand, clears the busy state, and refetches — with the comment saying the card would otherwise spin forever
- [ ] Success and failure both refetch and toast; the failure toast carries the server's words
- [ ] Loading renders a **skeleton**, not a spinner on an empty page; an error renders the server's message with a retry
- [ ] The listener and the interval are both cleaned up on unmount

**Verification:**
- [ ] `npm test --workspace vite -- IntegrationsTab` passes
- [ ] Tests cover: a blocked popup toasts and sets no busy state; a foreign-origin message is ignored; a same-origin success message refetches and toasts; closing the popup clears busy; loading renders the skeleton; unmount removes the listener
- [ ] **Manual, in a real browser:** connect Google, refuse one permission, see amber, click Fix permissions, land green. Both themes

**Files:** `vite/src/pages/Settings_IntegrationsTab.tsx`, `Settings_IntegrationsTab.test.tsx`, `vite/src/pages/Settings.tsx`
**Scope:** M · **Spec:** SPEC-int-hub-ui.md § Code style

---

### IH-25: Disconnect

**Module:** int-hub-ui · **Phase:** p4-ui · **Points:** 2
**Labels:** backend, frontend, p4-ui, integrations
**Dependencies:** IH-24

**Description:**
The route behind the Disconnect button, and the cascade that means a mailbox never
outlives the grant it depends on.

**Acceptance Criteria:**
- [ ] `DELETE /api/integrations/orgs/:orgId/:connectionId` deletes the connection with `deleteMany({ where: { id, orgId, userId } })`
- [ ] The `MailAccount` goes with it, by cascade
- [ ] If the deleted mailbox was primary, the newest remaining mailbox is promoted **in the same transaction**
- [ ] Another rep's `connectionId` is 404 and deletes nothing
- [ ] Nothing is deleted until the `AlertDialog` is confirmed
- [ ] The route logs `{ orgId, userId, provider }` and no token

**Verification:**
- [ ] `npm test --workspace server -- integrations` and `npm test --workspace vite -- ProviderCard` pass
- [ ] Tests cover: delete removes the connection and its mailbox; deleting the primary promotes the newest remaining one; another rep's id → 404 and the row survives; the client sends no DELETE until confirmed
- [ ] Manual: disconnect, and the card returns to "Not connected"

**Files:** `server/src/routes/integrations.ts`, `server/src/routes/__tests__/integrations.test.ts`, `vite/src/hooks/integrations/useDisconnectIntegration.ts`
**Scope:** XS · **Spec:** SPEC-int-hub-ui.md § Acceptance criteria 11

---

### IH-26: The broken-connection badge in the sidebar

**Module:** int-hub-ui · **Phase:** p4-ui · **Points:** 3
**Labels:** frontend, ui, p4-ui, integrations
**Dependencies:** IH-22

**Description:**
A rep who is not on the Settings page is exactly the rep who needs telling. The
badge counts only genuinely broken connections, so it stays worth looking at.

**Acceptance Criteria:**
- [ ] `Sidebar.tsx` shows a count beside Settings when `health.broken.length > 0`, and **nothing at all** when it is zero
- [ ] Clicking it goes to the Integrations tab
- [ ] The count is `error` connections only — a `limited` one never raises it
- [ ] The badge has an accessible label naming what is wrong, not a bare number
- [ ] The query is disabled when there is no active org
- [ ] Polling is no more often than 60 s, or on window focus only

**Verification:**
- [ ] `npm test --workspace vite -- Sidebar` passes
- [ ] Tests cover: one broken → badge reads 1; **`limited` only → no badge**; zero → no badge; no org → the query never fires; the badge's accessible name names the problem
- [ ] Manual: both themes

**Files:** `vite/src/components/Sidebar.tsx`, `vite/src/components/__tests__/Sidebar.test.tsx`
**Scope:** S · **Spec:** SPEC-int-hub-ui.md § Open questions 1

---

### CHECKPOINT — First shippable (after IH-26)

**Labels:** checkpoint, p4-ui, integrations

- [ ] A rep connects a mailbox, sees its honest status, tests it, and disconnects it — walked in a browser, **both themes**
- [ ] A partially-granted connection is amber, names the missing permission, and one click asks for only that one
- [ ] Every acceptance criterion in SPEC-int-hub-ui holds
- [ ] **No sync, import, or automation control is rendered anywhere** — nothing consumes them yet
- [ ] `npm test && npm run typecheck && npm run lint` pass
- [ ] Specs updated wherever the build diverged from them

---

## PHASE 5 — `int-mailboxes` (IH-27 … IH-30)

### IH-27: Mailbox routes

**Module:** int-mailboxes · **Phase:** p5-mailboxes · **Points:** 5
**Labels:** backend, api, p5-mailboxes, integrations
**Dependencies:** IH-4, IH-24

**Description:**
List, rename, promote, and remove a mailbox. "Exactly one is primary" is a property
of the **set**, so the routes that change it return the whole set.

**Acceptance Criteria:**
- [ ] `GET /api/mailboxes/orgs/:orgId` returns `{ mailboxes: Mailbox[] }`, each carrying its parent connection's status so a row can show its own trouble
- [ ] `PATCH …/:mailboxId` sets `displayName`, validated with `zod` and capped, with a named error on a too-long value
- [ ] `POST …/:mailboxId/primary` returns the **whole list**, with the comment explaining that returning one row lets the client render two primaries between responses
- [ ] `DELETE …/:mailboxId` removes it and promotes the newest remaining mailbox in the same transaction
- [ ] Every route is scoped to `(orgId, userId)`; another rep's mailbox is 404
- [ ] Mutations use `updateMany` / `deleteMany`, never `update({ where: { id } })`

**Verification:**
- [ ] `npm test --workspace server -- mailboxes` passes
- [ ] Tests cover: promoting the second leaves exactly one primary; **two concurrent promotes still leave exactly one**; deleting the primary promotes the newest; deleting the only mailbox leaves none and no error; a 200-char name is rejected by name; another rep's id → 404; another org's id → 404
- [ ] A test asserts no response contains a token

**Files:** `server/src/routes/mailboxes.ts`, `server/src/lib/mail/mailAccounts.ts`, `server/src/routes/__tests__/mailboxes.test.ts`, `server/src/app.ts`
**Scope:** M · **Spec:** SPEC-int-mailboxes.md § API

---

### IH-28: The mailboxes hook barrel

**Module:** int-mailboxes · **Phase:** p5-mailboxes · **Points:** 2
**Labels:** frontend, p5-mailboxes, integrations
**Dependencies:** IH-27

**Description:**
Four hooks, one per file, behind `@/hooks/mailboxes`.

**Acceptance Criteria:**
- [ ] `useGetMailboxes`, `useSetPrimaryMailbox`, `useUpdateMailbox`, `useDisconnectMailbox`
- [ ] `queryKeys.mailboxes` added, keyed by org
- [ ] Promote and delete write the returned **whole list** straight into the cache, so the badge never shows two primaries mid-flight
- [ ] All calls go through `jsonFetch`; `index.ts` re-exports everything

**Verification:**
- [ ] `npm test --workspace vite -- hooks/mailboxes` passes
- [ ] Tests cover: promote replaces the cached list wholesale; a failed promote leaves the previous list intact; a 4xx surfaces the server's message

**Files:** `vite/src/hooks/mailboxes/*.ts`, `vite/src/lib/queryKeys.ts`
**Scope:** XS · **Spec:** SPEC-int-mailboxes.md § API

---

### IH-29: The mailbox row and its icon toolbar

**Module:** int-mailboxes · **Phase:** p5-mailboxes · **Points:** 4
**Labels:** frontend, ui, p5-mailboxes, integrations
**Dependencies:** IH-23, IH-28

**Description:**
Each provider card lists the mailboxes that grant reaches. Management actions read
as a toolbar, not a stack of equal-weight buttons.

**Acceptance Criteria:**
- [ ] The row shows the display name, the address, and a neutral **Primary** badge on exactly one
- [ ] "Send from this" appears only on a non-primary row
- [ ] Settings, Reconnect, and Disconnect are **icon buttons with tooltips**, right-aligned
- [ ] **Reconnect renders only when that mailbox needs it**, so its presence is itself the signal
- [ ] Disconnect is a neutral icon taking a destructive tint **on hover only** — never a filled destructive button — with the `AlertDialog` as the real guard
- [ ] The provider logo is **not** repeated per row; it is already in the card header above
- [ ] An empty provider renders "Connect an account to send email from Maincar." — an invitation, not an explanation of emptiness
- [ ] Tooltip copy is terse: "Reconnect", not "Reconnect this mailbox"

**Verification:**
- [ ] `npm test --workspace vite -- MailboxRow` passes
- [ ] Tests cover: two mailboxes render exactly one Primary badge; clicking "Send from this" moves it; **Reconnect absent on a healthy row and present on a broken one**; Disconnect deletes nothing until confirmed; empty renders the empty state and not an empty list
- [ ] Manual: both themes

**Files:** `vite/src/pages/Settings_Integrations_MailboxRow.tsx`, `Settings_Integrations_MailboxRow.test.tsx`, `Settings_Integrations_ProviderCard.tsx`
**Scope:** S · **Spec:** SPEC-int-mailboxes.md § Acceptance criteria 8–9

---

### IH-30: The mailbox drawer, deep-linked

**Module:** int-mailboxes · **Phase:** p5-mailboxes · **Points:** 3
**Labels:** frontend, ui, p5-mailboxes, integrations
**Dependencies:** IH-29

**Description:**
Per-mailbox settings in a drawer whose open state lives in the URL, so a link opens
on that mailbox and Back closes the drawer instead of leaving the page.

**Acceptance Criteria:**
- [ ] Adds `vite/src/components/ui/sheet.tsx` (shadcn) — the repo has no drawer primitive yet
- [ ] Open state is `?mailbox=<id>`, read through the existing `useUrlString` helper in `vite/src/hooks/urlState/` — **not `useState`**
- [ ] Closing clears the param
- [ ] The drawer holds: the address, the connected-at date, "Name this mailbox" with "Only you see this name.", the primary control, and Disconnect
- [ ] The connected-at date renders through `vite/src/lib/datetime.ts` in the viewing rep's timezone with a zone label — **never `toLocaleString` in the component**
- [ ] **No sync toggle, no import-past-messages control, and no automation switch** — the comment records that they arrive with the sync initiative
- [ ] A `?mailbox=` id that no longer exists closes the drawer instead of rendering an empty one

**Verification:**
- [ ] `npm test --workspace vite -- MailboxDrawer` passes
- [ ] Tests cover: `?mailbox=<id>` opens on that mailbox on first render; closing clears the param; a stale id closes it; the display name saves and the row updates; the date carries a zone label
- [ ] Manual: open the drawer, press Back, and the drawer closes rather than the page changing. Both themes

**Files:** `vite/src/pages/Settings_Integrations_MailboxDrawer.tsx`, `Settings_Integrations_MailboxDrawer.test.tsx`, `vite/src/components/ui/sheet.tsx`
**Scope:** S · **Spec:** SPEC-int-mailboxes.md § Code style

---

### CHECKPOINT — Integration Hub complete (after IH-30)

**Labels:** checkpoint, p5-mailboxes, integrations

- [ ] Every acceptance criterion in all six SPEC-int-*.md files holds in a browser, **both themes**
- [ ] A rep connects two addresses, promotes the second, and the primary follows
- [ ] `?mailbox=<id>` deep-links; Back closes the drawer
- [ ] `getMailProvider()` is live, and the `composer-send` issues can be planned
- [ ] `npm test && npm run typecheck && npm run lint` pass
- [ ] Specs updated wherever the build diverged from them

---

## Imported into Linear — 2026-08-20

**All 34 issues are live.** Project:
[Integration Hub](https://linear.app/maincar2/project/integration-hub-1414768c7a63)
on team `MAI`. All in **Backlog**, with `blockedBy` relations set from the
dependencies above. **IH-17 is linked as blocking [MAI-92](https://linear.app/maincar2/issue/MAI-92)**,
the Email Composer Dock's final checkpoint.

| Local id | Linear |
|---|---|
| IH-1 | [MAI-94](https://linear.app/maincar2/issue/MAI-94) |
| IH-2 | [MAI-95](https://linear.app/maincar2/issue/MAI-95) |
| IH-3 | [MAI-101](https://linear.app/maincar2/issue/MAI-101) |
| IH-4 | [MAI-102](https://linear.app/maincar2/issue/MAI-102) |
| IH-5 | [MAI-96](https://linear.app/maincar2/issue/MAI-96) |
| IH-6 | [MAI-97](https://linear.app/maincar2/issue/MAI-97) |
| IH-7 | [MAI-103](https://linear.app/maincar2/issue/MAI-103) |
| IH-8 | [MAI-98](https://linear.app/maincar2/issue/MAI-98) |
| IH-9 | [MAI-106](https://linear.app/maincar2/issue/MAI-106) |
| IH-10 | [MAI-110](https://linear.app/maincar2/issue/MAI-110) |
| IH-11 | [MAI-107](https://linear.app/maincar2/issue/MAI-107) |
| IH-12 | [MAI-99](https://linear.app/maincar2/issue/MAI-99) |
| IH-13 | [MAI-100](https://linear.app/maincar2/issue/MAI-100) |
| IH-14 | [MAI-104](https://linear.app/maincar2/issue/MAI-104) |
| IH-15 | [MAI-108](https://linear.app/maincar2/issue/MAI-108) |
| IH-16 | [MAI-109](https://linear.app/maincar2/issue/MAI-109) |
| IH-17 | [MAI-111](https://linear.app/maincar2/issue/MAI-111) |
| IH-18 | [MAI-114](https://linear.app/maincar2/issue/MAI-114) |
| IH-19 | [MAI-116](https://linear.app/maincar2/issue/MAI-116) |
| IH-20 | [MAI-117](https://linear.app/maincar2/issue/MAI-117) |
| IH-21 | [MAI-112](https://linear.app/maincar2/issue/MAI-112) |
| IH-22 | [MAI-118](https://linear.app/maincar2/issue/MAI-118) |
| IH-23 | [MAI-115](https://linear.app/maincar2/issue/MAI-115) |
| IH-24 | [MAI-119](https://linear.app/maincar2/issue/MAI-119) |
| IH-25 | [MAI-121](https://linear.app/maincar2/issue/MAI-121) |
| IH-26 | [MAI-120](https://linear.app/maincar2/issue/MAI-120) |
| IH-27 | [MAI-122](https://linear.app/maincar2/issue/MAI-122) |
| IH-28 | [MAI-124](https://linear.app/maincar2/issue/MAI-124) |
| IH-29 | [MAI-125](https://linear.app/maincar2/issue/MAI-125) |
| IH-30 | [MAI-126](https://linear.app/maincar2/issue/MAI-126) |
| CHECKPOINT 1 | [MAI-105](https://linear.app/maincar2/issue/MAI-105) |
| CHECKPOINT 2 | [MAI-113](https://linear.app/maincar2/issue/MAI-113) |
| CHECKPOINT 3 | [MAI-123](https://linear.app/maincar2/issue/MAI-123) |
| CHECKPOINT 4 | [MAI-127](https://linear.app/maincar2/issue/MAI-127) |

**Not carried across:** story points, for the same reason the composer project gave
— nobody has calibrated a scale, so a number in Linear's estimate field would read
as more certain than it is. The `Points:` line stays in each body.

This file stays the source of truth for the issue **bodies**. Edit an issue in
Linear, edit it here too, or the two drift.
