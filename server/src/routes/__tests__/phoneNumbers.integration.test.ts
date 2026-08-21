// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it only proves the route ASKS for the right
// order. This proves Postgres actually returns it — and that the org and user
// filters really exclude the rows they are supposed to exclude.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  createTestPrisma,
  seedMember,
  seedOrgWithAdmin,
  seedPhoneNumber,
} from '../../test/integration/testPrisma.js'

// The route's own clause, verbatim. Running it through the real client is the
// point: a clause that typechecks can still sort wrong.
function listArgs(orgId: string, assignedUserId: string) {
  return {
    where: { orgId, assignedUserId },
    orderBy: [{ isActiveForOutbound: 'desc' as const }, { createdAt: 'asc' as const }],
  }
}

describe('PhoneNumber listing (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('puts the active number first, then the rest oldest first', async () => {
    const org = await seedOrgWithAdmin(prisma)

    // Written newest-first on purpose, so insertion order cannot be mistaken
    // for correct sorting.
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025550003',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    })
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025550002',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025550001',
      isActiveForOutbound: true,
      // The NEWEST row, so it can only lead if `isActiveForOutbound` wins.
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    })

    const rows = await prisma.phoneNumber.findMany(listArgs(org.orgId, org.adminUserId))

    expect(rows.map((r) => r.e164)).toEqual(['+12025550001', '+12025550002', '+12025550003'])
    expect(rows.filter((r) => r.isActiveForOutbound)).toHaveLength(1)
  })

  it('never returns a colleague’s number from the same org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)

    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025551111',
    })
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: colleague.userId,
      e164: '+12025552222',
    })

    const rows = await prisma.phoneNumber.findMany(listArgs(org.orgId, org.adminUserId))

    expect(rows.map((r) => r.e164)).toEqual(['+12025551111'])
  })

  it('never returns a number from another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgB.adminUserId,
      e164: '+12025559999',
    })

    const rows = await prisma.phoneNumber.findMany(listArgs(orgA.orgId, orgA.adminUserId))

    expect(rows).toHaveLength(0)
  })

  // The row is written before the number is bought, so these two columns must
  // really be nullable and defaulted in Postgres, not just in the schema file.
  it('stores a number that has no Twilio SID yet, as status "searching"', async () => {
    const org = await seedOrgWithAdmin(prisma)

    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025558888',
      twilioSid: null,
      status: 'searching',
    })

    const rows = await prisma.phoneNumber.findMany(listArgs(org.orgId, org.adminUserId))

    expect(rows[0].twilioSid).toBeNull()
    expect(rows[0].status).toBe('searching')
    expect(rows[0].isActiveForOutbound).toBe(false)
  })
})

// ============================================================
// The WRITE clauses, against real Postgres
// ============================================================
// The block above proves the READ clause. The unit suite proves the write
// clauses are ASKED FOR — it asserts the exact `where` object each route hands
// Prisma, against a mock that answers whatever the test told it to.
//
// What a mock can never answer is whether that clause actually matches the row.
// `updateMany({ where: { id, orgId } })` returning `count: 0` for another
// tenant's row is the whole tenant boundary on the write path, and until it runs
// against Postgres it is an assertion about a string, not about the database.

/** PATCH's un-picking write, verbatim. */
function clearOthersArgs(orgId: string, assignedUserId: string, keepId: string) {
  return {
    where: { orgId, assignedUserId, isActiveForOutbound: true, id: { not: keepId } },
    data: { isActiveForOutbound: false },
  }
}

/** PATCH's activating write, verbatim. */
function activateArgs(id: string, orgId: string, assignedUserId: string) {
  return {
    where: { id, orgId, assignedUserId },
    data: { isActiveForOutbound: true },
  }
}

describe('PhoneNumber activation (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // The radio-button invariant, run for real: picking one number is what
  // un-picks the rest, and the two writes have to compose to exactly one active
  // row. Two actives means two caller IDs and no rule for choosing; zero means
  // the user cannot place a call at all.
  it('leaves exactly one active number after a switch', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const old = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    const next = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: false,
    })

    await prisma.$transaction(async (tx) => {
      await tx.phoneNumber.updateMany(clearOthersArgs(org.orgId, org.adminUserId, next.id))
      await tx.phoneNumber.updateMany(activateArgs(next.id, org.orgId, org.adminUserId))
    })

    const active = await prisma.phoneNumber.findMany({
      where: { orgId: org.orgId, assignedUserId: org.adminUserId, isActiveForOutbound: true },
    })
    expect(active.map((r) => r.id)).toEqual([next.id])

    const previous = await prisma.phoneNumber.findFirst({ where: { id: old.id } })
    expect(previous!.isActiveForOutbound).toBe(false)
  })

  // The `id: { not: id }` clause exists so re-picking the number that is already
  // active is a no-op rather than a switch-off-then-on. Postgres is what proves
  // the exclusion works, not just that the clause parses.
  it('re-activating the number that is already active leaves it active', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const only = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })

    const cleared = await prisma.phoneNumber.updateMany(
      clearOthersArgs(org.orgId, org.adminUserId, only.id),
    )

    // Nothing to clear: the one active row is the one being kept.
    expect(cleared.count).toBe(0)
    const row = await prisma.phoneNumber.findFirst({ where: { id: only.id } })
    expect(row!.isActiveForOutbound).toBe(true)
  })

  // The tenant boundary on the WRITE path. A caller in Org A naming a row id
  // that lives in Org B reaches this clause with their own orgId, and it has to
  // match nothing — which is what the route reads as 404.
  it('writes nothing when the row id belongs to another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const theirs = await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgB.adminUserId,
      isActiveForOutbound: false,
    })

    const result = await prisma.phoneNumber.updateMany(
      activateArgs(theirs.id, orgA.orgId, orgA.adminUserId),
    )

    expect(result.count).toBe(0)
    const untouched = await prisma.phoneNumber.findFirst({ where: { id: theirs.id } })
    expect(untouched!.isActiveForOutbound).toBe(false)
  })

  // The test above cannot, on its own, prove the orgId key is load-bearing: the
  // two orgs have different admins, so `assignedUserId` alone already excludes
  // the row. THIS is the case that isolates orgId — one person, a member of two
  // orgs, holding a number in each. `assignedUserId` matches both rows, and the
  // only thing standing between a caller acting in Org A and a row in Org B is
  // the tenant key. This app is multi-org by design, so this is a real shape.
  it('writes nothing when the SAME user holds the row in their other org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    // One person, two orgs. Only the tenant key separates their two numbers.
    await prisma.membership.create({
      data: { userId: orgA.adminUserId, orgId: orgB.orgId, roles: ['basic'] },
    })
    const inOrgB = await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgA.adminUserId,
      isActiveForOutbound: false,
    })

    // Acting in Org A, naming the id of the row that lives in Org B.
    const result = await prisma.phoneNumber.updateMany(
      activateArgs(inOrgB.id, orgA.orgId, orgA.adminUserId),
    )

    expect(result.count).toBe(0)
    const untouched = await prisma.phoneNumber.findFirst({ where: { id: inOrgB.id } })
    expect(untouched!.isActiveForOutbound).toBe(false)
  })

  // The same isolation for the un-picking write: switching caller ID in Org A
  // must not switch off the number this same person uses in Org B.
  it('does not clear the same user’s active number in their other org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    await prisma.membership.create({
      data: { userId: orgA.adminUserId, orgId: orgB.orgId, roles: ['basic'] },
    })

    const activeInOrgB = await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgA.adminUserId,
      isActiveForOutbound: true,
    })
    await seedPhoneNumber(prisma, {
      orgId: orgA.orgId,
      assignedUserId: orgA.adminUserId,
      isActiveForOutbound: true,
    })
    const nextInOrgA = await seedPhoneNumber(prisma, {
      orgId: orgA.orgId,
      assignedUserId: orgA.adminUserId,
    })

    await prisma.$transaction(async (tx) => {
      await tx.phoneNumber.updateMany(clearOthersArgs(orgA.orgId, orgA.adminUserId, nextInOrgA.id))
      await tx.phoneNumber.updateMany(activateArgs(nextInOrgA.id, orgA.orgId, orgA.adminUserId))
    })

    const orgBRow = await prisma.phoneNumber.findFirst({ where: { id: activeInOrgB.id } })
    expect(orgBRow!.isActiveForOutbound).toBe(true)
  })

  // The same boundary one step in: a colleague in the SAME org. orgId alone
  // would match here, so this is what the assignedUserId key is for.
  it('writes nothing when the row belongs to a colleague in the same org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)
    const theirs = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: colleague.userId,
      isActiveForOutbound: false,
    })

    const result = await prisma.phoneNumber.updateMany(
      activateArgs(theirs.id, org.orgId, org.adminUserId),
    )

    expect(result.count).toBe(0)
  })

  // Switching my own caller ID must not switch off a colleague's. They each get
  // one active number, and the clearing write is scoped so it cannot reach past
  // the person making the change.
  it('does not clear a colleague’s active number when I switch mine', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)
    const theirs = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: colleague.userId,
      isActiveForOutbound: true,
    })
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      isActiveForOutbound: true,
    })
    const mine = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
    })

    await prisma.$transaction(async (tx) => {
      await tx.phoneNumber.updateMany(clearOthersArgs(org.orgId, org.adminUserId, mine.id))
      await tx.phoneNumber.updateMany(activateArgs(mine.id, org.orgId, org.adminUserId))
    })

    const colleagueRow = await prisma.phoneNumber.findFirst({ where: { id: theirs.id } })
    expect(colleagueRow!.isActiveForOutbound).toBe(true)
  })
})

// ============================================================
// The buy route's ownership lookup, against real Postgres
// ============================================================
// This one read decides whether the org is about to rent a SECOND number at the
// same monthly price. Its status filter is the difference between "you already
// have this" and "your last attempt failed, try again", and only Postgres can
// say whether the `in` list really excludes what it is meant to exclude.
const OWNED_STATUSES = ['searching', 'active', 'releasing']

function ownedLookupArgs(orgId: string, e164: string) {
  return { where: { orgId, e164, status: { in: OWNED_STATUSES } }, select: { id: true } }
}

describe('PhoneNumber ownership lookup (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it.each(OWNED_STATUSES)('finds a %s row, so a second purchase is refused', async (status) => {
    const org = await seedOrgWithAdmin(prisma)
    const e164 = `+1202555${Math.floor(1000 + Math.random() * 8999)}`
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164,
      status,
    })

    const found = await prisma.phoneNumber.findFirst(ownedLookupArgs(org.orgId, e164))

    expect(found).not.toBeNull()
  })

  // The row a retry has to get past. A failed purchase never happened, and the
  // person clicking buy again is clicking BECAUSE of it — treating it as
  // ownership would strand them on a number they can see and can never have.
  it('does not find a failed row, so the retry goes through', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const e164 = `+1202555${Math.floor(1000 + Math.random() * 8999)}`
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164,
      status: 'failed',
    })

    const found = await prisma.phoneNumber.findFirst(ownedLookupArgs(org.orgId, e164))

    expect(found).toBeNull()
  })

  // Org-wide, not per-user: the ORG owns a number and merely assigns it, so a
  // colleague already holding it is what makes this a 409.
  it('finds a colleague’s number, because the org owns it, not the member', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)
    const e164 = `+1202555${Math.floor(1000 + Math.random() * 8999)}`
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: colleague.userId,
      e164,
      status: 'active',
    })

    const found = await prisma.phoneNumber.findFirst(ownedLookupArgs(org.orgId, e164))

    expect(found).not.toBeNull()
  })

  // And it must NOT see across tenants. Another org holding the number is
  // deliberately invisible: reading their rows to answer this would break the
  // boundary that makes the app multi-tenant. Twilio refuses the second sale.
  it('does not find the same number held by another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const e164 = `+1202555${Math.floor(1000 + Math.random() * 8999)}`
    await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgB.adminUserId,
      e164,
      status: 'active',
    })

    const found = await prisma.phoneNumber.findFirst(ownedLookupArgs(orgA.orgId, e164))

    expect(found).toBeNull()
  })
})

// ============================================================
// The provisioning job's compare-and-set, against real Postgres
// ============================================================
// The single most expensive clause in the codebase. pg-boss is at-least-once, so
// the same job CAN be delivered twice; `status: "searching"` in the where clause
// is what makes the second delivery write nothing instead of recording a second
// purchase. A mock returning `{ count: 0 }` because a test said so proves that
// the code reads the count — not that Postgres produces it.
describe('PhoneNumber provisioning compare-and-set (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  /** The job's success write, verbatim. */
  function settleArgs(id: string, orgId: string, sid: string) {
    return {
      where: { id, orgId, status: 'searching' },
      data: { status: 'active', twilioSid: sid },
    }
  }

  it('turns a searching row active with the SID, in one write', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const row = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      status: 'searching',
      twilioSid: null,
    })

    const result = await prisma.phoneNumber.updateMany(
      settleArgs(row.id, org.orgId, 'PNfirstdelivery'),
    )

    expect(result.count).toBe(1)
    const settled = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(settled!.status).toBe('active')
    expect(settled!.twilioSid).toBe('PNfirstdelivery')
  })

  // The duplicate delivery. The row is no longer "searching", so the second
  // write matches nothing — and, critically, does not overwrite the SID of the
  // number the org is already paying for.
  it('writes nothing on a second delivery, and keeps the first SID', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const row = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      status: 'searching',
      twilioSid: null,
    })

    await prisma.phoneNumber.updateMany(settleArgs(row.id, org.orgId, 'PNfirstdelivery'))
    const second = await prisma.phoneNumber.updateMany(
      settleArgs(row.id, org.orgId, 'PNseconddelivery'),
    )

    // count 0 is the signal the job logs loudly on — the shape a leaked,
    // paid-for number would have.
    expect(second.count).toBe(0)
    const settled = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(settled!.twilioSid).toBe('PNfirstdelivery')
  })

  // The failure write is the same shape, and must be just as unable to drag a
  // settled row backwards. A retry that arrives after a success must not turn an
  // active, paid-for number into "failed".
  it('cannot mark an already-active row failed', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const row = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      status: 'active',
    })

    const result = await prisma.phoneNumber.updateMany({
      where: { id: row.id, orgId: org.orgId, status: 'searching' },
      data: { status: 'failed' },
    })

    expect(result.count).toBe(0)
    const still = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(still!.status).toBe('active')
  })
})

// ============================================================
// MAI-197 — the org-wide view and the handover, against real Postgres
// ============================================================
// The unit suite mocks Prisma, so it proves the routes ASK correctly. Only a real
// Postgres can prove the column is genuinely nullable, that the join returns the
// holder, that the org filter really excludes the other tenant, and that the
// active-number invariant survives an actual handover.
describe('PhoneNumber org-wide view and assignment (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  /** The admin list route's own clause, verbatim. */
  function orgListArgs(orgId: string) {
    return {
      where: { orgId },
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' as const }],
    }
  }

  /** The assignment route's own write, verbatim. */
  function handoverArgs(id: string, orgId: string, assignedUserId: string | null) {
    return {
      where: { id, orgId },
      data: { assignedUserId, isActiveForOutbound: false },
    }
  }

  // The migration, proved rather than assumed. `assignedUserId String?` in the
  // schema file means nothing if the column in Postgres is still NOT NULL.
  it('stores a number that nobody holds', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const row = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: null,
      e164: '+12025557001',
    })

    const stored = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(stored!.assignedUserId).toBeNull()
  })

  it('returns a COLLEAGUE’s number, with the holder’s name and email joined on', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const colleague = await seedMember(prisma, org.orgId)

    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: colleague.userId,
      e164: '+12025557002',
    })

    const rows = await prisma.phoneNumber.findMany(orgListArgs(org.orgId))

    // The per-user list would return nothing here. That gap is the bug MAI-197
    // reports: an admin could not answer "which number belongs to which rep".
    expect(rows).toHaveLength(1)
    expect(rows[0].assignedUser!.id).toBe(colleague.userId)
    expect(rows[0].assignedUser!.email).toBe(colleague.email)
  })

  it('joins null for a number nobody holds, rather than dropping the row', async () => {
    const org = await seedOrgWithAdmin(prisma)

    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: null,
      e164: '+12025557003',
    })

    const rows = await prisma.phoneNumber.findMany(orgListArgs(org.orgId))

    // A join that dropped it would hide a number the org is still paying for —
    // the one row an inventory view most needs to show.
    expect(rows).toHaveLength(1)
    expect(rows[0].assignedUser).toBeNull()
  })

  it('never returns a number from another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgB.adminUserId,
      e164: '+12025557004',
    })
    await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: null,
      e164: '+12025557005',
    })

    const rows = await prisma.phoneNumber.findMany(orgListArgs(orgA.orgId))

    expect(rows).toHaveLength(0)
  })

  it('orders the inventory newest first', async () => {
    const org = await seedOrgWithAdmin(prisma)

    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025557010',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: null,
      e164: '+12025557011',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    })
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025557012',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    })

    const rows = await prisma.phoneNumber.findMany(orgListArgs(org.orgId))

    expect(rows.map((r) => r.e164)).toEqual(['+12025557011', '+12025557012', '+12025557010'])
  })

  // The invariant MAI-197 names, proved end to end on real rows: the new holder
  // already has an active number of their own, and the handover must not give
  // them a second one.
  it('a handover cannot leave one user with two active outbound numbers', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const rep = await seedMember(prisma, org.orgId)

    // The rep's own caller ID, untouched by any of this.
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: rep.userId,
      e164: '+12025557020',
      isActiveForOutbound: true,
    })
    // The admin's caller ID, about to be handed to the rep.
    const moving = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: org.adminUserId,
      e164: '+12025557021',
      isActiveForOutbound: true,
    })

    await prisma.phoneNumber.updateMany(handoverArgs(moving.id, org.orgId, rep.userId))

    const repsNumbers = await prisma.phoneNumber.findMany({
      where: { orgId: org.orgId, assignedUserId: rep.userId },
    })
    expect(repsNumbers).toHaveLength(2)
    // Two numbers, exactly one caller ID. Carrying the flag across would have
    // made this 2, and nothing in the schema would have caught it.
    expect(repsNumbers.filter((n) => n.isActiveForOutbound)).toHaveLength(1)
    expect(repsNumbers.find((n) => n.isActiveForOutbound)!.e164).toBe('+12025557020')
  })

  it('taking a number back clears both the holder and the caller ID', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const rep = await seedMember(prisma, org.orgId)
    const row = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: rep.userId,
      e164: '+12025557030',
      isActiveForOutbound: true,
    })

    await prisma.phoneNumber.updateMany(handoverArgs(row.id, org.orgId, null))

    const stored = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(stored!.assignedUserId).toBeNull()
    // A caller ID with no caller cannot place a call, so this pair is the only
    // honest state for an unassigned number.
    expect(stored!.isActiveForOutbound).toBe(false)
  })

  // The tenant boundary, on the write rather than the read. `updateMany` scoped
  // by orgId is what makes a guessed id from another org write nothing.
  it('cannot hand over a number that belongs to another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const row = await seedPhoneNumber(prisma, {
      orgId: orgB.orgId,
      assignedUserId: orgB.adminUserId,
      e164: '+12025557040',
    })

    const result = await prisma.phoneNumber.updateMany(
      handoverArgs(row.id, orgA.orgId, orgA.adminUserId),
    )

    // count 0 is what the route turns into a 404.
    expect(result.count).toBe(0)
    const untouched = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(untouched!.assignedUserId).toBe(orgB.adminUserId)
  })

  // The route's own target lookup. A removed member's seat is isActive:false, so
  // offboarding takes effect here too and no number can be handed to them.
  it('finds no seat for a member whose membership has been deactivated', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const leaver = await seedMember(prisma, org.orgId)
    await prisma.membership.updateMany({
      where: { userId: leaver.userId, orgId: org.orgId },
      data: { isActive: false },
    })

    const seat = await prisma.membership.findFirst({
      where: { userId: leaver.userId, orgId: org.orgId, isActive: true },
      select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })

    expect(seat).toBeNull()
  })

  it('finds no seat for a member of a DIFFERENT org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    const seat = await prisma.membership.findFirst({
      where: { userId: orgB.adminUserId, orgId: orgA.orgId, isActive: true },
      select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })

    // Without this scoping, a user id straight off the request body could put
    // another tenant's user on this org's number.
    expect(seat).toBeNull()
  })

  // The Restrict on the relation, still standing after the column went nullable.
  // Releasing a number is a Twilio call, not a row delete, so a user who still
  // holds one must not be deletable out from under it.
  it('still refuses to delete a user who holds a number', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const rep = await seedMember(prisma, org.orgId)
    await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: rep.userId,
      e164: '+12025557050',
    })

    await expect(prisma.user.delete({ where: { id: rep.userId } })).rejects.toThrow()
  })

  // And the other half: once the number is taken back, the Restrict has nothing
  // to hold on to. This is the departing-rep path the issue describes.
  it('lets the same user be deleted once the number is taken back', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const leaver = await seedMember(prisma, org.orgId)
    const row = await seedPhoneNumber(prisma, {
      orgId: org.orgId,
      assignedUserId: leaver.userId,
      e164: '+12025557051',
    })

    await prisma.phoneNumber.updateMany(handoverArgs(row.id, org.orgId, null))
    await prisma.membership.deleteMany({ where: { userId: leaver.userId } })

    await expect(prisma.user.delete({ where: { id: leaver.userId } })).resolves.toBeTruthy()
    // The number outlives them, still rented, still visible to the admin.
    const orphan = await prisma.phoneNumber.findFirst({ where: { id: row.id } })
    expect(orphan!.assignedUserId).toBeNull()
  })
})
