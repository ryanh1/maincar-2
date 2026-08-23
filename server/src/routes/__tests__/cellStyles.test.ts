import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    savedView: { findFirst: vi.fn() },
    attributeDef: { findFirst: vi.fn() },
    cellStyle: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
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
const URL = `/api/orgs/${ORG_ID}/cell-styles`

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

function cellStyleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'style-1', orgId: ORG_ID, viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name',
    backgroundToken: 'option-1', textToken: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.savedView.findFirst.mockResolvedValue(savedViewRow())
  prismaMock.attributeDef.findFirst.mockResolvedValue({
    id: 'attribute-name', objectId: 'object-people', storage: 'column', isMulti: false, type: 'text',
  })
  prismaMock.cellStyle.findMany.mockResolvedValue([cellStyleRow()])
  prismaMock.cellStyle.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => cellStyleRow(args.create))
  prismaMock.cellStyle.deleteMany.mockResolvedValue({ count: 1 })
})

describe('GET /api/orgs/:orgId/cell-styles', () => {
  it('lists the painted cells of one visible view', async () => {
    const response = await request(app)
      .get(`${URL}?viewId=view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.cellStyles).toEqual([
      expect.objectContaining({ viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name', backgroundToken: 'option-1' }),
    ])
    expect(prismaMock.cellStyle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: ORG_ID, viewId: 'view-1' },
    }))
  })

  it('hides a view the caller cannot see', async () => {
    prismaMock.savedView.findFirst.mockResolvedValue(savedViewRow({ ownerUserId: 'someone-else', isShared: false }))

    const response = await request(app)
      .get(`${URL}?viewId=view-1`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(prismaMock.cellStyle.findMany).not.toHaveBeenCalled()
  })
})

describe('PUT /api/orgs/:orgId/cell-styles', () => {
  it('paints a stored scalar cell with a muted token', async () => {
    const response = await request(app)
      .put(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name', backgroundToken: 'option-2' })

    expect(response.status).toBe(200)
    expect(response.body.cellStyle).toMatchObject({ backgroundToken: 'option-2' })
    expect(prismaMock.cellStyle.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { viewId_recordId_fieldId: { viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name' } },
      create: expect.objectContaining({ orgId: ORG_ID, backgroundToken: 'option-2' }),
    }))
  })

  it('rejects paint on a non-scalar or list-only field', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValue({
      id: 'attribute-name', objectId: 'object-people', storage: 'list', isMulti: false, type: 'text',
    })

    const response = await request(app)
      .put(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name', backgroundToken: 'option-2' })

    expect(response.status).toBe(422)
    expect(prismaMock.cellStyle.upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown colour token', async () => {
    const response = await request(app)
      .put(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name', backgroundToken: '#ff0000' })

    expect(response.status).toBe(422)
    expect(prismaMock.cellStyle.upsert).not.toHaveBeenCalled()
  })

  it('removes the row when both channels are cleared', async () => {
    const response = await request(app)
      .put(URL)
      .set('Authorization', AUTH)
      .send({ viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name', backgroundToken: null, textToken: null })

    expect(response.status).toBe(200)
    expect(response.body.cellStyle).toBeNull()
    expect(prismaMock.cellStyle.deleteMany).toHaveBeenCalledWith({
      where: { viewId: 'view-1', recordId: 'record-1', fieldId: 'attribute-name' },
    })
  })
})
