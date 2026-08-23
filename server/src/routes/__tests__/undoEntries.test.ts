import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    undoEntry: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
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

const NOW = new Date('2026-08-23T18:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/undo-entries`

function userRow() {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, avatarKey: null, roles: ['basic'], enabled: true,
    timeZone: 'America/New_York', currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW,
  }
}

function membershipRow(orgId = ORG_A) {
  return {
    id: `membership-${orgId}`, userId: 'user-a', orgId, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: orgId, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  }
}

function undoEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'undo-1', orgId: ORG_A, userId: 'user-a', sessionId: 'session-1', seq: 7,
    label: 'Set Owner = Ryan on 1,240 records', inverseJson: [{ recordId: 'person-1', field: 'owner', beforeValue: 'Al' }],
    redoJson: [{ recordId: 'person-1', field: 'owner', afterValue: 'Ryan' }], undone: false,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.undoEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => undoEntryRow(data))
  prismaMock.undoEntry.findMany.mockResolvedValue([undoEntryRow()])
  prismaMock.undoEntry.deleteMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/orgs/:orgId/undo-entries', () => {
  it('persists a user session entry and returns its undo payload', async () => {
    const payload = {
      sessionId: 'session-1', seq: 7, label: 'Set Owner = Ryan on 1,240 records',
      inverseJson: [{ recordId: 'person-1', field: 'owner', beforeValue: 'Al' }],
      redoJson: [{ recordId: 'person-1', field: 'owner', afterValue: 'Ryan' }],
    }

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send(payload)

    expect(res.status).toBe(201)
    expect(res.body.undoEntry).toMatchObject(payload)
    expect(prismaMock.undoEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: ORG_A, userId: 'user-a', ...payload }),
    })
  })

  it('hides another organization before it can write', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/undo-entries`)
      .set('Authorization', AUTH)
      .send({ sessionId: 'session-1', seq: 7, label: 'Change', inverseJson: [], redoJson: [] })

    expect(res.status).toBe(404)
    expect(prismaMock.undoEntry.create).not.toHaveBeenCalled()
  })

  it('rejects an invalid stack entry before writing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ sessionId: 'session-1', seq: -1, label: '', inverseJson: {}, redoJson: [] })

    expect(res.status).toBe(400)
    expect(prismaMock.undoEntry.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/orgs/:orgId/undo-entries', () => {
  it('reloads at most 50 newest entries for the current user and session', async () => {
    const rows = Array.from({ length: 50 }, (_, index) => undoEntryRow({ id: `undo-${index}`, seq: 99 - index }))
    prismaMock.undoEntry.findMany.mockResolvedValue(rows)

    const res = await request(app).get(`${URL_A}?sessionId=session-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.undoEntries).toHaveLength(50)
    expect(res.body.undoEntries[0]).toMatchObject({ seq: 99 })
    expect(prismaMock.undoEntry.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, userId: 'user-a', sessionId: 'session-1' },
      orderBy: { seq: 'desc' },
      take: 50,
    })
  })

  it('hides another organization before it can read', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .get(`/api/orgs/${ORG_B}/undo-entries?sessionId=session-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.undoEntry.findMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/undo-entries', () => {
  it('clears only the current user session stack', async () => {
    const res = await request(app).delete(`${URL_A}?sessionId=session-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.undoEntry.deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, userId: 'user-a', sessionId: 'session-1' },
    })
  })
})
