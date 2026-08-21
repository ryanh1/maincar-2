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
