# Spec: `int-oauth`

> Module `int-oauth` of [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).
> Depends on: `int-schema`. Phase 2, parallel with `int-seam`.

## Objective

A rep clicks **Connect**, allows some or all of what Maincar asks for, and the app
records honestly which of those it actually got.

**Success looks like:** a rep who ticks two of three boxes at Google's consent
screen ends up with an amber connection that names the missing permission, and one
click asks for **only** that one.

### Acceptance criteria

1. `POST …/integrations/:provider/authorize` returns a consent URL. It never
   redirects — the client opens it in a popup it already has open.
2. `state` is **HMAC-SHA256 signed**, carries `provider`, `userId`, `orgId`, `mode`,
   `connectionId`, and a nonce, and expires after 10 minutes. The callback verifies
   the signature in constant time before it reads a single field.
3. PKCE (`S256`) is used on both providers.
4. `GET /api/integrations/:provider/callback` is the **only** unauthenticated route
   in this module. It carries no secret: the signed `state` is what says whose
   consent this is.
5. The callback compares granted scopes against `REQUIRED_SCOPES[provider]` and
   writes `status`:
   - every scope present → `connected`, `errorCode` null, `statusDetail` empty
   - some present → `limited`, `errorCode` `partial_access`, and `statusDetail`
     names what does not work in plain words
   - none, or the provider refused → `error` with the mapped code
6. **Google without a refresh token is `error` / `missing_refresh_token`**, never
   `connected`. A grant that cannot outlive its first hour is not a connection.
7. `mode: 'fix'` requests **only the missing scopes** (Google incremental
   authorization) with `login_hint` set to the existing address, so the rep is not
   made to re-approve what they already allowed.
8. Re-consent for an address that already has a row **updates that row**. It never
   leaves a second one behind, on any path.
9. Completing consent upserts exactly one `MailAccount` per address, and this
   happens inside `saveConnection` so no route can forget it. The first mailbox a
   rep connects becomes `isPrimary`.
10. Every provider failure maps to a **stable `errorCode` string**. An unmapped
    provider error becomes `unknown` and is logged with the raw code.
11. The callback renders a small HTML page that posts the result to
    `window.opener` **targeted at the app's own origin**, never `*`, and closes
    itself. Provider-supplied text is JSON-escaped with `<` escaped, so it cannot
    break out of the script tag.
12. `admin_approval_required` is detected from both providers' error responses and
    is its own code, because the fix is "ask your admin", not "try again".

## Tech stack

Express, `zod`, Node `crypto`. Provider HTTP through
`server/src/dependencies/googleOAuth.ts` and `microsoftOAuth.ts` — no SDK is
constructed in a route ([rules/dependencies-and-config.md](../../.claude/rules/dependencies-and-config.md)).

## Commands

```bash
npm run dev                  # server + vite
npm test --workspace server
npm run typecheck && npm run lint
```

`.env` gains `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`MS_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`,
`OAUTH_REDIRECT_BASE`. All documented in `.env.example`, none committed.

## Project structure

```
server/src/config.ts                        → the six vars above (edit)
server/src/dependencies/googleOAuth.ts      → NEW. buildAuthorizeUrl, exchangeCode, refresh, fetchIdentity
server/src/dependencies/microsoftOAuth.ts   → NEW. same four functions
server/src/dependencies/oauthTypes.ts       → NEW. OAuthClient, OAuthProviderError
server/src/lib/mail/oauthProviders.ts       → NEW. oauthClientFor(), PROVIDERS, isProvider — ONE registry
server/src/lib/oauthScopes.ts               → NEW. REQUIRED_SCOPES, evaluateGrant, missingScopeParams
server/src/lib/oauthState.ts                → NEW. signState / verifyState
server/src/lib/mail/integrationErrors.ts    → NEW. INTEGRATION_ERROR_CODES + mapProviderError
server/src/routes/integrations.ts           → NEW. authorize, callback, list
server/src/app.ts                           → mount the router (edit, two lines)
server/src/routes/__tests__/integrations.test.ts → NEW
server/src/lib/__tests__/oauthState.test.ts      → NEW
server/src/lib/__tests__/oauthScopes.test.ts     → NEW
```

## API

All authenticated routes are `/api/integrations/orgs/:orgId/…` and re-prove
membership from the path. Nothing in this app infers its own tenant.

```
POST /api/integrations/orgs/:orgId/:provider/authorize
  body { mode: 'connect' | 'fix', connectionId?: string }
  200  { url: string }
  404  { error: 'Unknown provider' }

GET  /api/integrations/orgs/:orgId
  200  { integrations: IntegrationCard[] }   // one per PROVIDER, not per connection

GET  /api/integrations/:provider/callback?code&state    ← UNAUTHENTICATED
  200  text/html — posts to window.opener, then closes
```

`IntegrationCard` is `{ provider, providerLabel, requiredPermissions: string[],
connection: SerializedConnection | null }`. A provider with nothing connected has
`connection: null` and the card renders "Not connected" without the client owning
the provider list.

## Scopes requested

| Provider | Scope | Plain-words label shown to the rep |
|---|---|---|
| google | `gmail.readonly` | Read your email |
| google | `gmail.send` | Send email as you |
| google | `calendar.events` | See and add calendar events |
| google | `userinfo.email` | Know which account this is |
| microsoft | `Mail.Read` | Read your email |
| microsoft | `Mail.Send` | Send email as you |
| microsoft | `Calendars.ReadWrite` | See and add calendar events |
| microsoft | `User.Read`, `offline_access` | Know which account this is, and stay connected |

`gmail.readonly` is a **restricted** scope. Google's verification with a
third-party security assessment is submitted at the **start** of this module, not
at the end. Until it clears, the app works for up to 100 test users.

## Code style

```ts
// oauthScopes.ts — the grant is EVALUATED, never assumed. The provider decides
// what it gave us, and it is routinely less than what was asked for.
export function evaluateGrant(provider: Provider, granted: string[]) {
  const missing = REQUIRED_SCOPES[provider].filter((s) => !granted.includes(s.param))
  if (missing.length === 0) return { status: 'connected', errorCode: null, statusDetail: '' }
  return {
    status: 'limited',
    errorCode: 'partial_access',
    // Names the CONSEQUENCE, not the scope string. "gmail.send was not granted"
    // tells a rep nothing they can act on.
    statusDetail: `Maincar cannot ${missing.map((s) => s.consequence).join(' or ')}.`,
  }
}
```

```ts
// The callback's error path writes the SAME row shape as its success path, so a
// failed repair cannot leave a connection reading green from the attempt before.
```

Handlers are wrapped in `wrapRoute()` and carry the section comments in the house
order ([rules/server-routes.md](../../.claude/rules/server-routes.md)).

## Testing strategy

Provider HTTP is mocked at `server/src/dependencies/`. No test reaches Google.

- A `state` signed and immediately verified round-trips.
- **A `state` with one character of the payload changed fails verification.**
- A `state` older than 10 minutes fails with `state_invalid`.
- `mode: 'fix'` on a connection missing one scope requests exactly that one scope,
  and sets `login_hint`.
- A callback granting every scope writes `connected` with `errorCode` null.
- A callback granting two of three writes `limited` / `partial_access`, and
  `statusDetail` names the missing capability in plain words.
- **Google returning no refresh token writes `error` / `missing_refresh_token`.**
- A second consent for the same address updates the row; `oAuthConnection.count()`
  stays at 1 and `mailAccount.count()` stays at 1.
- The first mailbox connected is `isPrimary`; the second is not.
- A Microsoft `AADSTS65001` response maps to `admin_approval_required`.
- An unmapped provider error maps to `unknown` and is logged.
- **No response body, error, or log line from any route contains `code`, an access
  token, or a refresh token.**
- A callback whose `state` names another org's id does not write into this org.
- The callback HTML with a provider error containing `</script>` renders escaped.

## Boundaries

**Always** — verify `state` in constant time before reading it; use PKCE; evaluate
the granted scopes; map every failure to a stable code; upsert the mailbox inside
`saveConnection`; target `postMessage` at the app's own origin.
**Ask first** — adding a scope; requesting a scope the rep did not agree to in the
card copy; any flow that reads a rep's inbox without them connecting it themselves.
**Never** — trust `provider` from a param without `isProvider()`; put a token or a
code in a URL the client can see; write `connected` when a scope is missing; add a
second provider registry beside `oauthProviders.ts`.

## Success criteria

- [ ] All 12 acceptance criteria hold.
- [ ] A rep connects Google in a browser, refuses the send permission, and the row
      is `limited` with `partial_access`.
- [ ] Clicking the repair path asks for only the refused scope.
- [ ] Google verification is **submitted**, with the ticket link recorded.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Microsoft personal accounts (`consumers`) as well as work accounts, or work
   only? *(Recommendation: work only — `organizations` as the tenant. Personal
   Outlook accounts are not what a rep sells from, and supporting both doubles the
   consent-failure surface.)*
