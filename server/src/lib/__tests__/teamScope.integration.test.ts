import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { afterAll, describe, expect, inject, it } from 'vitest'

import { InvalidTeamScopeError, resolveOwnerTeamScope } from '../teamScope.js'
import { seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const schema = inject('testSchema')
const url = new URL(inject('testDatabaseUrl'))
url.searchParams.set('options', `-c search_path=${schema},public`)
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) })

afterAll(async () => {
  await prisma.$disconnect()
})

describe('owner team scope (integration)', () => {
  it('filters owner-backed records once across explicit and live lead-selected teams', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const explicitMember = await seedMember(prisma, org.orgId)
    const lead = await seedMember(prisma, org.orgId)
    const teamA = await prisma.team.create({
      data: {
        orgId: org.orgId, name: 'Revenue', leadUserId: org.adminUserId,
        members: { create: [{ orgId: org.orgId, userId: org.adminUserId }, { orgId: org.orgId, userId: explicitMember.userId }] },
      },
    })
    await prisma.team.create({
      data: {
        orgId: org.orgId, name: 'Outbound', leadUserId: lead.userId,
        members: { create: [{ orgId: org.orgId, userId: org.adminUserId }, { orgId: org.orgId, userId: lead.userId }] },
      },
    })
    await prisma.person.createMany({
      data: [
        { orgId: org.orgId, firstName: 'Avery', ownerUserId: org.adminUserId },
        { orgId: org.orgId, firstName: 'Morgan', ownerUserId: explicitMember.userId },
        { orgId: org.orgId, firstName: 'Jordan', ownerUserId: lead.userId },
      ],
    })

    const predicate = await resolveOwnerTeamScope(prisma, org.orgId, {
      teamIds: [teamA.id], leadUserIds: [lead.userId],
    })
    const people = await prisma.person.findMany({ where: { orgId: org.orgId, ...predicate }, orderBy: { firstName: 'asc' } })

    expect(predicate?.ownerUserId.in).toEqual(expect.arrayContaining([org.adminUserId, explicitMember.userId, lead.userId]))
    expect(predicate?.ownerUserId.in).toHaveLength(3)
    expect(people.map((person) => person.firstName)).toEqual(['Avery', 'Jordan', 'Morgan'])

    await prisma.team.updateMany({ where: { orgId: org.orgId, name: 'Outbound' }, data: { leadUserId: org.adminUserId } })
    await expect(resolveOwnerTeamScope(prisma, org.orgId, { leadUserIds: [lead.userId] }))
      .resolves.toEqual({ ownerUserId: { in: [] } })
  })

  it('rejects archived teams and foreign team or lead ids without exposing their records', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const otherOrg = await seedOrgWithAdmin(prisma)
    const archived = await prisma.team.create({
      data: {
        orgId: org.orgId, name: 'Archived', leadUserId: org.adminUserId, archivedAt: new Date(),
        members: { create: { orgId: org.orgId, userId: org.adminUserId } },
      },
    })
    const foreign = await prisma.team.create({
      data: {
        orgId: otherOrg.orgId, name: 'Foreign', leadUserId: otherOrg.adminUserId,
        members: { create: { orgId: otherOrg.orgId, userId: otherOrg.adminUserId } },
      },
    })

    await expect(resolveOwnerTeamScope(prisma, org.orgId, { teamIds: [archived.id] }))
      .rejects.toBeInstanceOf(InvalidTeamScopeError)
    await expect(resolveOwnerTeamScope(prisma, org.orgId, { teamIds: [foreign.id] }))
      .rejects.toBeInstanceOf(InvalidTeamScopeError)
    await expect(resolveOwnerTeamScope(prisma, org.orgId, { leadUserIds: [otherOrg.adminUserId] }))
      .rejects.toBeInstanceOf(InvalidTeamScopeError)
  })
})
