// Integration tests for the OAuth callback's WRITE path, against a REAL Postgres
// schema (see vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite (integrations.test.ts) stubs saveConnection/markConnectionError, so
// it only proves the callback's control flow. This proves the real behavior the
// stubs stand in for: a full grant lands `connected` with a mailbox, a partial grant
// lands `limited`/`partial_access`, a re-consent UPDATES the one row rather than
// leaving a second behind, the first mailbox a rep connects is primary, tokens are
// ciphertext at rest, and every write is scoped to the org it was handed.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { markConnectionError, saveConnection } from '../../lib/mail/oauthConnections.js'
import { allRequestedScopes } from '../../lib/oauthScopes.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const GOOGLE_ALL = allRequestedScopes('google')
const G_SEND = 'https://www.googleapis.com/auth/gmail.send'
const GOOGLE_MINUS_SEND = GOOGLE_ALL.filter((s) => s !== G_SEND)

function grant(overrides: Partial<Parameters<typeof saveConnection>[0]> = {}) {
  return {
    orgId: 'set-me',
    userId: 'set-me',
    provider: 'google' as const,
    providerAccountId: 'sub-1',
    emailAddress: 'rep@acme.com',
    accessToken: 'ACCESS-PLAINTEXT',
    refreshToken: 'REFRESH-PLAINTEXT',
    expiresAt: new Date(Date.now() + 3_600_000),
    grantedScopes: GOOGLE_ALL,
    ...overrides,
  }
}

describe('OAuth callback write path (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('stores a full grant as connected, with one primary mailbox and ciphertext tokens', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const result = await saveConnection(grant({ orgId: org.orgId, userId: org.adminUserId }), prisma)

    expect(result.status).toBe('connected')
    expect(result.errorCode).toBeNull()
    expect(result.scopes).toEqual(GOOGLE_ALL)

    const row = await prisma.oAuthConnection.findFirstOrThrow({ where: { orgId: org.orgId, userId: org.adminUserId } })
    // Tokens are encrypted at rest — never the plaintext we handed in.
    expect(row.refreshToken).not.toBe('REFRESH-PLAINTEXT')
    expect(row.refreshToken.startsWith('v1.')).toBe(true)
    expect(row.accessToken).not.toBe('ACCESS-PLAINTEXT')
    expect(row.lastValidatedAt).not.toBeNull()

    const mailbox = await prisma.mailAccount.findFirstOrThrow({ where: { orgId: org.orgId } })
    expect(mailbox.emailAddress).toBe('rep@acme.com')
    expect(mailbox.isPrimary).toBe(true)
    expect(mailbox.connectionId).toBe(row.id)
  })

  it('stores a partial grant as limited/partial_access, naming the missing capability', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const result = await saveConnection(
      grant({ orgId: org.orgId, userId: org.adminUserId, grantedScopes: GOOGLE_MINUS_SEND }),
      prisma,
    )

    expect(result.status).toBe('limited')
    expect(result.errorCode).toBe('partial_access')
    expect(result.statusDetail).toBe('Maincar cannot send email as you.')
  })

  it('a second consent for the same address UPDATES the row — one connection, one mailbox', async () => {
    const org = await seedOrgWithAdmin(prisma)

    // First: a partial grant.
    await saveConnection(grant({ orgId: org.orgId, userId: org.adminUserId, grantedScopes: GOOGLE_MINUS_SEND }), prisma)
    // Second: a full re-consent for the same address.
    const second = await saveConnection(grant({ orgId: org.orgId, userId: org.adminUserId }), prisma)

    expect(second.status).toBe('connected')
    expect(await prisma.oAuthConnection.count({ where: { orgId: org.orgId } })).toBe(1)
    expect(await prisma.mailAccount.count({ where: { orgId: org.orgId } })).toBe(1)
  })

  it('the first mailbox a rep connects is primary; the second is not', async () => {
    const org = await seedOrgWithAdmin(prisma)

    await saveConnection(
      grant({ orgId: org.orgId, userId: org.adminUserId, provider: 'google', providerAccountId: 'g-1', emailAddress: 'first@acme.com' }),
      prisma,
    )
    await saveConnection(
      grant({
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'microsoft',
        providerAccountId: 'm-1',
        emailAddress: 'second@acme.com',
        grantedScopes: allRequestedScopes('microsoft'),
      }),
      prisma,
    )

    const first = await prisma.mailAccount.findFirstOrThrow({ where: { orgId: org.orgId, emailAddress: 'first@acme.com' } })
    const second = await prisma.mailAccount.findFirstOrThrow({ where: { orgId: org.orgId, emailAddress: 'second@acme.com' } })
    expect(first.isPrimary).toBe(true)
    expect(second.isPrimary).toBe(false)
  })

  it('scopes every write to the org it was handed — a save for org B leaves org A empty', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    await saveConnection(grant({ orgId: orgB.orgId, userId: orgB.adminUserId }), prisma)

    expect(await prisma.oAuthConnection.count({ where: { orgId: orgA.orgId } })).toBe(0)
    expect(await prisma.oAuthConnection.count({ where: { orgId: orgB.orgId } })).toBe(1)
  })

  it('markConnectionError stamps only the matching tenant row, and reports the count', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await saveConnection(grant({ orgId: org.orgId, userId: org.adminUserId }), prisma)

    // A stamp for another org changes nothing.
    const foreign = await markConnectionError(
      { orgId: 'no-such-org', userId: org.adminUserId, provider: 'google' },
      'token_revoked',
      'gone',
      prisma,
    )
    expect(foreign).toBe(0)

    const stamped = await markConnectionError(
      { orgId: org.orgId, userId: org.adminUserId, provider: 'google' },
      'token_revoked',
      'Access was revoked; reconnect the mailbox.',
      prisma,
    )
    expect(stamped).toBe(1)

    const row = await prisma.oAuthConnection.findFirstOrThrow({ where: { orgId: org.orgId } })
    expect(row.status).toBe('error')
    expect(row.errorCode).toBe('token_revoked')
  })
})
