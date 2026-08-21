# Spec: `int-schema`

> Module `int-schema` of [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).
> Depends on: nothing. Phase 1.

## Objective

A refresh token is stored encrypted at rest, and **exactly one function in the
codebase** can turn it back into a usable access token.

**Success looks like:** every other module asks for a token by connection id and
never sees ciphertext, never sees a refresh token, and never handles a 401.

### Acceptance criteria

1. `OAuthConnection` holds the encrypted grant. `MailAccount` holds the mailbox
   that grant gives access to. Deleting the connection deletes the mailbox.
2. Tokens are encrypted with **AES-256-GCM**, and the ciphertext is bound by AAD
   to `${provider}:${userId}`. A row copied to another user's connection fails to
   decrypt even with the master key.
3. The stored format is self-describing and versioned: `v1.<iv>.<ciphertext>.<tag>`,
   all base64url. A future key rotation adds `v2` without a migration.
4. `withFreshAccessToken(connectionId)` returns a live access token. If the stored
   one expires within 60 seconds it refreshes first, writes the new one back, and
   returns that.
5. A refresh that fails with `invalid_grant` sets `status = 'error'` and
   `errorCode = 'token_revoked'` and throws. It does **not** return a dead token.
6. A token that cannot be decrypted sets `errorCode = 'token_unreadable'` and
   throws. It is never treated as absent, because absent invites a silent re-fetch
   of something unrecoverable.
7. `serializeConnection(row)` is the only shape any route may return. It has no
   token field, and it cannot grow one, because it is built from an explicit
   `select` and asserted by a test.
8. Two concurrent callers hitting an expired token perform **one** refresh, not two.
9. `TOKEN_ENC_KEY` is read only by `server/src/config.ts` and fails fast at startup
   when missing or not 32 bytes.

## Tech stack

Node `crypto` (no new dependency), Prisma, `zod`. No provider SDK — this module
does not know what Google is.

## Commands

```bash
npm run db:migrate           # generate + apply the migration (never hand-write SQL)
npm test --workspace server  # vitest
npm run typecheck && npm run lint
```

## Project structure

```
server/prisma/schema.prisma                      → add OAuthConnection, MailAccount
server/prisma/migrations/*                       → generated, never hand-written
server/src/config.ts                             → TOKEN_ENC_KEY (edit, one line)
server/src/lib/tokenCrypto.ts                    → NEW. encryptToken / decryptToken
server/src/lib/mail/oauthConnections.ts          → NEW. THE ONLY FILE THAT DECRYPTS
server/src/lib/mail/mailAccounts.ts              → NEW. upsert, primary-mailbox moves
server/src/lib/mail/mailErrors.ts                → NEW. the typed error set
server/src/lib/__tests__/tokenCrypto.test.ts     → NEW
server/src/lib/mail/__tests__/oauthConnections.test.ts → NEW
server/src/lib/mail/__tests__/mailAccounts.test.ts     → NEW
```

## Data model

```prisma
model OAuthConnection {
  id       String @id @default(cuid())
  org      Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId    String
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId   String

  // google | microsoft. A String, never a Prisma enum (rules/database-and-prisma.md).
  provider String

  // The provider's own id for this identity. Google: sub. Microsoft: oid.
  // Held so a re-consent under a changed email address still matches the row.
  providerAccountId String
  emailAddress      String

  // Encrypted at rest, format v1.<iv>.<ciphertext>.<tag>. Never logged, never
  // returned by any route, never in a response body — not even to the owner.
  refreshToken String  @db.Text
  accessToken  String? @db.Text
  expiresAt    DateTime?

  // What the provider ACTUALLY granted, not what was asked for. The difference
  // between this and REQUIRED_SCOPES is the whole amber state.
  scopes String[] @default([])

  // connected | limited | error
  status       String  @default("connected")
  // Stable code the client maps to recovery steps. Null when healthy.
  errorCode    String?
  // One line naming what does not work. Empty when healthy.
  statusDetail String?

  // When a live provider call last proved this works. Null until the first Test.
  lastValidatedAt DateTime?
  lastRefreshAt   DateTime?

  mailAccount MailAccount?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // One grant per provider per rep. Reconnecting updates rather than duplicates.
  @@unique([orgId, userId, provider])
  @@index([orgId, userId])
}

model MailAccount {
  id String @id @default(cuid())
  org    Org    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId  String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId String

  // Deleting the grant deletes the mailbox: without a token there is nothing left
  // to send from, and a mailbox that cannot send is not a mailbox.
  connection   OAuthConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  connectionId String          @unique

  provider     String  // duplicated from the connection so a list needs no join
  emailAddress String
  displayName  String?

  // Exactly one per (orgId, userId) is true. Moved atomically in mailAccounts.ts.
  isPrimary Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // One mailbox per address per org. Re-connecting updates rather than duplicates.
  @@unique([orgId, emailAddress])
  @@index([orgId, userId])
}
```

`Org` and `User` each gain two back-relations. Nothing else in the schema changes.

## Code style

```ts
// tokenCrypto.ts — the format carries its own version, so rotation is additive.
export function encryptToken(plaintext: string, aad: string): string {
  const iv = crypto.randomBytes(12)                 // 96-bit IV, the GCM recommendation
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))           // binds this ciphertext to provider:user
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `v1.${b64(iv)}.${b64(body)}.${b64(cipher.getAuthTag())}`
}

// oauthConnections.ts — the single refresh, and the single write-back.
// Two callers on an expired token must not both hit the provider: the second
// would invalidate the first's brand-new token on providers that rotate refresh
// tokens, and the first caller would then hold a token that no longer works.
const inFlight = new Map<string, Promise<string>>()

export async function withFreshAccessToken(connectionId: string): Promise<string> {
  const existing = inFlight.get(connectionId)
  if (existing) return existing
  const p = doRefreshIfNeeded(connectionId).finally(() => inFlight.delete(connectionId))
  inFlight.set(connectionId, p)
  return p
}
```

```ts
// mailAccounts.ts — the primary flag moves in ONE transaction. Two statements
// outside a transaction leave a window with zero primaries, and the composer
// reads "no mailbox connected" during it.
await prisma.$transaction([
  prisma.mailAccount.updateMany({ where: { orgId, userId }, data: { isPrimary: false } }),
  prisma.mailAccount.updateMany({ where: { id, orgId, userId }, data: { isPrimary: true } }),
])
```

Every query in this module filters on `orgId`. Mutations use `updateMany` /
`deleteMany`, never `update({ where: { id } })`
([rules/database-and-prisma.md](../../.claude/rules/database-and-prisma.md)).

## Testing strategy

No test reaches a provider. The refresh call is mocked at the
`server/src/dependencies/` boundary.

- Round-trip: encrypt then decrypt returns the original string.
- **Ciphertext decrypted with the wrong AAD throws.** This is the test that proves
  the binding is real rather than decorative.
- A tampered auth tag throws.
- A token expiring in 30 s is refreshed; one expiring in 10 minutes is not.
- A refresh returning `invalid_grant` leaves `status = 'error'`,
  `errorCode = 'token_revoked'`, and throws.
- An undecryptable stored token sets `token_unreadable` and throws.
- **Two concurrent `withFreshAccessToken` calls trigger exactly one refresh.**
- **`serializeConnection` output contains no substring of either token.** Assert on
  the serialized JSON, not on the field list — a future field cannot sneak past it.
- Promoting the second of two mailboxes leaves exactly one `isPrimary`.
- Deleting an `OAuthConnection` cascades the `MailAccount` away.
- A connection id from another org returns null rather than throwing a leaky error.

## Boundaries

**Always** — encrypt before writing; bind AAD to `provider:user`; scope every query
to `orgId`; move the primary flag inside a transaction; fail loudly on an
unreadable token.
**Ask first** — adding a second key version; storing anything else in the
connection row; adding a shared or delegated mailbox.
**Never** — log, return, or store a token in plaintext; put a token in a URL or a
query param; decrypt anywhere but `oauthConnections.ts`; catch a decryption
failure and continue.

## Success criteria

- [ ] All 9 acceptance criteria hold.
- [ ] `grep -rn "decryptToken" server/src` matches `tokenCrypto.ts` and
      `oauthConnections.ts` and nothing else.
- [ ] No token appears in any log, response, or test snapshot.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Does `TOKEN_ENC_KEY` come from the environment or a secret manager in
   production? *(Recommendation: environment now, and note it as a deployment task.
   A secret manager is a hosting decision, not a schema one.)*
