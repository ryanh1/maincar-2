// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite reads schema.prisma as text, so it only proves the models were
// WRITTEN the way the spec says. This proves the migration actually produced
// them: the defaults a fresh connection and mailbox are born with, the two
// unique keys that make a reconnect an update rather than a duplicate, the
// one-to-one binding between a grant and its mailbox, and the three cascades
// that stop a deleted org, user, or grant leaving orphans behind.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../generated/prisma/client.js'
import { createTestPrisma, seedMember, seedOrgWithAdmin } from '../test/integration/testPrisma.js'

describe('OAuthConnection + MailAccount (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('is born connected, with no scopes and no error — the minimum a new grant carries', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_123',
        emailAddress: org.adminEmail,
        refreshToken: 'v1.aaa.bbb.ccc',
      },
    })

    expect(conn.status).toBe('connected')
    expect(conn.scopes).toEqual([])
    expect(conn.accessToken).toBeNull()
    expect(conn.expiresAt).toBeNull()
    expect(conn.errorCode).toBeNull()
    expect(conn.statusDetail).toBeNull()
    expect(conn.lastValidatedAt).toBeNull()
    expect(conn.lastRefreshAt).toBeNull()
    expect(conn.createdAt).toBeInstanceOf(Date)
    expect(conn.updatedAt).toBeInstanceOf(Date)
  })

  it('allows only one grant per (org, user, provider)', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const data = {
      orgId: org.orgId,
      userId: org.adminUserId,
      provider: 'google',
      providerAccountId: 'sub_a',
      emailAddress: org.adminEmail,
      refreshToken: 'v1.a.b.c',
    }
    await prisma.oAuthConnection.create({ data })

    await expect(
      prisma.oAuthConnection.create({
        data: { ...data, providerAccountId: 'sub_b', emailAddress: 'other@example.com' },
      }),
    ).rejects.toThrow()

    // A DIFFERENT provider for the same rep is fine — Google and Microsoft coexist.
    const microsoft = await prisma.oAuthConnection.create({
      data: { ...data, provider: 'microsoft', providerAccountId: 'oid_b' },
    })
    expect(microsoft.provider).toBe('microsoft')
  })

  it('binds exactly one mailbox to a connection', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_one',
        emailAddress: org.adminEmail,
        refreshToken: 'v1.a.b.c',
      },
    })

    const box = await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: conn.id,
        provider: 'google',
        emailAddress: org.adminEmail,
      },
    })
    expect(box.isPrimary).toBe(false)
    expect(box.displayName).toBeNull()

    // A second mailbox on the same connection is refused — connectionId is @unique.
    await expect(
      prisma.mailAccount.create({
        data: {
          orgId: org.orgId,
          userId: org.adminUserId,
          connectionId: conn.id,
          provider: 'google',
          emailAddress: 'second@example.com',
        },
      }),
    ).rejects.toThrow()
  })

  it('allows only one mailbox per address per org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const first = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_first',
        emailAddress: 'shared@example.com',
        refreshToken: 'v1.a.b.c',
      },
    })
    const second = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'microsoft',
        providerAccountId: 'oid_second',
        emailAddress: 'shared@example.com',
        refreshToken: 'v1.d.e.f',
      },
    })

    await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: first.id,
        provider: 'google',
        emailAddress: 'shared@example.com',
      },
    })

    await expect(
      prisma.mailAccount.create({
        data: {
          orgId: org.orgId,
          userId: org.adminUserId,
          connectionId: second.id,
          provider: 'microsoft',
          emailAddress: 'shared@example.com',
        },
      }),
    ).rejects.toThrow()
  })

  it('has the indexes the schema declares', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename IN ('OAuthConnection', 'MailAccount') AND schemaname = current_schema()
    `
    // Look each index up by name, then prove its column list — Postgres leaves
    // non-reserved identifiers like `provider` unquoted, so quotes are optional.
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]))
    const columns = (name: string): string => {
      const def = byName.get(name)
      expect(def, `index ${name} is missing`).toBeDefined()
      return def!.replace(/"/g, '')
    }

    expect(columns('OAuthConnection_orgId_userId_provider_key')).toContain('(orgId, userId, provider)')
    expect(columns('OAuthConnection_orgId_userId_provider_key')).toMatch(/UNIQUE/)
    expect(columns('OAuthConnection_orgId_userId_idx')).toContain('(orgId, userId)')
    expect(columns('MailAccount_connectionId_key')).toContain('(connectionId)')
    expect(columns('MailAccount_connectionId_key')).toMatch(/UNIQUE/)
    expect(columns('MailAccount_orgId_emailAddress_key')).toContain('(orgId, emailAddress)')
    expect(columns('MailAccount_orgId_emailAddress_key')).toMatch(/UNIQUE/)
    expect(columns('MailAccount_orgId_userId_idx')).toContain('(orgId, userId)')
  })

  it('cascades the mailbox away when its grant is deleted', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_cascade',
        emailAddress: org.adminEmail,
        refreshToken: 'v1.a.b.c',
      },
    })
    const box = await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: conn.id,
        provider: 'google',
        emailAddress: org.adminEmail,
      },
    })

    await prisma.oAuthConnection.delete({ where: { id: conn.id } })

    expect(await prisma.mailAccount.findUnique({ where: { id: box.id } })).toBeNull()
  })

  it('cascades both tables away when the Org is deleted', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_org',
        emailAddress: org.adminEmail,
        refreshToken: 'v1.a.b.c',
      },
    })
    const box = await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: conn.id,
        provider: 'google',
        emailAddress: org.adminEmail,
      },
    })

    await prisma.org.delete({ where: { id: org.orgId } })

    expect(await prisma.oAuthConnection.findUnique({ where: { id: conn.id } })).toBeNull()
    expect(await prisma.mailAccount.findUnique({ where: { id: box.id } })).toBeNull()
  })

  it('cascades a departing user’s grant and mailbox, leaving the org intact', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: colleague.userId,
        provider: 'google',
        providerAccountId: 'sub_user',
        emailAddress: colleague.email,
        refreshToken: 'v1.a.b.c',
      },
    })
    const box = await prisma.mailAccount.create({
      data: {
        orgId: org.orgId,
        userId: colleague.userId,
        connectionId: conn.id,
        provider: 'google',
        emailAddress: colleague.email,
      },
    })

    await prisma.user.delete({ where: { id: colleague.userId } })

    expect(await prisma.oAuthConnection.findUnique({ where: { id: conn.id } })).toBeNull()
    expect(await prisma.mailAccount.findUnique({ where: { id: box.id } })).toBeNull()
    expect(await prisma.org.findUnique({ where: { id: org.orgId } })).not.toBeNull()
  })
})
