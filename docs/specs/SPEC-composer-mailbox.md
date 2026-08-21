# Spec: `composer-mailbox` — handoff brief for the separate OAuth project

> Module `composer-mailbox` of [CAPABILITY-MAP-EMAIL-COMPOSER.md](CAPABILITY-MAP-EMAIL-COMPOSER.md).
>
> **SUPERSEDED (2026-08-20) by [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).**
> That initiative is the OAuth project this file was the brief for. It is now
> specified in six modules and its issues live in the Linear project
> **Integration Hub**. Read the capability map first; this file is kept because
> the composer codes against the contract below.
>
> **What changed from this brief:**
> - **Google AND Microsoft**, not Gmail alone. Both ship together, behind one seam.
> - **Full scopes** — read, send, and calendar — not send-only. Google restricted-
>   scope verification is submitted at the start of `int-oauth` and is the long pole.
> - **`getMailProvider(mailAccountId, orgId)`** takes the org too, so the lookup is
>   org-scoped like every other query in this app. The return type is unchanged.
> - `MailProvider` gains `listMessagesSince`, `getMessage`, `listEventsSince`, and
>   `createEvent`. **`sendEmail` is unchanged**, so nothing in `composer-send` moves.
>
> `composer-send` is blocked until `int-seam` ships `getMailProvider()`.
> Nothing else in the composer initiative depends on it.

## Objective

A rep connects their own work Gmail mailbox once, in Settings.
After that the app can send **as them**, from their address, and the reply lands
in their inbox rather than somewhere the rep never looks.

This project also builds **the seam**: one internal contract that hides every
provider difference, so adding Outlook later is an implementation and not a
refactor. That is the whole architectural point.
`provider === 'google'` may appear in `dependencies/` and in `lib/mail/`, and
**nowhere else in the app**.

**Success looks like:** the composer, and later the calendar and any sync job,
code against one interface and never learn which provider is underneath.

### Acceptance criteria

1. Settings → Integrations lists the rep's connected mailboxes for this org.
2. **Connect Gmail** runs OAuth and stores a refresh token, encrypted at rest.
3. Reconnecting the same address updates the existing row rather than leaving a
   second one behind.
4. Exactly one mailbox per (org, user) is `isPrimary`. Moving it is atomic.
5. Disconnecting deletes the connection, and with it the mailbox.
6. A revoked or expired grant sets `syncState = 'needs_reauth'`, and the UI says
   so with a **Reconnect** button, not a silent failure.
7. Access tokens are refreshed transparently. No caller handles a 401 itself.
8. `getMailProvider(mailAccountId)` returns a `MailProvider`, or throws
   `MailboxNotFoundError`.
9. Scopes requested are the narrowest that allow sending: `gmail.send` plus
   `userinfo.email`. Read and sync scopes are **not** requested by this module.

## Tech stack

`googleapis` (or plain `fetch` against the Gmail REST API), `zod`. Encryption via
Node `crypto` with a key from the environment.

## Commands

Same as [`composer-dock`](SPEC-composer-dock.md#commands), plus a
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `TOKEN_ENC_KEY` in
`.env` (documented in `.env.example`, never committed).

## Project structure

```
server/prisma/schema.prisma        → add OAuthConnection, MailAccount
server/src/lib/mail/
  MailProvider.ts                  → THE SEAM. The published interface.
  googleMail.ts                    → Gmail implementation
  mailErrors.ts                    → MailApiError, MailboxNotFoundError, CursorExpiredError
  oauthConnections.ts              → withFreshAccessToken(), token refresh + encryption
  mailAccounts.ts                  → primary-mailbox moves, atomic
server/src/routes/mailboxes.ts     → NEW. Connect, callback, list, disconnect
vite/src/pages/settings/Integrations.tsx → NEW
vite/src/hooks/mailboxes/          → NEW barrel
```

## The seam

```ts
export type MailAddress = { name?: string; email: string }

export type OutboundEmail = {
  to: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  subject: string
  bodyHtml: string          // already sanitized by the caller
  inReplyToMessageId?: string
  threadId?: string
  attachments?: { filename: string; contentType: string; contentBase64: string }[]
}

export type SentEmail = { providerMsgId: string; threadId: string; sentAt: Date }

export interface MailProvider {
  readonly provider: 'google' | 'microsoft'
  sendEmail(input: OutboundEmail): Promise<SentEmail>
  // listMessagesSince / listEventsSince / createEvent exist on maincar's version
  // of this interface. They are NOT needed to send. Mail sync and calendar are
  // separate work again — do not build them here.
}
```

**These signatures are published.** Other work builds against them. Add to them
rather than renaming.

## Data model

```prisma
model OAuthConnection {
  id            String   @id @default(cuid())
  org           Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId         String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId        String
  provider      String   // google | microsoft — a String, never a Prisma enum
  // Encrypted at rest. Never logged, never returned by any route, never in a
  // response body — not even to the user who owns it.
  refreshToken  String
  accessToken   String?
  expiresAt     DateTime?
  scopes        String[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  mailAccount   MailAccount?
}

model MailAccount {
  id           String          @id @default(cuid())
  org          Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId        String
  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId       String
  // Deleting the grant deletes the mailbox: without a token there is nothing left
  // to send from.
  connection   OAuthConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  connectionId String          @unique
  provider     String   // 'google' today. A String, never a Prisma enum.
  emailAddress String
  displayName  String?         // what the user typed, e.g. "Work inbox"
  // Exactly one per (org, user) is true. Moved atomically in lib/mail/mailAccounts.ts.
  isPrimary    Boolean         @default(false)
  // idle | needs_reauth | error
  syncState    String          @default("idle")
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  // One mailbox per address per org. Re-connecting updates rather than duplicates.
  @@unique([orgId, emailAddress])
  @@index([orgId, userId])
}
```

## Testing strategy

The provider calls are mocked — no test hits Google. Test the seam, not Gmail.

- `withFreshAccessToken` refreshes an expired token once and retries the call.
- A refresh that fails with `invalid_grant` sets `syncState = 'needs_reauth'`.
- The primary flag moves atomically: two mailboxes, promote the second, exactly
  one `isPrimary` remains true.
- Reconnecting the same address updates the row; the unique constraint holds.
- No route response, error message, or log line ever contains a token. Assert
  this explicitly — it is the test most worth having.
- The OAuth callback rejects a mismatched `state` (CSRF).
- `getMailProvider` on a deleted account throws `MailboxNotFoundError`.

## Boundaries

**Always** — encrypt refresh tokens at rest; request the narrowest scopes; verify
`state` on the callback; scope every query to org and user.
**Ask first** — adding a scope; adding the Microsoft implementation; anything that
would make the app read a rep's inbox rather than only send.
**Never** — log, return, or store a token in plaintext; put a token in a URL;
implement a send path that bypasses the seam; add an SMTP fallback.

## Success criteria

- [ ] A rep connects Gmail, sees it listed, disconnects it, and it is gone.
- [ ] `getMailProvider()` returns a working `sendEmail` against a mocked Gmail.
- [ ] Grepping the repo for `provider === 'google'` outside `lib/mail/` and
      `dependencies/` returns nothing.
- [ ] No token appears in any log, response, or test snapshot.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Where do the OAuth client credentials come from — one shared app for all orgs,
   or per-org apps? *(Recommendation: one shared app; per-org apps are a
   verification burden with no benefit at this stage.)*
2. Google's OAuth verification for sending scopes takes weeks and is the long
   pole for `composer-send`. Submit it at the **start** of this project, not the
   end? *(Recommendation: yes.)*
3. Does this project also ship the Settings → Integrations screen, or only the
   server side? *(Recommendation: ship the screen — a token with no way for a rep
   to grant or revoke it is not a connected mailbox.)*
