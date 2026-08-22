import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    dispositionDef: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
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

const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/dispositions`
const AUTH = 'Bearer token'
const NOW = new Date('2026-08-22T12:00:00.000Z')

function dispositionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'disposition-1', orgId: ORG_ID, value: 'connected', label: 'Connected', color: 'option-1', icon: null,
    category: 'connected', isStandard: true, sortOrder: 0, isArchived: false, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true, createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_ID, name: 'Org A', enabled: true, createdAt: NOW, updatedAt: NOW },
  })
  prismaMock.dispositionDef.findMany.mockResolvedValue([dispositionRow()])
  prismaMock.dispositionDef.findFirst.mockResolvedValue(null)
  prismaMock.dispositionDef.create.mockResolvedValue(dispositionRow({ id: 'disposition-2', value: 'follow_up', label: 'Follow up', isStandard: false }))
  prismaMock.dispositionDef.updateMany.mockResolvedValue({ count: 1 })
})

describe('call dispositions', () => {
  it('lists active dispositions for an organization member', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.dispositions).toEqual([expect.objectContaining({ value: 'connected', category: 'connected' })])
    expect(prismaMock.dispositionDef.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, isArchived: false }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    })
  })

  it('creates a custom disposition with a stable value', async () => {
    const response = await request(app).post(URL).set('Authorization', AUTH).send({
      value: 'follow_up', label: 'Follow up', color: 'option-3', category: 'connected', icon: 'PhoneCall',
    })

    expect(response.status).toBe(201)
    expect(prismaMock.dispositionDef.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: ORG_ID, value: 'follow_up', label: 'Follow up', color: 'option-3', category: 'connected', icon: 'PhoneCall', isStandard: false }),
    })
  })

  it('rejects a raw color and leaves the catalog unchanged', async () => {
    const response = await request(app).post(URL).set('Authorization', AUTH).send({
      value: 'follow_up', label: 'Follow up', color: '#0E7490', category: 'connected',
    })

    expect(response.status).toBe(400)
    expect(prismaMock.dispositionDef.create).not.toHaveBeenCalled()
  })

  it('archives a disposition without deleting call history', async () => {
    const response = await request(app).delete(`${URL}/disposition-1`).set('Authorization', AUTH)

    expect(response.status).toBe(204)
    expect(prismaMock.dispositionDef.updateMany).toHaveBeenCalledWith({
      where: { id: 'disposition-1', orgId: ORG_ID, isArchived: false }, data: { isArchived: true },
    })
  })

  it('does not reveal a disposition in another organization', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null)

    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(prismaMock.dispositionDef.findMany).not.toHaveBeenCalled()
  })
})
