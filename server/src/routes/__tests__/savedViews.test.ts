import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    objectDef: { findFirst: vi.fn() },
    attributeDef: { findMany: vi.fn() },
    savedView: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
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
const URL = `/api/orgs/${ORG_ID}/saved-views`
const NESTED_URL = `/api/orgs/${ORG_ID}/objects/object-people/views`

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

function savedViewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'view-1', orgId: ORG_ID, objectId: 'object-people', ownerUserId: 'user-a',
    name: 'Prospects', layout: 'grid', configJson: { version: 1, columns: [] },
    isShared: false, isDefault: false, sortOrder: 0, deletedAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.objectDef.findFirst.mockResolvedValue({ id: 'object-people', orgId: ORG_ID, slug: 'person' })
  prismaMock.attributeDef.findMany.mockResolvedValue([
    { id: 'attribute-name', objectId: 'object-people', sortOrder: 0, isArchived: false, deletedAt: null, storage: 'column' },
  ])
  prismaMock.savedView.create.mockImplementation(async (args: { data: Record<string, unknown> }) => savedViewRow(args.data))
  prismaMock.savedView.findFirst.mockResolvedValue(savedViewRow())
  prismaMock.savedView.updateMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/orgs/:orgId/saved-views', () => {
  it('persists a schema-validated personal view scoped to the path org and object', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .send({
        objectId: 'object-people',
        name: 'Prospects',
        layout: 'grid',
        config: { columns: [{ attributeId: 'attribute-name', visible: true, order: 0 }] },
      })

    expect(response.status).toBe(201)
    expect(response.body.view).toMatchObject({ name: 'Prospects', objectId: 'object-people', isShared: false })
    expect(prismaMock.savedView.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orgId: ORG_ID, objectId: 'object-people', ownerUserId: 'user-a', isShared: false }),
    }))
  })
})

describe('POST /api/orgs/:orgId/objects/:objectId/views', () => {
  it('persists a configJson that references this object’s known attributes', async () => {
    const response = await request(app)
      .post(NESTED_URL)
      .set('Authorization', AUTH)
      .send({
        name: 'Prospects',
        layout: 'grid',
        configJson: { columns: [{ attributeId: 'attribute-name', visible: true, order: 0 }] },
      })

    expect(response.status).toBe(201)
    expect(response.body.view.configJson.columns).toEqual([
      { attributeId: 'attribute-name', visible: true, order: 0 },
    ])
    expect(prismaMock.savedView.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orgId: ORG_ID, objectId: 'object-people' }),
    }))
  })

  it('rejects a configJson that references an unknown attribute', async () => {
    const response = await request(app)
      .post(NESTED_URL)
      .set('Authorization', AUTH)
      .send({
        name: 'Unknown column',
        layout: 'grid',
        configJson: { columns: [{ attributeId: 'unknown-attribute', visible: true, order: 0 }] },
      })

    expect(response.status).toBe(422)
    expect(prismaMock.savedView.create).not.toHaveBeenCalled()
  })

  it('soft-deletes only the view configuration and returns an undo token', async () => {
    const response = await request(app)
      .delete(`${NESTED_URL}/view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ undoToken: 'view-1' })
    expect(prismaMock.savedView.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'view-1', orgId: ORG_ID }),
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }))
  })

  it('restores the soft-deleted view named by its undo token', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(savedViewRow({ deletedAt: NOW }))

    const response = await request(app)
      .post(`${NESTED_URL}/undo`)
      .set('Authorization', AUTH)
      .send({ undoToken: 'view-1' })

    expect(response.status).toBe(204)
    expect(prismaMock.savedView.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'view-1', orgId: ORG_ID, deletedAt: { not: null } }),
      data: { deletedAt: null },
    }))
  })
})
