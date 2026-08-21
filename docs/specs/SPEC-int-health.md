# Spec: `int-health`

> Module `int-health` of [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).
> Depends on: `int-oauth`, `int-seam`. Phase 3.

## Objective

A rep clicks **Test** and finds out **which specific permission** is broken, not
that "something" is wrong.

**Success looks like:** a rep whose admin revoked send access sees "Send email as
you — the provider refused" and knows the one thing to fix.

### Acceptance criteria

1. `POST …/integrations/:connectionId/test` makes **live, harmless** provider calls
   and returns a verdict **per capability**, never a single boolean.
2. The probes are read-only and side-effect free. **Nothing sends an email, and
   nothing creates a calendar event.** Send is proved by reading the send-scope
   grant plus a draft-scope-free identity call, not by sending.
3. Each capability result is `{ capability, label, ok, reason }`. `label` is the
   plain-words permission name the card already shows, so the Test result and the
   card use the same words for the same thing.
4. A successful Test sets `lastValidatedAt`, and the card renders "Verified 2m ago".
   **Connected is a fact with a timestamp, not a claim left over from setup day.**
5. A Test that finds a broken capability **writes the connection's status back** to
   `limited` or `error` with the mapped `errorCode`. Test is a repair of the
   record, not just a read.
6. `POST …/integrations/:connectionId/refresh` re-reads the granted scopes from the
   provider without a consent screen, and re-evaluates status. This is what catches
   an admin granting a scope after the fact.
7. `GET …/integrations/health` returns **only connections in a failed state** —
   never merely-limited ones. A rep who deliberately withheld a permission must not
   see a permanent alarm, or the badge gets ignored and stops working.
8. The health response is deliberately slim: `{ connectionId, provider,
   providerLabel, emailAddress, errorCode, detail }`. Enough to count and to
   deep-link to the fix.
9. Every failure carries a **stable `errorCode`** from the same set `int-oauth`
   defines. There is one code table, not two.
10. A Test on a connection whose token cannot be refreshed sets `token_revoked` and
    returns `ok: false` — it does not throw a 500. A broken integration is an
    expected state, not a server error.
11. A Test never blocks longer than 10 seconds. A provider that hangs returns
    `provider_unreachable`.

## Tech stack

Express, `zod`. All provider calls go through `int-seam`'s implementations and
`withFreshAccessToken()`. **No new dependency.**

## Commands

Same as [`int-oauth`](SPEC-int-oauth.md#commands).

## Project structure

```
server/src/lib/mail/connectionTest.ts        → NEW. testConnection(connection) → per-capability verdict
server/src/lib/mail/connectionHealth.ts      → NEW. listBrokenConnections(orgId, userId)
server/src/routes/integrations.ts            → add test, refresh, health (edit)
server/src/lib/mail/__tests__/connectionTest.test.ts → NEW
server/src/routes/__tests__/integrations.test.ts     → extend
```

## API

```
POST /api/integrations/orgs/:orgId/:connectionId/test
  200 { result: { ok, detail, errorCode, capabilities: CapabilityResult[], connection } }

POST /api/integrations/orgs/:orgId/:connectionId/refresh
  200 { connection: SerializedConnection }

GET  /api/integrations/orgs/:orgId/health
  200 { broken: BrokenConnection[] }
```

```ts
export type Capability = 'read_email' | 'send_email' | 'calendar'

export interface CapabilityResult {
  capability: Capability
  label: string      // the SAME plain-words label the provider card shows
  ok: boolean
  reason: string     // why not. Empty when ok.
}
```

## The probes

| Capability | Google probe | Microsoft probe |
|---|---|---|
| `read_email` | `users.messages.list` with `maxResults: 1` | `GET /me/messages?$top=1` |
| `send_email` | `users.getProfile` **and** `gmail.send` present in granted scopes | `GET /me` **and** `Mail.Send` present in granted scopes |
| `calendar` | `calendarList.list` with `maxResults: 1` | `GET /me/calendars?$top=1` |

Send is the one capability with no free read-only probe on either provider. The
honest thing is to say so rather than to invent a proof: the verdict is the
**granted scope** plus a live identity call showing the token still works. The
`reason` text for a send failure says the permission is missing, never that a test
message failed, because no test message was sent.

## Code style

```ts
// connectionTest.ts — every probe is independent. One failing capability must not
// hide the verdict on the other two, which is exactly what a single try/catch
// around all three would do.
const results = await Promise.all(
  CAPABILITIES.map(async (cap) => {
    try {
      await withTimeout(cap.probe(provider), 10_000)
      return { capability: cap.id, label: cap.label, ok: true, reason: '' }
    } catch (err) {
      return { capability: cap.id, label: cap.label, ok: false, reason: explain(err) }
    }
  }),
)
```

```ts
// The verdict is written BACK to the row. A Test that discovers a revoked token
// and leaves the row reading "connected" means the next rep to look at this page
// sees a lie that the app already knew was a lie.
await prisma.oAuthConnection.updateMany({
  where: { id: connectionId, orgId, userId },
  data: { status, errorCode, statusDetail, lastValidatedAt: ok ? new Date() : undefined },
})
```

`lastValidatedAt` is set **only** on success. A failed Test must not refresh the
"Verified" timestamp — that would make the freshest-looking connection the broken
one.

## Testing strategy

Provider calls are mocked. No test reaches a provider.

- A connection with every scope returns three `ok: true` capabilities and
  `result.ok` true.
- **A connection missing `gmail.send` returns `read_email` ok, `calendar` ok, and
  `send_email` not ok.** One broken capability does not poison the other two.
- A successful Test sets `lastValidatedAt`.
- **A failed Test does NOT set `lastValidatedAt`.**
- A Test that finds a revoked token writes `error` / `token_revoked` and returns
  200 with `ok: false`, not a 500.
- A provider that hangs past 10 s returns `provider_unreachable`.
- `refresh` on a connection whose admin has since granted the missing scope moves
  it from `limited` to `connected`.
- `health` returns a connection in `error`.
- **`health` does NOT return a connection in `limited`.** This is the test that
  keeps the badge meaningful.
- `health` scoped to org A does not return org B's broken connection.
- A `connectionId` belonging to another user returns 404.
- No response from any of the three routes contains a token.

## Boundaries

**Always** — probe each capability independently; write the verdict back to the
row; set `lastValidatedAt` only on success; use the same error-code table as
`int-oauth`; time out at 10 seconds.
**Ask first** — adding a probe that writes anything; a background health poll;
emailing a rep about a broken connection.
**Never** — send a real email or create a real event to prove a capability; return
a bare pass/fail; put a `limited` connection in the health badge; return a 500 for
a broken integration.

## Success criteria

- [ ] All 11 acceptance criteria hold.
- [ ] A connection with a withheld send scope tests as two green and one red.
- [ ] The health badge stays silent for a deliberately limited connection.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Should a failed Test notify anyone? *(Recommendation: not in this module. A
   notification needs a delivery channel and a quiet-hours policy, and neither
   exists. The badge is the signal for now.)*
