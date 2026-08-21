// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// This is the coverage the unit suite cannot give: those tests mock the database,
// so they never prove the actual Prisma queries, columns, defaults and
// constraints work. Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

describe('Org, User and Membership schema (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates an org with its first admin, joined by a membership', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.adminUserId } })
    expect(user.currentOrgId).toBe(seeded.orgId)
    expect(user.enabled).toBe(true)

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_orgId: { userId: seeded.adminUserId, orgId: seeded.orgId } },
    })
    expect(membership.roles).toContain('admin')
  })

  // Rule 1 of the schema house rules: every model carries both timestamps.
  it('stamps createdAt and updatedAt on every row', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.adminUserId } })
    const org = await prisma.org.findUniqueOrThrow({ where: { id: seeded.orgId } })
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: seeded.adminMembershipId },
    })

    for (const row of [user, org, membership]) {
      expect(row.createdAt).toBeInstanceOf(Date)
      expect(row.updatedAt).toBeInstanceOf(Date)
    }
  })

  it('moves updatedAt forward on a write, and leaves createdAt alone', async () => {
    const seeded = await seedOrgWithAdmin(prisma)
    const before = await prisma.user.findUniqueOrThrow({ where: { id: seeded.adminUserId } })

    await new Promise((r) => setTimeout(r, 5))
    const after = await prisma.user.update({
      where: { id: seeded.adminUserId },
      data: { title: 'Head of Everything' },
    })

    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
  })

  it('defaults a new membership to the basic role', async () => {
    const seeded = await seedOrgWithAdmin(prisma)
    const member = await seedMember(prisma, seeded.orgId)

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: member.membershipId },
    })
    expect(membership.roles).toEqual(['basic'])

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.userId } })
    expect(user.timeZone).toBeNull()
  })

  // The whole point of MAI-10: one user, several orgs.
  it('lets one user belong to more than one org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)

    await prisma.membership.create({
      data: { userId: orgA.adminUserId, orgId: orgB.orgId, roles: ['basic'] },
    })

    const memberships = await prisma.membership.findMany({
      where: { userId: orgA.adminUserId },
    })
    expect(memberships).toHaveLength(2)
    expect(memberships.map((m) => m.orgId).sort()).toEqual([orgA.orgId, orgB.orgId].sort())
  })

  it('refuses two memberships for the same user and org', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    await expect(
      prisma.membership.create({
        data: { userId: seeded.adminUserId, orgId: seeded.orgId, roles: ['basic'] },
      }),
    ).rejects.toThrow()
  })

  it('refuses two users with the same firebaseUid', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    await expect(
      prisma.user.create({
        data: {
          firebaseUid: seeded.adminFirebaseUid,
          email: `other_${Date.now()}@example.com`,
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses two users with the same email', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    await expect(
      prisma.user.create({
        data: {
          firebaseUid: `fb_other_${Date.now()}`,
          email: seeded.adminEmail,
        },
      }),
    ).rejects.toThrow()
  })

  // onDelete: Cascade — deleting an org must not leave orphaned memberships
  // behind, because every org-scoped query filters on an orgId that is gone.
  // The USER survives: they may still belong to other orgs.
  it('deletes an org’s memberships along with the org, and keeps the user', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    await prisma.org.delete({ where: { id: seeded.orgId } })

    const orphanMembership = await prisma.membership.findUnique({
      where: { id: seeded.adminMembershipId },
    })
    expect(orphanMembership).toBeNull()

    const user = await prisma.user.findUnique({ where: { id: seeded.adminUserId } })
    expect(user).not.toBeNull()
  })
})
