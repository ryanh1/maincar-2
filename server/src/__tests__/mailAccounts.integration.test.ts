// Integration tests for mailAccounts.ts against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it only proves the SHAPE of the calls
// setPrimaryMailbox makes. This proves the property that shape exists to protect:
// "exactly one mailbox per (orgId, userId) is primary" survives two concurrent
// switches — they can neither both win (two primaries) nor cancel out (zero). That
// guarantee is the whole reason the clear and the set live in one transaction, and
// a mock cannot exercise the row locking that makes it hold.
//
// The functions take an injected client so they run against this suite's isolated
// schema rather than the app's singleton. Run with `npm run test:integration`,
// Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deleteMailbox, setPrimaryMailbox, upsertMailAccount } from '../lib/mail/mailAccounts.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../test/integration/testPrisma.js'

describe('mailAccounts (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  /** Seed one OAuthConnection + its mailbox (via the real upsert) for a rep. */
  async function connectMailbox(
    org: { orgId: string; adminUserId: string },
    opts: { provider: string; providerAccountId: string; emailAddress: string },
  ): Promise<string> {
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: opts.provider,
        providerAccountId: opts.providerAccountId,
        emailAddress: opts.emailAddress,
        refreshToken: 'v1.a.b.c',
      },
    })
    const box = await upsertMailAccount(
      {
        orgId: org.orgId,
        userId: org.adminUserId,
        connectionId: conn.id,
        provider: opts.provider,
        emailAddress: opts.emailAddress,
      },
      prisma,
    )
    return box.id
  }

  const primaryCount = (orgId: string, userId: string) =>
    prisma.mailAccount.count({ where: { orgId, userId, isPrimary: true } })

  it('makes the first mailbox primary and a second one not', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const firstId = await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_first',
      emailAddress: 'first@example.com',
    })
    const secondId = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_second',
      emailAddress: 'second@example.com',
    })

    const first = await prisma.mailAccount.findUniqueOrThrow({ where: { id: firstId } })
    const second = await prisma.mailAccount.findUniqueOrThrow({ where: { id: secondId } })
    expect(first.isPrimary).toBe(true)
    expect(second.isPrimary).toBe(false)
    expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
  })

  it('promoting the second mailbox leaves exactly one primary', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_a',
      emailAddress: 'a@example.com',
    })
    const secondId = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_b',
      emailAddress: 'b@example.com',
    })

    const result = await setPrimaryMailbox(secondId, org.orgId, org.adminUserId, prisma)

    expect(result).not.toBeNull()
    expect(result!.filter((b) => b.isPrimary).map((b) => b.id)).toEqual([secondId])
    expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
  })

  it('upserting the same address twice leaves one row and keeps it primary', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const conn = await prisma.oAuthConnection.create({
      data: {
        orgId: org.orgId,
        userId: org.adminUserId,
        provider: 'google',
        providerAccountId: 'sub_dup',
        emailAddress: 'dup@example.com',
        refreshToken: 'v1.a.b.c',
      },
    })
    const input = {
      orgId: org.orgId,
      userId: org.adminUserId,
      connectionId: conn.id,
      provider: 'google',
      emailAddress: 'dup@example.com',
    }

    const firstBox = await upsertMailAccount(input, prisma)
    const secondBox = await upsertMailAccount(input, prisma)

    expect(secondBox.id).toBe(firstBox.id)
    const rows = await prisma.mailAccount.findMany({
      where: { orgId: org.orgId, emailAddress: 'dup@example.com' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].isPrimary).toBe(true) // first-connect primary survives the re-upsert
  })

  it('returns null for a mailbox id that is not this rep’s, changing nothing', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    // A real, primary mailbox in org A. Org B must not be able to move it, and the
    // clear-then-set must not run and strand org A with zero primaries.
    const boxAId = await connectMailbox(orgA, {
      provider: 'google',
      providerAccountId: 'sub_orga',
      emailAddress: 'owner@example.com',
    })

    const result = await setPrimaryMailbox(boxAId, orgB.orgId, orgB.adminUserId, prisma)

    expect(result).toBeNull()
    // Org A's mailbox is untouched — still primary.
    expect((await prisma.mailAccount.findUniqueOrThrow({ where: { id: boxAId } })).isPrimary).toBe(
      true,
    )
    expect(await primaryCount(orgA.orgId, orgA.adminUserId)).toBe(1)
  })

  it('deleting the primary promotes the most recently connected remaining mailbox', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const firstId = await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_del_first',
      emailAddress: 'del-first@example.com',
    })
    const secondId = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_del_second',
      emailAddress: 'del-second@example.com',
    })
    // The first is primary (first-connect). Delete it; the newest remaining (second)
    // must inherit the flag so the rep is never left able to receive but not send.
    const remaining = await deleteMailbox(firstId, org.orgId, org.adminUserId, prisma)

    expect(remaining!.map((b) => b.id)).toEqual([secondId])
    expect(remaining!.filter((b) => b.isPrimary).map((b) => b.id)).toEqual([secondId])
    expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
  })

  it('deleting a NON-primary mailbox leaves the existing primary untouched', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const firstId = await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_keep_first',
      emailAddress: 'keep-first@example.com',
    })
    const secondId = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_keep_second',
      emailAddress: 'keep-second@example.com',
    })
    // first is primary; deleting the second (non-primary) must not move the flag.
    await deleteMailbox(secondId, org.orgId, org.adminUserId, prisma)

    expect((await prisma.mailAccount.findUniqueOrThrow({ where: { id: firstId } })).isPrimary).toBe(true)
    expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
  })

  it('deleting the only mailbox leaves none, and no error', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const onlyId = await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_only',
      emailAddress: 'only@example.com',
    })

    const remaining = await deleteMailbox(onlyId, org.orgId, org.adminUserId, prisma)

    expect(remaining).toEqual([])
    expect(await prisma.mailAccount.count({ where: { orgId: org.orgId, userId: org.adminUserId } })).toBe(0)
  })

  it('returns null for a delete of a mailbox that is not this rep’s, changing nothing', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const boxAId = await connectMailbox(orgA, {
      provider: 'google',
      providerAccountId: 'sub_del_orga',
      emailAddress: 'owner-del@example.com',
    })

    const result = await deleteMailbox(boxAId, orgB.orgId, orgB.adminUserId, prisma)

    expect(result).toBeNull()
    // Org A's mailbox survives, still primary.
    expect((await prisma.mailAccount.findUniqueOrThrow({ where: { id: boxAId } })).isPrimary).toBe(true)
  })

  it('two concurrent switches leave exactly one primary — never two, never zero', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const boxA = await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_race_a',
      emailAddress: 'race-a@example.com',
    })
    const boxB = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_race_b',
      emailAddress: 'race-b@example.com',
    })

    // Run the race several times. Without the row lock the first updateMany takes,
    // an interleaving exists where both transactions clear, then each sets its own
    // target, leaving TWO primaries. The single-transaction clear-then-set makes
    // the later switch wait on the lock, so the invariant holds every iteration.
    for (let i = 0; i < 12; i += 1) {
      await Promise.all([
        setPrimaryMailbox(boxA, org.orgId, org.adminUserId, prisma),
        setPrimaryMailbox(boxB, org.orgId, org.adminUserId, prisma),
      ])

      const primaries = await prisma.mailAccount.findMany({
        where: { orgId: org.orgId, userId: org.adminUserId, isPrimary: true },
        select: { id: true },
      })
      expect(primaries).toHaveLength(1)
      expect([boxA, boxB]).toContain(primaries[0].id)
    }
  })
})
