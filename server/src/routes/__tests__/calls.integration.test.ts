// The outbound-call guard against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it can only prove the route ASKS for a lock and
// the right in-flight clause. This proves Postgres actually honours them: that two
// clicks arriving at once cannot both become calls, and that the in-flight check's
// orgId/userId/toE164 keys really exclude the rows they are meant to.
// Run with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  createTestPrisma,
  seedCall,
  seedOrgWithAdmin,
  seedPhoneNumber,
} from '../../test/integration/testPrisma.js'

const IN_FLIGHT_STATUSES = ['queued', 'ringing', 'in-progress']

/**
 * The route's guard body, verbatim: lock the caller's active number, refuse when
 * a call to this number is already in flight, otherwise write the queued row.
 *
 * The `search_path` line is a harness detail, not part of the route. This suite
 * runs in a per-run schema, and an unqualified table name in RAW SQL does not
 * inherit the adapter's schema option the way a Prisma query does. Production
 * runs on the default schema, so the route needs no equivalent.
 */
async function placeCall(
  prisma: PrismaClient,
  args: { orgId: string; userId: string; toE164: string },
): Promise<'created' | 'refused' | 'no-number'> {
  const schema = inject('testSchema')
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
      const locked = await tx.$queryRaw<{ id: string; e164: string }[]>`
        SELECT "id", "e164" FROM "PhoneNumber"
        WHERE "orgId" = ${args.orgId}
          AND "assignedUserId" = ${args.userId}
          AND "isActiveForOutbound" = true
        FOR UPDATE
      `
      if (locked.length === 0) throw new Error('NO_NUMBER')
      const fromE164 = locked[0].e164

      const existing = await tx.call.findFirst({
        where: {
          orgId: args.orgId,
          userId: args.userId,
          toE164: args.toE164,
          status: { in: IN_FLIGHT_STATUSES },
        },
      })
      if (existing) throw new Error('DOUBLE_CALL')

      await tx.call.create({
        data: {
          orgId: args.orgId,
          userId: args.userId,
          fromE164,
          toE164: args.toE164,
          direction: 'outbound',
          status: 'queued',
          recordingConsent: 'granted',
        },
      })
    })
    return 'created'
  } catch (err) {
    if (err instanceof Error && err.message === 'DOUBLE_CALL') return 'refused'
    if (err instanceof Error && err.message === 'NO_NUMBER') return 'no-number'
    throw err
  }
}

function countCalls(prisma: PrismaClient, orgId: string, toE164: string): Promise<number> {
  return prisma.call.count({ where: { orgId, toE164 } })
}

function countQueued(prisma: PrismaClient, orgId: string, toE164: string): Promise<number> {
  return prisma.call.count({ where: { orgId, toE164, status: 'queued' } })
}

describe('outbound-call guard (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates one queued call when the caller has an active number', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    const toE164 = '+13035550111'

    const result = await placeCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164 })

    expect(result).toBe('created')
    expect(await countCalls(prisma, org.orgId, toE164)).toBe(1)
  })

  it('refuses when the caller has no active number, and writes nothing', async () => {
    const org = await seedOrgWithAdmin(prisma)
    // A number that exists but is NOT active for outbound must not qualify.
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: false,
    })
    const toE164 = '+13035550222'

    const result = await placeCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164 })

    expect(result).toBe('no-number')
    expect(await countCalls(prisma, org.orgId, toE164)).toBe(0)
  })

  it('refuses a second call while one to the same number is in flight', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    const toE164 = '+13035550333'
    await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164,
      status: 'ringing',
    })

    const result = await placeCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164 })

    expect(result).toBe('refused')
    // Only the seeded in-flight call exists; no second was written.
    expect(await countCalls(prisma, org.orgId, toE164)).toBe(1)
  })

  it('allows a call once the earlier one to that number has ended', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    const toE164 = '+13035550444'
    // A terminal call is not "in flight": dialing the number again is wanted.
    await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164,
      status: 'completed',
    })

    const result = await placeCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164 })

    expect(result).toBe('created')
    // The terminal call stays; a fresh queued one is added beside it.
    expect(await countCalls(prisma, org.orgId, toE164)).toBe(2)
    expect(await countQueued(prisma, org.orgId, toE164)).toBe(1)
  })

  it('allows a call to a different number while one is in flight', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035550555',
      status: 'ringing',
    })
    const other = '+13035550556'

    const result = await placeCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: other,
    })

    expect(result).toBe('created')
    expect(await countCalls(prisma, org.orgId, other)).toBe(1)
  })

  // The tenant boundary on the guard's READ. A call in another org to the same
  // number must not be read as "in flight" here, or Org B's call would block
  // Org A's — the leak this key exists to stop.
  it('is not blocked by an in-flight call to the same number in another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    await seedPhoneNumber(prisma, {
      orgId: orgA.orgId,
      assignedUserId: orgA.adminUserId,
      isActiveForOutbound: true,
    })
    const toE164 = '+13035550777'
    await seedCall(prisma, {
      orgId: orgB.orgId,
      userId: orgB.adminUserId,
      toE164,
      status: 'ringing',
    })

    const result = await placeCall(prisma, {
      orgId: orgA.orgId,
      userId: orgA.adminUserId,
      toE164,
    })

    expect(result).toBe('created')
    expect(await countCalls(prisma, orgA.orgId, toE164)).toBe(1)
  })

  // The concurrency proof. Two identical requests arrive at once; the FOR UPDATE
  // lock on the one active number serialises them, so the second reads the
  // first's committed queued row and is refused. Delete the lock and both read
  // "nothing in flight" and both insert — this is what fails then.
  it('lets exactly one of two concurrent calls to the same number through', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    const toE164 = '+13035550888'

    const results = await Promise.all([
      placeCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164 }),
      placeCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164 }),
    ])

    expect(results.filter((r) => r === 'created')).toHaveLength(1)
    expect(results.filter((r) => r === 'refused')).toHaveLength(1)
    expect(await countCalls(prisma, org.orgId, toE164)).toBe(1)
  })
})
