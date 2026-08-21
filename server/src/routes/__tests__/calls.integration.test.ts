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
const TERMINAL_STATUSES = ['completed', 'canceled', 'busy', 'failed', 'no-answer']

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

/**
 * The GET list route's query body, verbatim: count and page the org's calls
 * against one where clause, ordered by the chosen column with a createdAt
 * tie-break. Pure Prisma — no raw SQL — so it runs straight through the test
 * client's schema adapter, unlike placeCall above.
 */
type ListSortField = 'createdAt' | 'toE164' | 'status' | 'durationS'

async function listCalls(
  prisma: PrismaClient,
  args: {
    orgId: string
    page?: number
    limit?: number
    sort?: ListSortField
    dir?: 'asc' | 'desc'
    q?: string
  },
): Promise<{ calls: { id: string; toE164: string; status: string; durationS: number | null }[]; total: number }> {
  const page = args.page ?? 1
  const limit = args.limit ?? 25
  const sort = args.sort ?? 'createdAt'
  const dir = args.dir ?? 'desc'
  const where = { orgId: args.orgId, ...(args.q ? { toE164: { contains: args.q } } : {}) }
  const orderBy =
    sort === 'createdAt'
      ? [{ createdAt: dir }]
      : [{ [sort]: dir }, { createdAt: 'desc' as const }]
  const [total, calls] = await Promise.all([
    prisma.call.count({ where }),
    prisma.call.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
  ])
  return { calls, total }
}

/**
 * The hang-up route's DB body, verbatim: read the call by id within its org,
 * refuse a terminal one, otherwise settle it to canceled with an endedAt under a
 * compare-and-set on the in-flight statuses. The Twilio hang-up itself is omitted
 * — it is network I/O proved against a mock in the unit suite; what only real
 * Postgres can prove is that the tenant-scoped read and the racing compare-and-set
 * behave as the route relies on.
 */
async function hangUp(
  prisma: PrismaClient,
  args: { orgId: string; id: string },
): Promise<'not-found' | 'already-ended' | 'canceled'> {
  const call = await prisma.call.findFirst({ where: { id: args.id, orgId: args.orgId } })
  if (!call) return 'not-found'
  if (TERMINAL_STATUSES.includes(call.status)) return 'already-ended'

  const settled = await prisma.call.updateMany({
    where: { id: args.id, orgId: args.orgId, status: { in: IN_FLIGHT_STATUSES } },
    data: { status: 'canceled', endedAt: new Date() },
  })
  if (settled.count === 0) return 'already-ended'
  return 'canceled'
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

// The list route's query against real Postgres: that pagination slices the set,
// that the toE164 search really narrows on a substring, that each sort column
// orders as asked, and — the tenant boundary on the READ — that one org's calls
// never appear in another's list.
describe('call history list (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('pages the org’s calls, and total counts the whole set', async () => {
    const org = await seedOrgWithAdmin(prisma)
    for (let i = 0; i < 3; i++) {
      await seedCall(prisma, {
        orgId: org.orgId,
        userId: org.adminUserId,
        toE164: `+1303555010${i}`,
        status: 'completed',
      })
    }

    const first = await listCalls(prisma, { orgId: org.orgId, page: 1, limit: 2 })
    expect(first.total).toBe(3)
    expect(first.calls).toHaveLength(2)

    const second = await listCalls(prisma, { orgId: org.orgId, page: 2, limit: 2 })
    expect(second.total).toBe(3)
    expect(second.calls).toHaveLength(1)

    // The two pages together cover the three rows with no overlap.
    const ids = new Set([...first.calls, ...second.calls].map((c) => c.id))
    expect(ids.size).toBe(3)
  })

  it('searches the destination number by a substring of digits', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164: '+12012223333' })
    await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164: '+14045556666' })

    const hit = await listCalls(prisma, { orgId: org.orgId, q: '201' })
    expect(hit.total).toBe(1)
    expect(hit.calls[0].toE164).toBe('+12012223333')
  })

  it('sorts by destination number ascending and descending', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164: '+13035550300' })
    await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164: '+13035550100' })
    await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, toE164: '+13035550200' })

    const asc = await listCalls(prisma, { orgId: org.orgId, sort: 'toE164', dir: 'asc' })
    expect(asc.calls.map((c) => c.toE164)).toEqual([
      '+13035550100',
      '+13035550200',
      '+13035550300',
    ])

    const desc = await listCalls(prisma, { orgId: org.orgId, sort: 'toE164', dir: 'desc' })
    expect(desc.calls.map((c) => c.toE164)).toEqual([
      '+13035550300',
      '+13035550200',
      '+13035550100',
    ])
  })

  it('sorts by billed duration', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const short = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035559001',
      status: 'completed',
    })
    const long = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035559002',
      status: 'completed',
    })
    // seedCall does not set durationS; the value the sort turns on is written here.
    await prisma.call.update({ where: { id: short.id }, data: { durationS: 5 } })
    await prisma.call.update({ where: { id: long.id }, data: { durationS: 500 } })

    const desc = await listCalls(prisma, { orgId: org.orgId, sort: 'durationS', dir: 'desc' })
    expect(desc.calls.map((c) => c.durationS)).toEqual([500, 5])
  })

  it('sorts by status', async () => {
    const org = await seedOrgWithAdmin(prisma)
    await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035558001',
      status: 'failed',
    })
    await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035558002',
      status: 'completed',
    })

    const asc = await listCalls(prisma, { orgId: org.orgId, sort: 'status', dir: 'asc' })
    expect(asc.calls.map((c) => c.status)).toEqual(['completed', 'failed'])
  })

  it('returns an empty page and a zero total for an org with no calls', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const result = await listCalls(prisma, { orgId: org.orgId })
    expect(result.total).toBe(0)
    expect(result.calls).toEqual([])
  })

  it('does not list another org’s calls', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    await seedCall(prisma, { orgId: orgA.orgId, userId: orgA.adminUserId, toE164: '+13035557001' })
    await seedCall(prisma, { orgId: orgB.orgId, userId: orgB.adminUserId, toE164: '+13035557002' })

    const listA = await listCalls(prisma, { orgId: orgA.orgId })
    expect(listA.total).toBe(1)
    expect(listA.calls[0].toE164).toBe('+13035557001')
    // Org B's call is absent from A's list — the boundary on the read.
    expect(listA.calls.some((c) => c.toE164 === '+13035557002')).toBe(false)
  })
})

// The detail route's read against real Postgres: that a single call comes back
// whole — transcript, recording key and all — when read by id within its org, and
// that the SAME id read from another org finds nothing. The id+orgId where clause
// is the tenant boundary MAI-28 turns 404 on; here it is proved against the real
// columns, not a mock. The presigning of the recording key is pure local signing
// with no Postgres in it, so it is proved in the unit suite (mocked) rather than
// here.
describe('single call detail (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('reads one call whole, transcript and recording key included, by id within the org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035556001',
      status: 'completed',
    })
    // seedCall sets neither the transcript nor the recording key; both — the
    // fields the detail route exists to return — are written here.
    await prisma.call.update({
      where: { id: seeded.id },
      data: {
        transcript: 'The whole conversation, word for word.',
        transcriptStatus: 'done',
        recordingEnabled: true,
        recordingUrl: 'recordings/call-detail.mp3',
        durationS: 42,
      },
    })

    // The route's read body, verbatim: id AND orgId together.
    const call = await prisma.call.findFirst({ where: { id: seeded.id, orgId: org.orgId } })

    expect(call).not.toBeNull()
    expect(call!.transcript).toBe('The whole conversation, word for word.')
    expect(call!.transcriptStatus).toBe('done')
    // The stored value is the bare object KEY the route signs at request time.
    expect(call!.recordingUrl).toBe('recordings/call-detail.mp3')
    expect(call!.durationS).toBe(42)
  })

  it('does not read a call that belongs to another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: orgB.orgId,
      userId: orgB.adminUserId,
      toE164: '+13035556002',
    })

    // Org A asks for Org B's call id. id alone would find it; id AND orgId must
    // not — the 404 the route returns lives in this null.
    const call = await prisma.call.findFirst({ where: { id: seeded.id, orgId: orgA.orgId } })
    expect(call).toBeNull()
  })
})

// The hang-up route's write against real Postgres: that an in-flight call really
// lands in "canceled" with an endedAt, that a terminal one is left untouched, that
// the id+orgId scope keeps one org from hanging up another's call, and — the
// concurrency proof — that the compare-and-set on the in-flight statuses lets only
// one of two racing hang-ups actually settle the row.
describe('hang up an active call (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('cancels an in-flight call and stamps endedAt', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035551201',
      status: 'in-progress',
      twilioCallSid: 'CAhangup1',
    })

    const result = await hangUp(prisma, { orgId: org.orgId, id: seeded.id })

    expect(result).toBe('canceled')
    const after = await prisma.call.findFirst({ where: { id: seeded.id, orgId: org.orgId } })
    expect(after!.status).toBe('canceled')
    expect(after!.endedAt).not.toBeNull()
  })

  it('cancels a queued call that never got a SID', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035551202',
      status: 'queued',
      twilioCallSid: null,
    })

    const result = await hangUp(prisma, { orgId: org.orgId, id: seeded.id })

    expect(result).toBe('canceled')
    const after = await prisma.call.findFirst({ where: { id: seeded.id, orgId: org.orgId } })
    expect(after!.status).toBe('canceled')
    expect(after!.endedAt).not.toBeNull()
  })

  it('refuses a call that has already ended, and leaves it untouched', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035551203',
      status: 'completed',
    })

    const result = await hangUp(prisma, { orgId: org.orgId, id: seeded.id })

    expect(result).toBe('already-ended')
    const after = await prisma.call.findFirst({ where: { id: seeded.id, orgId: org.orgId } })
    // Still completed — the terminal check wrote nothing.
    expect(after!.status).toBe('completed')
    expect(after!.endedAt).toBeNull()
  })

  it('does not hang up a call that belongs to another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: orgB.orgId,
      userId: orgB.adminUserId,
      toE164: '+13035551204',
      status: 'in-progress',
      twilioCallSid: 'CAhangup2',
    })

    // Org A asks to hang up Org B's call: id+orgId finds nothing → not-found.
    const result = await hangUp(prisma, { orgId: orgA.orgId, id: seeded.id })

    expect(result).toBe('not-found')
    // Org B's call is untouched — still in flight.
    const after = await prisma.call.findFirst({ where: { id: seeded.id, orgId: orgB.orgId } })
    expect(after!.status).toBe('in-progress')
    expect(after!.endedAt).toBeNull()
  })

  it('lets exactly one of two concurrent hang-ups settle the row', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const seeded = await seedCall(prisma, {
      orgId: org.orgId,
      userId: org.adminUserId,
      toE164: '+13035551205',
      status: 'ringing',
      twilioCallSid: 'CAhangup3',
    })

    const results = await Promise.all([
      hangUp(prisma, { orgId: org.orgId, id: seeded.id }),
      hangUp(prisma, { orgId: org.orgId, id: seeded.id }),
    ])

    // The compare-and-set means only one write finds an in-flight row to move; the
    // other reads it already gone from the in-flight set.
    expect(results.filter((r) => r === 'canceled')).toHaveLength(1)
    expect(results.filter((r) => r === 'already-ended')).toHaveLength(1)
    const after = await prisma.call.findFirst({ where: { id: seeded.id, orgId: org.orgId } })
    expect(after!.status).toBe('canceled')
  })
})
