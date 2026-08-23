import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    dispositionDef: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
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
    category: 'connected', isStandard: true, isPinned: true, pinOrder: 0, sortOrder: 0, isArchived: false, createdAt: NOW, updatedAt: NOW, ...overrides,
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
  prismaMock.$transaction.mockImplementation(async (callback: (tx: { dispositionDef: typeof prismaMock.dispositionDef }) => unknown) => callback({ dispositionDef: prismaMock.dispositionDef }))
})

describe('call dispositions', () => {
  it('lists active dispositions for an organization member', async () => {
    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.dispositions).toEqual([expect.objectContaining({ value: 'connected', category: 'connected' })])
    expect(prismaMock.dispositionDef.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, isArchived: false }, orderBy: [{ isPinned: 'desc' }, { pinOrder: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    })
  })

  it('returns seeded and custom dispositions in deterministic bar order', async () => {
    prismaMock.dispositionDef.findMany.mockResolvedValue([
      dispositionRow({ id: 'pinned-first', value: 'connected', pinOrder: 0, sortOrder: 5 }),
      dispositionRow({ id: 'pinned-second', value: 'voicemail', pinOrder: 1, sortOrder: 0 }),
      dispositionRow({ id: 'custom', value: 'follow_up', isPinned: false, pinOrder: null, sortOrder: 0 }),
    ])

    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.dispositions.map((disposition: { id: string }) => disposition.id)).toEqual(['pinned-first', 'pinned-second', 'custom'])
    expect(response.body.dispositions[0]).toMatchObject({ isPinned: true, pinOrder: 0 })
    expect(response.body.dispositions[2]).toMatchObject({ isPinned: false, pinOrder: null })
  })

  it('atomically replaces the organization bar configuration in request order', async () => {
    const first = dispositionRow({ id: 'disposition-1', isPinned: true, pinOrder: 1 })
    const second = dispositionRow({ id: 'disposition-2', value: 'follow_up', isPinned: true, pinOrder: 0 })
    prismaMock.dispositionDef.findMany
      .mockResolvedValueOnce([{ id: second.id }, { id: first.id }])
      .mockResolvedValueOnce([second, first])

    const response = await request(app).put(`${URL}/bar`).set('Authorization', AUTH).send({ pinnedIds: [second.id, first.id] })

    expect(response.status).toBe(200)
    expect(response.body.dispositions.map((disposition: { id: string }) => disposition.id)).toEqual([second.id, first.id])
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.dispositionDef.updateMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, isArchived: false }, data: { isPinned: false, pinOrder: null },
    })
    expect(prismaMock.dispositionDef.updateMany).toHaveBeenCalledWith({
      where: { id: second.id, orgId: ORG_ID, isArchived: false }, data: { isPinned: true, pinOrder: 0 },
    })
    expect(prismaMock.dispositionDef.updateMany).toHaveBeenCalledWith({
      where: { id: first.id, orgId: ORG_ID, isArchived: false }, data: { isPinned: true, pinOrder: 1 },
    })
  })

  it('rejects duplicate pinned IDs before starting a transaction', async () => {
    const response = await request(app).put(`${URL}/bar`).set('Authorization', AUTH).send({ pinnedIds: ['disposition-1', 'disposition-1'] })

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects more than seven pinned dispositions before starting a transaction', async () => {
    const response = await request(app).put(`${URL}/bar`).set('Authorization', AUTH).send({
      pinnedIds: Array.from({ length: 8 }, (_, index) => `disposition-${index}`),
    })

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it.each(['another-org-disposition', 'archived-disposition'])('rejects an unavailable pinned disposition (%s) without changing the bar', async (id) => {
    prismaMock.dispositionDef.findMany.mockResolvedValueOnce([])

    const response = await request(app).put(`${URL}/bar`).set('Authorization', AUTH).send({ pinnedIds: [id] })

    expect(response.status).toBe(404)
    expect(prismaMock.dispositionDef.updateMany).not.toHaveBeenCalled()
  })

  it('rolls back when a selected disposition is archived before its pin write', async () => {
    prismaMock.dispositionDef.findMany.mockResolvedValueOnce([{ id: 'disposition-1' }])
    prismaMock.dispositionDef.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const response = await request(app).put(`${URL}/bar`).set('Authorization', AUTH).send({ pinnedIds: ['disposition-1'] })

    expect(response.status).toBe(404)
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
      where: { id: 'disposition-1', orgId: ORG_ID, isArchived: false }, data: { isArchived: true, isPinned: false, pinOrder: null },
    })
  })

  it('clears pin state when an archived disposition is restored', async () => {
    prismaMock.dispositionDef.findFirst.mockResolvedValue(dispositionRow({ isArchived: false, isPinned: false, pinOrder: null }))

    const response = await request(app).patch(`${URL}/disposition-1`).set('Authorization', AUTH).send({ isArchived: false })

    expect(response.status).toBe(200)
    expect(prismaMock.dispositionDef.updateMany).toHaveBeenCalledWith({
      where: { id: 'disposition-1', orgId: ORG_ID }, data: { isArchived: false, isPinned: false, pinOrder: null },
    })
  })

  it('does not allow a stable reporting value to be changed', async () => {
    const response = await request(app).patch(`${URL}/disposition-1`).set('Authorization', AUTH).send({ value: 'renamed' })

    expect(response.status).toBe(400)
    expect(prismaMock.dispositionDef.updateMany).not.toHaveBeenCalled()
  })

  it('does not reveal a disposition in another organization', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null)

    const response = await request(app).get(URL).set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(prismaMock.dispositionDef.findMany).not.toHaveBeenCalled()
  })
})
