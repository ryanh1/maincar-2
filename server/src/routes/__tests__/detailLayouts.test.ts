import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    objectDef: { findFirst: vi.fn() },
    detailLayout: { findFirst: vi.fn(), upsert: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

import app from '../../app.js'

const NOW = new Date('2026-08-22T18:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_ID = 'org-a'
const OBJECT_ID = 'object-people'
const URL = `/api/orgs/${ORG_ID}/detail-layouts/${OBJECT_ID}`

function userRow() {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, avatarKey: null, roles: ['basic'], enabled: true,
    timeZone: 'America/New_York', currentOrgId: ORG_ID, createdAt: NOW, updatedAt: NOW,
  }
}

function membershipRow() {
  return {
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  }
}

function layoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'layout-1', orgId: ORG_ID, objectId: OBJECT_ID,
    sectionsJson: [{ name: 'Details', fields: [{ slug: 'name', width: 2 }], order: 0 }],
    railObjectsJson: ['deal'], feedKindsJson: ['call'], isDefault: true,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.objectDef.findFirst.mockResolvedValue({ id: OBJECT_ID, orgId: ORG_ID, slug: 'person' })
  prismaMock.detailLayout.findFirst.mockResolvedValue(layoutRow())
  prismaMock.detailLayout.upsert.mockResolvedValue(layoutRow())
})

describe('GET /api/orgs/:orgId/detail-layouts/:objectId', () => {
  it('loads the object layout within the path organization', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.layout).toMatchObject({ objectId: OBJECT_ID, isDefault: true })
    expect(prismaMock.detailLayout.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, objectId: OBJECT_ID },
    })
  })

  it('returns a strong default when the object has no saved layout', async () => {
    prismaMock.detailLayout.findFirst.mockResolvedValue(null)

    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.layout).toEqual({
      objectId: OBJECT_ID,
      sections: [{ name: 'Details', fields: [], order: 0 }],
      railObjects: [],
      feedKinds: [],
      isDefault: true,
    })
  })
})

describe('PUT /api/orgs/:orgId/detail-layouts/:objectId', () => {
  it('persists one organization-scoped layout for the object', async () => {
    const response = await request(app)
      .put(URL)
      .set('Authorization', AUTH)
      .send({
        sections: [{ name: 'Details', fields: [{ slug: 'name', width: 2 }], order: 0 }],
        railObjects: ['deal'],
        feedKinds: ['call'],
      })

    expect(response.status).toBe(200)
    expect(prismaMock.detailLayout.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId_objectId: { orgId: ORG_ID, objectId: OBJECT_ID } },
      create: expect.objectContaining({ orgId: ORG_ID, objectId: OBJECT_ID, isDefault: true }),
      update: expect.objectContaining({ isDefault: true }),
    }))
  })
})
