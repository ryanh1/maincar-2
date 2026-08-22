// Team catalog and roster lifecycle over the real HTTP routes and a real
// Postgres schema. Unit coverage in teams.test.ts proves route wiring; these
// tests prove the tenant-scoped database constraints and lifecycle invariants.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
  revokeFirebaseRefreshTokens: vi.fn(),
}))

vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')

  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return { default: new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const as = (firebaseUid: string): string => `Bearer ${firebaseUid}`

async function createTeam(
  orgId: string,
  firebaseUid: string,
  leadUserId: string,
  memberUserIds: string[],
  name = 'Revenue',
) {
  return request(app)
    .post(`/api/orgs/${orgId}/teams`)
    .set('Authorization', as(firebaseUid))
    .send({ name, leadUserId, memberUserIds })
}

describe('Team catalog and roster lifecycle (integration)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('lets a basic active member create a unique, active roster', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const member = await seedMember(prisma, org.orgId)

    const created = await createTeam(org.orgId, member.firebaseUid, member.userId, [member.userId], 'Outbound')

    expect(created.status).toBe(201)
    expect(created.body.team.memberUserIds).toEqual([member.userId])
    const roster = await prisma.teamMember.findMany({ where: { orgId: org.orgId, teamId: created.body.team.id } })
    expect(roster).toHaveLength(1)
    await expect(
      prisma.teamMember.create({ data: { orgId: org.orgId, teamId: created.body.team.id, userId: member.userId } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('rejects duplicate roster input and inactive members without creating a team', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const member = await seedMember(prisma, org.orgId)

    const duplicate = await createTeam(org.orgId, org.adminFirebaseUid, org.adminUserId, [org.adminUserId, org.adminUserId])
    expect(duplicate.status).toBe(400)

    await prisma.membership.updateMany({
      where: { orgId: org.orgId, userId: member.userId },
      data: { isActive: false },
    })
    const inactive = await createTeam(org.orgId, org.adminFirebaseUid, org.adminUserId, [org.adminUserId, member.userId])
    expect(inactive.status).toBe(422)
    expect(await prisma.team.count({ where: { orgId: org.orgId } })).toBe(0)
  })

  it('never exposes a team through another organization', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const created = await createTeam(a.orgId, a.adminFirebaseUid, a.adminUserId, [a.adminUserId])
    expect(created.status).toBe(201)

    const crossOrg = await request(app)
      .get(`/api/orgs/${b.orgId}/teams/${created.body.team.id}`)
      .set('Authorization', as(b.adminFirebaseUid))
    expect(crossOrg.status).toBe(404)
  })

  it('archives and recovers a team without changing CRM records', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const person = await prisma.person.create({ data: { orgId: org.orgId, firstName: 'Unchanged' } })
    const created = await createTeam(org.orgId, org.adminFirebaseUid, org.adminUserId, [org.adminUserId])
    const teamId = created.body.team.id as string

    const archived = await request(app)
      .patch(`/api/orgs/${org.orgId}/teams/${teamId}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ isArchived: true })
    expect(archived.status).toBe(200)
    expect(archived.body.team.isArchived).toBe(true)
    expect(await prisma.person.findFirst({ where: { id: person.id, orgId: org.orgId } })).not.toBeNull()

    const activeCatalog = await request(app).get(`/api/orgs/${org.orgId}/teams`).set('Authorization', as(org.adminFirebaseUid))
    const archivedCatalog = await request(app)
      .get(`/api/orgs/${org.orgId}/teams?isArchived=true`)
      .set('Authorization', as(org.adminFirebaseUid))
    expect(activeCatalog.body.teams).toEqual([])
    expect(archivedCatalog.body.teams).toHaveLength(1)

    const recovered = await request(app)
      .patch(`/api/orgs/${org.orgId}/teams/${teamId}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ isArchived: false })
    expect(recovered.status).toBe(200)
    expect(recovered.body.team.isArchived).toBe(false)
  })

  it('requires lead reassignment before roster removal or offboarding', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const member = await seedMember(prisma, org.orgId)
    const created = await createTeam(
      org.orgId,
      org.adminFirebaseUid,
      org.adminUserId,
      [org.adminUserId, member.userId],
    )
    const teamId = created.body.team.id as string

    const removeLead = await request(app)
      .patch(`/api/orgs/${org.orgId}/teams/${teamId}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ memberUserIds: [member.userId] })
    expect(removeLead.status).toBe(422)

    const reassign = await request(app)
      .patch(`/api/orgs/${org.orgId}/teams/${teamId}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ leadUserId: member.userId, memberUserIds: [org.adminUserId, member.userId] })
    expect(reassign.status).toBe(200)
    expect(reassign.body.team.leadUserId).toBe(member.userId)

    const blockOffboard = await request(app)
      .delete(`/api/orgs/${org.orgId}/members/${member.userId}`)
      .set('Authorization', as(org.adminFirebaseUid))
    expect(blockOffboard.status).toBe(422)

    const restoreLead = await request(app)
      .patch(`/api/orgs/${org.orgId}/teams/${teamId}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ leadUserId: org.adminUserId, memberUserIds: [org.adminUserId] })
    expect(restoreLead.status).toBe(200)

    const offboard = await request(app)
      .delete(`/api/orgs/${org.orgId}/members/${member.userId}`)
      .set('Authorization', as(org.adminFirebaseUid))
    expect(offboard.status).toBe(200)
    expect(await prisma.membership.findFirst({ where: { orgId: org.orgId, userId: member.userId, isActive: true } })).toBeNull()
  })
})
