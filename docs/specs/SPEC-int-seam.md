# Spec: `int-seam`

> Module `int-seam` of [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).
> Depends on: `int-schema`. Phase 2, parallel with `int-oauth`.

## Objective

Every caller sends mail, reads mail, and writes calendar events through **one
interface** and never learns which provider is underneath.

This is the architectural point of the whole initiative. Adding a provider must be
an implementation, not a refactor.

**Success looks like:** grepping the repo for `provider === 'google'` outside
`server/src/dependencies/` and `server/src/lib/mail/` returns nothing.

### Acceptance criteria

1. `MailProvider` is published with five methods: `sendEmail`, `listMessagesSince`,
   `getMessage`, `listEventsSince`, `createEvent`. **These signatures are a
   contract with the Email Composer Dock project. Add to them rather than renaming.**
2. `getMailProvider(mailAccountId, orgId)` returns a `MailProvider`, or throws
   `MailboxNotFoundError`.
3. Both Google and Microsoft implementations exist and pass the **same** shared
   test suite. A test written against the interface runs unmodified against both.
4. Every provider call goes through `withFreshAccessToken()`. **No implementation
   handles a 401 itself** — a 401 after a fresh token is a real failure and throws.
5. Provider errors are normalized to a typed set: `MailApiError`,
   `MailboxNotFoundError`, `MailAuthError`, `CursorExpiredError`,
   `RateLimitedError`. A caller catches a Maincar error, never a Google one.
6. `listMessagesSince` is **cursor-based, not offset-based**, and returns
   `{ messages, nextCursor }`. A cursor the provider has expired throws
   `CursorExpiredError` so a caller can restart cleanly rather than silently miss
   messages.
7. A rate-limited call throws `RateLimitedError` carrying `retryAfterMs`. The seam
   does **not** retry on its own — the caller owns that policy.
8. `sendEmail` returns `{ providerMsgId, threadId, sentAt }`. `sentAt` is the
   provider's timestamp, never `new Date()` computed locally.
9. Times crossing this seam are `Date` objects in UTC. Formatting for a human
   happens at the edge, never here ([CLAUDE.md](../../CLAUDE.md) → Dates & Times).
10. **`listMessagesSince`, `getMessage`, `listEventsSince`, and `createEvent` are
    built and tested, and nothing in the app calls them on a schedule.** They are
    the capability the CRM sync initiative will consume. No polling job, no
    queue, no "Sync" control ships here.

## Tech stack

`googleapis` and `@microsoft/microsoft-graph-client`, each wrapped in one file
under `server/src/dependencies/`. `zod` to parse every provider response before it
is trusted.

## Commands

Same as [`int-oauth`](SPEC-int-oauth.md#commands).

## Project structure

```
server/src/dependencies/gmail.ts          → NEW. The googleapis client, constructed here only
server/src/dependencies/graph.ts          → NEW. The Graph client, constructed here only
server/src/lib/mail/MailProvider.ts       → NEW. THE SEAM. The published interface + types
server/src/lib/mail/googleMail.ts         → NEW. Gmail + Google Calendar implementation
server/src/lib/mail/microsoftMail.ts      → NEW. Graph mail + calendar implementation
server/src/lib/mail/getMailProvider.ts    → NEW. The factory. The only switch on provider
server/src/lib/mail/mailErrors.ts         → extend (created in int-schema)
server/src/lib/mail/__tests__/mailProvider.contract.ts   → NEW. The SHARED suite
server/src/lib/mail/__tests__/googleMail.test.ts         → NEW. Runs the shared suite
server/src/lib/mail/__tests__/microsoftMail.test.ts      → NEW. Runs the shared suite
```

## The seam

```ts
export type MailAddress = { name?: string; email: string }

export type OutboundEmail = {
  to: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  subject: string
  bodyHtml: string              // already sanitized by the caller
  inReplyToMessageId?: string
  threadId?: string
  attachments?: { filename: string; contentType: string; contentBase64: string }[]
}

export type SentEmail = { providerMsgId: string; threadId: string; sentAt: Date }

export type InboundMessage = {
  providerMsgId: string
  threadId: string | null
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  subject: string | null
  bodyHtml: string | null
  bodyText: string | null
  sentAt: Date
  isOutbound: boolean           // the rep's own sent mail comes back through here too
}

export type CalendarEvent = {
  providerEventId: string
  title: string | null
  description: string | null
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
  attendees: MailAddress[]
  organizer: MailAddress | null
}

export interface MailProvider {
  readonly provider: 'google' | 'microsoft'
  sendEmail(input: OutboundEmail): Promise<SentEmail>
  listMessagesSince(cursor: string | null, limit: number): Promise<{ messages: InboundMessage[]; nextCursor: string | null }>
  getMessage(providerMsgId: string): Promise<InboundMessage>
  listEventsSince(cursor: string | null, limit: number): Promise<{ events: CalendarEvent[]; nextCursor: string | null }>
  createEvent(input: Omit<CalendarEvent, 'providerEventId' | 'organizer'>): Promise<CalendarEvent>
}
```

## Code style

```ts
// getMailProvider.ts — the ONE switch on provider in the entire repo.
export async function getMailProvider(mailAccountId: string, orgId: string): Promise<MailProvider> {
  const account = await prisma.mailAccount.findFirst({
    where: { id: mailAccountId, orgId },
    select: { id: true, provider: true, connectionId: true, emailAddress: true },
  })
  if (!account) throw new MailboxNotFoundError(mailAccountId)

  switch (account.provider) {
    case 'google':    return googleMail(account)
    case 'microsoft': return microsoftMail(account)
    // A provider string that reached the database but has no implementation is a
    // bug in int-oauth, not a runtime condition to degrade around.
    default: throw new MailApiError(`No implementation for provider ${account.provider}`)
  }
}
```

```ts
// Every provider response is PARSED before it is trusted. A shape change at
// Google should fail one zod parse with a clear message, not surface as
// `undefined.length` three call frames away in the composer.
const parsed = GmailMessageSchema.safeParse(raw)
if (!parsed.success) throw new MailApiError('Gmail returned a message Maincar could not read')
```

## Testing strategy

Every provider HTTP call is mocked at `server/src/dependencies/`. **No test
reaches Google or Microsoft.** The centrepiece is the shared contract suite:
one file of tests, imported and run twice, once per implementation. A test that
passes for Google and fails for Microsoft is the seam leaking.

Shared contract tests (run against both):
- `sendEmail` returns the provider's message id, thread id, and **its** timestamp.
- `sendEmail` with cc and bcc puts bcc in the envelope and not in a visible header.
- `listMessagesSince(null, 10)` returns messages ordered oldest first with a cursor.
- The returned cursor, passed back, returns the **next** page and not the same one.
- An expired cursor throws `CursorExpiredError`.
- A 401 after a fresh token throws `MailAuthError` and does not retry.
- A 429 throws `RateLimitedError` carrying `retryAfterMs`.
- `createEvent` round-trips title, start, end, and attendees.
- Every `Date` returned is UTC.
- A malformed provider payload throws `MailApiError`, never a `TypeError`.

Per-implementation:
- Gmail's base64url raw-message encoding produces a decodable RFC 822 message.
- Graph's `@odata.deltaLink` is stored as the cursor and replayed correctly.
- `getMailProvider` on a deleted account throws `MailboxNotFoundError`.
- `getMailProvider` with another org's id throws `MailboxNotFoundError`, not a leak.

## Boundaries

**Always** — go through `withFreshAccessToken`; parse every provider response;
normalize every error; return UTC dates; keep both implementations passing the
same suite.
**Ask first** — adding a method to `MailProvider`; adding a third provider;
anything that would make a caller branch on which provider it has.
**Never** — construct a provider SDK client outside `server/src/dependencies/`;
handle a 401 by re-fetching a token inside an implementation; retry a send; log a
message body; add a polling job in this module.

## Success criteria

- [ ] All 10 acceptance criteria hold.
- [ ] The shared contract suite passes against **both** implementations.
- [ ] `grep -rn "provider === 'google'" server/src vite/src` matches only files
      under `server/src/dependencies/` and `server/src/lib/mail/`.
- [ ] `getMailProvider()` returns a working `sendEmail` against a mocked provider.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Gmail `history.list` or `messages.list` with a query for the read cursor?
   *(Recommendation: `history.list`. It is the delta API and it maps cleanly onto
   Graph's `deltaLink`, so both providers use the same cursor concept.)*
2. Does `listMessagesSince` return the body, or ids the caller re-fetches?
   *(Recommendation: bodies. A two-step read doubles the round-trips against a
   quota that is already the binding constraint.)*
