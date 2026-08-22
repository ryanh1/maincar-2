// The voicemail-drop deletion contract: it keeps every org's library non-empty,
// removes private audio, and immediately replaces a deleted default.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, deleteObjectMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    voicemailDrop: { findFirst: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  deleteObjectMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../../dependencies/s3.js', () => ({ deleteObject: deleteObjectMock }))

import app from '../../app.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/voicemail-drops`

function userRow() {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
    currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW,
  }
}

function membershipRow(orgId = ORG_A) {
  return {
    id: 'mem-a', userId: 'user-a', orgId, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: orgId, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  }
}

function dropRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'drop-1', orgId: ORG_A, name: 'First drop',
    audioUrl: 'maincar-voicemail-drops/org-a/drop-1.mp3', duration: 12, isDefault: false,
    transcriptStatus: 'done', transcript: 'Hello there.', createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.$queryRaw.mockResolvedValue([{ count: 2n }])
  prismaMock.voicemailDrop.findFirst.mockResolvedValue(dropRow())
  prismaMock.voicemailDrop.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.voicemailDrop.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
  deleteObjectMock.mockResolvedValue(undefined)
})

describe('DELETE /api/orgs/:orgId/voicemail-drops/:id', () => {
  it('deletes an org-scoped drop and its private audio object', async () => {
    const res = await request(app).delete(`${URL_A}/drop-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.voicemailDrop.deleteMany).toHaveBeenCalledWith({
      where: { id: 'drop-1', orgId: ORG_A },
    })
    expect(deleteObjectMock).toHaveBeenCalledWith('maincar-voicemail-drops/org-a/drop-1.mp3')
  })

  it('locks the org library before deciding it can delete', async () => {
    await request(app).delete(`${URL_A}/drop-1`).set('Authorization', AUTH)

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('promotes the oldest remaining drop after deleting the default', async () => {
    const oldest = dropRow({ id: 'drop-2', name: 'Oldest remaining', createdAt: new Date('2026-08-20T12:00:00.000Z') })
    prismaMock.voicemailDrop.findFirst
      .mockResolvedValueOnce(dropRow({ isDefault: true }))
      .mockResolvedValueOnce(oldest)

    const res = await request(app).delete(`${URL_A}/drop-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.voicemailDrop.findFirst).toHaveBeenLastCalledWith({
      where: { orgId: ORG_A },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    expect(prismaMock.voicemailDrop.updateMany).toHaveBeenCalledWith({
      where: { id: 'drop-2', orgId: ORG_A },
      data: { isDefault: true },
    })
  })

  it('rejects deletion of an org’s final voicemail drop', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1n }])

    const res = await request(app).delete(`${URL_A}/drop-1`).set('Authorization', AUTH)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Your organization must keep at least one voicemail drop.' })
    expect(prismaMock.voicemailDrop.deleteMany).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('answers 404 without deleting audio when the drop is absent', async () => {
    prismaMock.voicemailDrop.findFirst.mockResolvedValue(null)

    const res = await request(app).delete(`${URL_A}/missing`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it('answers 404 before accessing a drop for a caller outside the organization', async () => {
    authAs(null)

    const res = await request(app).delete(`/api/orgs/${ORG_B}/voicemail-drops/drop-1`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
