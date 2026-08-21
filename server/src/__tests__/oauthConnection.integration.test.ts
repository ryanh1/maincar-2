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

import { disconnectConnection } from '../lib/mail/oauthConnections.js'
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

  // --- disconnectConnection (IH-25) ------------------------------------------
  //
  // The route mocks disconnectConnection, so the unit suite only proves the shape of
  // the call. These prove the properties that shape exists to protect against a live
  // schema: the row and its mailbox actually leave, scoped to the rep; a disconnected
  // primary promotes the newest remaining mailbox; another rep's id changes nothing;
  // and an Email that pointed at the mailbox survives with a null pointer rather than
  // blocking the delete or being destroyed with it.

  /** Create a connection and its mailbox for a rep, with an explicit primary flag. */
  async function connect(
    orgId: string,
    userId: string,
    opts: { provider: string; providerAccountId: string; emailAddress: string; isPrimary?: boolean; createdAt?: Date },
  ): Promise<{ connectionId: string; mailboxId: string }> {
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId,
        userId,
        provider: opts.provider,
        providerAccountId: opts.providerAccountId,
        emailAddress: opts.emailAddress,
        refreshToken: 'v1.a.b.c',
      },
    })
    const box = await prisma.mailAccount.create({
      data: {
        orgId,
        userId,
        connectionId: conn.id,
        provider: opts.provider,
        emailAddress: opts.emailAddress,
        isPrimary: opts.isPrimary ?? false,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    })
    return { connectionId: conn.id, mailboxId: box.id }
  }

  it('deletes the connection and its mailbox, returning the provider', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const { connectionId, mailboxId } = await connect(org.orgId, org.adminUserId, {
      provider: 'google',
      providerAccountId: 'sub_dc',
      emailAddress: 'dc@example.com',
      isPrimary: true,
    })

    const result = await disconnectConnection(connectionId, org.orgId, org.adminUserId, prisma)

    expect(result).toEqual({ provider: 'google' })
    expect(await prisma.oAuthConnection.findUnique({ where: { id: connectionId } })).toBeNull()
    expect(await prisma.mailAccount.findUnique({ where: { id: mailboxId } })).toBeNull()
  })

  it('promotes the newest remaining mailbox when the disconnected one was primary', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const primary = await connect(org.orgId, org.adminUserId, {
      provider: 'google',
      providerAccountId: 'sub_primary',
      emailAddress: 'primary@example.com',
      isPrimary: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const older = await connect(org.orgId, org.adminUserId, {
      provider: 'microsoft',
      providerAccountId: 'oid_older',
      emailAddress: 'older@example.com',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    const newest = await connect(org.orgId, org.adminUserId, {
      provider: 'imap',
      providerAccountId: 'imap_newest',
      emailAddress: 'newest@example.com',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    })

    await disconnectConnection(primary.connectionId, org.orgId, org.adminUserId, prisma)

    // The newest remaining mailbox is the new primary, and it is the ONLY primary.
    const primaries = await prisma.mailAccount.findMany({
      where: { orgId: org.orgId, userId: org.adminUserId, isPrimary: true },
      select: { id: true },
    })
    expect(primaries.map((p) => p.id)).toEqual([newest.mailboxId])
    expect(
      (await prisma.mailAccount.findUniqueOrThrow({ where: { id: older.mailboxId } })).isPrimary,
    ).toBe(false)
  })

  it("returns null for another rep's connectionId, deleting nothing", async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)
    const { connectionId, mailboxId } = await connect(org.orgId, colleague.userId, {
      provider: 'google',
      providerAccountId: 'sub_colleague',
      emailAddress: colleague.email,
      isPrimary: true,
    })

    // The admin cannot disconnect the colleague's connection.
    const result = await disconnectConnection(connectionId, org.orgId, org.adminUserId, prisma)

    expect(result).toBeNull()
    expect(await prisma.oAuthConnection.findUnique({ where: { id: connectionId } })).not.toBeNull()
    expect(await prisma.mailAccount.findUnique({ where: { id: mailboxId } })).not.toBeNull()
  })

  it('orphans a synced Email rather than blocking the delete or destroying it', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const { connectionId, mailboxId } = await connect(org.orgId, org.adminUserId, {
      provider: 'google',
      providerAccountId: 'sub_email',
      emailAddress: 'mailbox@example.com',
      isPrimary: true,
    })
    const email = await prisma.email.create({
      data: {
        orgId: org.orgId,
        mailAccountId: mailboxId,
        direction: 'inbound',
        subject: 'kept',
        internetMessageId: '<test-message@example.com>',
      },
    })

    await disconnectConnection(connectionId, org.orgId, org.adminUserId, prisma)

    // The grant and the mailbox are gone; the message survives with a null pointer.
    expect(await prisma.oAuthConnection.findUnique({ where: { id: connectionId } })).toBeNull()
    expect(await prisma.mailAccount.findUnique({ where: { id: mailboxId } })).toBeNull()
    const survivor = await prisma.email.findUniqueOrThrow({ where: { id: email.id } })
    expect(survivor.mailAccountId).toBeNull()
    expect(survivor.subject).toBe('kept')
  })
})
