// Real-Postgres coverage for the delete-confirmation impact endpoints (MAI-355).
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
  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema })
  return { default: new PrismaClient({ adapter }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

function as(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

beforeAll(() => {
  verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('delete impact endpoints (integration, real Postgres)', () => {
  it('counts a custom object’s records, distinct inbound references, and non-empty attribute values', async () => {
    const mine = await seedOrgWithAdmin(prisma)
    const foreign = await seedOrgWithAdmin(prisma)
    const timestamp = Date.now()
    const client = await prisma.objectDef.create({
      data: { orgId: mine.orgId, slug: `client_${timestamp}`, name: 'Client', namePlural: 'Clients', storage: 'record', isStandard: false },
    })
    const project = await prisma.objectDef.create({
      data: { orgId: mine.orgId, slug: `project_${timestamp}`, name: 'Project', namePlural: 'Projects', storage: 'record', isStandard: false },
    })
    const clientField = await prisma.attributeDef.create({
      data: { orgId: mine.orgId, objectId: project.id, slug: 'client', name: 'Client', type: 'record_reference', storage: 'custom', refObjectId: client.id },
    })
    const nameField = await prisma.attributeDef.create({
      data: { orgId: mine.orgId, objectId: client.id, slug: 'name', name: 'Name', type: 'text', storage: 'custom' },
    })
    const clientOne = await prisma.record.create({ data: { orgId: mine.orgId, objectId: client.id, valuesJson: { name: 'Northstar' } } })
    const clientTwo = await prisma.record.create({ data: { orgId: mine.orgId, objectId: client.id, valuesJson: {} } })
    const source = await prisma.record.create({ data: { orgId: mine.orgId, objectId: project.id, valuesJson: { client: clientOne.id } } })
    await prisma.recordLink.create({
      data: { orgId: mine.orgId, fromObject: 'record', fromId: source.id, attribute: clientField.slug, toObject: client.slug, toId: clientOne.id },
    })

    const objectImpact = await request(app)
      .get(`/api/orgs/${mine.orgId}/objects/${client.id}/impact`)
      .set('Authorization', as(mine.adminFirebaseUid))
    expect(objectImpact.status).toBe(200)
    expect(objectImpact.body).toEqual({
      recordCount: 2,
      references: [{ objectName: 'Project', fieldName: 'Client', count: 1 }],
    })

    const fieldImpact = await request(app)
      .get(`/api/orgs/${mine.orgId}/attributes/${nameField.id}/impact`)
      .set('Authorization', as(mine.adminFirebaseUid))
    expect(fieldImpact.status).toBe(200)
    expect(fieldImpact.body).toEqual({ valueCount: 1 })

    await request(app)
      .get(`/api/orgs/${foreign.orgId}/objects/${client.id}/impact`)
      .set('Authorization', as(foreign.adminFirebaseUid))
      .expect(404)
    await request(app)
      .get(`/api/orgs/${foreign.orgId}/attributes/${nameField.id}/impact`)
      .set('Authorization', as(foreign.adminFirebaseUid))
      .expect(404)

    expect(clientTwo.id).toBeDefined()
  })
})
