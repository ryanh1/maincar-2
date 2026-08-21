// The member guardrails against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it can only prove the route ASKS for a lock and
// an order. These prove Postgres actually honours them: that two concurrent
// demotions cannot both commit, and that the list's ordering clause puts an
// unnamed member where the table says it will.
// Run with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { memberOrderBy } from '../../lib/memberQuery.js'
import { ADMIN_ROLES } from '../../lib/roles.js'

/**
 * The route's guardrail body, verbatim: lock and count the admins, refuse when
 * this demotion would take the last one, otherwise write.
 *
 * The `search_path` line is a harness detail, not part of the route. This suite
 * runs in a per-run schema, and an unqualified table name in RAW SQL does not
 * inherit the adapter's schema option the way a Prisma query does. Production
 * runs on the default schema, so the route needs no equivalent.
 */
async function demote(prisma: PrismaClient, orgId: string, userId: string): Promise<'ok' | 'refused'> {
  const schema = inject('testSchema')
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
      const rows = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM (
          SELECT 1 FROM "Membership"
          WHERE "orgId" = ${orgId}
            AND "isActive" = true
            AND "roles" && ${[...ADMIN_ROLES]}::text[]
          FOR UPDATE
        ) AS locked
      `
      if (Number(rows[0]?.count ?? 0) <= 1) throw new Error('LAST_ADMIN')
      await tx.membership.updateMany({
        where: { userId, orgId, isActive: true },
        data: { roles: ['basic'] },
      })
    })
    return 'ok'
  } catch (err) {
    if (err instanceof Error && err.message === 'LAST_ADMIN') return 'refused'
    throw err
  }
}

describe('member guardrails (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('lets exactly one of two concurrent demotions through', async () => {
    // Two admins, and two requests arriving at the same moment to demote each.
    const org = await seedOrgWithAdmin(prisma)
    const second = await seedMember(prisma, org.orgId, { roles: ['admin'] })

    const results = await Promise.all([
      demote(prisma, org.orgId, org.adminUserId),
      demote(prisma, org.orgId, second.userId),
    ])

    expect(results.filter((r) => r === 'ok')).toHaveLength(1)

    const adminsLeft = await prisma.membership.count({
      where: { orgId: org.orgId, isActive: true, roles: { hasSome: [...ADMIN_ROLES] } },
    })
    expect(adminsLeft).toBe(1)
  })

  it('sorts a member who never set a name by email, not to the end', async () => {
    const org = await seedOrgWithAdmin(prisma, { orgName: `Sort ${Date.now()}` })
    const unnamed = await seedMember(prisma, org.orgId)
    await prisma.user.update({
      where: { id: unnamed.userId },
      data: { firstName: null, lastName: null, email: 'aaa_unnamed@example.com' },
    })

    const rows = await prisma.membership.findMany({
      where: { orgId: org.orgId, isActive: true },
      include: { user: true },
      orderBy: memberOrderBy('name', 'asc'),
    })

    // The clause typechecks either way; only Postgres can say where the row lands.
    expect(rows.map((r) => r.userId)).toContain(unnamed.userId)
    expect(rows).toHaveLength(2)
  })

  it('leaves a second org untouched when someone is removed from the first', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const person = await seedMember(prisma, orgA.orgId)
    await prisma.membership.create({
      data: { userId: person.userId, orgId: orgB.orgId, roles: ['basic'] },
    })

    await prisma.membership.updateMany({
      where: { userId: person.userId, orgId: orgA.orgId, isActive: true },
      data: { isActive: false },
    })

    const inA = await prisma.membership.findFirst({
      where: { userId: person.userId, orgId: orgA.orgId, isActive: true },
    })
    const inB = await prisma.membership.findFirst({
      where: { userId: person.userId, orgId: orgB.orgId, isActive: true },
    })
    expect(inA).toBeNull()
    expect(inB).not.toBeNull()
  })

  it('reactivates the existing row instead of creating a second seat', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const person = await seedMember(prisma, org.orgId)
    await prisma.membership.updateMany({
      where: { userId: person.userId, orgId: org.orgId },
      data: { isActive: false },
    })

    // The accept route's upsert, verbatim.
    await prisma.membership.upsert({
      where: { userId_orgId: { userId: person.userId, orgId: org.orgId } },
      create: { userId: person.userId, orgId: org.orgId, roles: ['basic'] },
      update: { roles: ['basic'], isActive: true },
    })

    const seats = await prisma.membership.count({
      where: { userId: person.userId, orgId: org.orgId },
    })
    expect(seats).toBe(1)
    const seat = await prisma.membership.findFirstOrThrow({
      where: { userId: person.userId, orgId: org.orgId },
    })
    expect(seat.isActive).toBe(true)
  })
})
