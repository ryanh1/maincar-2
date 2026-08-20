// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// This is the coverage the unit suite cannot give: those tests mock the database,
// so they never prove the actual Prisma queries, columns, defaults and
// constraints work. Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

describe('Org and User schema (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates an org with its first admin', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.adminUserId } })
    expect(user.orgId).toBe(seeded.orgId)
    expect(user.roles).toContain('admin')
    expect(user.enabled).toBe(true)
  })

  // Rule 1 of the schema house rules: every model carries both timestamps.
  it('stamps createdAt and updatedAt on every row', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: seeded.adminUserId } })
    const org = await prisma.org.findUniqueOrThrow({ where: { id: seeded.orgId } })

    for (const row of [user, org]) {
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

  it('defaults a new user to the basic role', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    const member = await prisma.user.create({
      data: {
        orgId: seeded.orgId,
        firebaseUid: `fb_member_${Date.now()}`,
        email: `member_${Date.now()}@example.com`,
      },
    })

    expect(member.roles).toEqual(['basic'])
    expect(member.timeZone).toBeNull()
  })

  it('refuses two users with the same firebaseUid', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    await expect(
      prisma.user.create({
        data: {
          orgId: seeded.orgId,
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
          orgId: seeded.orgId,
          firebaseUid: `fb_other_${Date.now()}`,
          email: seeded.adminEmail,
        },
      }),
    ).rejects.toThrow()
  })

  // onDelete: Cascade — deleting an org must not leave orphaned users behind,
  // because every org-scoped query filters on an orgId that no longer exists.
  it('deletes an org’s users along with the org', async () => {
    const seeded = await seedOrgWithAdmin(prisma)

    await prisma.org.delete({ where: { id: seeded.orgId } })

    const orphan = await prisma.user.findUnique({ where: { id: seeded.adminUserId } })
    expect(orphan).toBeNull()
  })
})
