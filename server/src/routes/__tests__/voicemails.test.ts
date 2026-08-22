// The single-voicemail API contract: member-only reads return a signed recording
// URL, and deletion removes the org-scoped record and its private audio object.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, presignMock, deleteObjectMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    voicemail: { findFirst: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
  presignMock: vi.fn(),
  deleteObjectMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../../dependencies/s3.js', () => ({
  getRecordingDownloadUrl: presignMock,
  deleteObject: deleteObjectMock,
}))

import app from '../../app.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/voicemails`

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

function voicemailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'voicemail-1', orgId: ORG_A, callSid: 'CA123', fromE164: '+12015550100',
    toE164: '+12015550111', greeting: null,
    recordingUrl: 'maincar-voicemail-drops/org-a/voicemail-1.mp3',
    transcriptStatus: 'done', transcript: 'Please call me back.', durationS: 73,
    createdAt: NOW, updatedAt: NOW, ...overrides,
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
  prismaMock.voicemail.findFirst.mockResolvedValue(voicemailRow())
  prismaMock.voicemail.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.voicemail.count.mockResolvedValue(1)
  prismaMock.voicemail.findMany.mockResolvedValue([voicemailRow()])
  presignMock.mockResolvedValue('https://recordings.example/signed/voicemail-1.mp3')
  deleteObjectMock.mockResolvedValue(undefined)
})

describe('GET /api/orgs/:orgId/voicemails/:id', () => {
  it('returns the voicemail with a freshly signed audio URL', async () => {
    const res = await request(app).get(`${URL_A}/voicemail-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.voicemail).toMatchObject({
      id: 'voicemail-1', fromE164: '+12015550100', toE164: '+12015550111', durationS: 73,
      transcript: 'Please call me back.', recordingUrl: 'https://recordings.example/signed/voicemail-1.mp3',
    })
    expect(presignMock).toHaveBeenCalledWith('maincar-voicemail-drops/org-a/voicemail-1.mp3')
  })

  it('scopes the lookup to the organization in the path', async () => {
    await request(app).get(`${URL_A}/voicemail-1`).set('Authorization', AUTH)
    expect(prismaMock.voicemail.findFirst).toHaveBeenCalledWith({ where: { id: 'voicemail-1', orgId: ORG_A } })
  })

  it('answers 404 without signing audio when the voicemail is absent', async () => {
    prismaMock.voicemail.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/missing`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(presignMock).not.toHaveBeenCalled()
  })

  it('answers 404 before reading for a caller outside the organization', async () => {
    authAs(null)
    const res = await request(app).get(`/api/orgs/${ORG_B}/voicemails/voicemail-1`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(prismaMock.voicemail.findFirst).not.toHaveBeenCalled()
  })
})

describe('GET /api/orgs/:orgId/voicemails', () => {
  it('returns a paginated, storage-safe inbox row', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 25 })
    expect(res.body.voicemails).toEqual([
      expect.objectContaining({
        id: 'voicemail-1', fromE164: '+12015550100', durationS: 73,
        transcriptStatus: 'done', transcript: 'Please call me back.', createdAt: NOW.toISOString(),
      }),
    ])
    expect(res.body.voicemails[0]).not.toHaveProperty('orgId')
    expect(res.body.voicemails[0]).not.toHaveProperty('recordingUrl')
  })

  it('scopes both the count and page to the org, and searches the caller number', async () => {
    await request(app).get(`${URL_A}?q=555&page=2&limit=10`).set('Authorization', AUTH)

    const expectedWhere = { orgId: ORG_A, fromE164: { contains: '555' } }
    expect(prismaMock.voicemail.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(prismaMock.voicemail.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ createdAt: 'desc' }],
      skip: 10,
      take: 10,
    })
  })

  it('rejects a non-member before reading a voicemail', async () => {
    authAs(null)
    const res = await request(app).get(`/api/orgs/${ORG_B}/voicemails`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.voicemail.findMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/voicemails/:id', () => {
  it('deletes the org-scoped voicemail and its audio object', async () => {
    const res = await request(app).delete(`${URL_A}/voicemail-1`).set('Authorization', AUTH)
    expect(res.status).toBe(204)
    expect(prismaMock.voicemail.deleteMany).toHaveBeenCalledWith({ where: { id: 'voicemail-1', orgId: ORG_A } })
    expect(deleteObjectMock).toHaveBeenCalledWith('maincar-voicemail-drops/org-a/voicemail-1.mp3')
  })

  it('answers 404 without deleting audio when the row is absent', async () => {
    prismaMock.voicemail.deleteMany.mockResolvedValue({ count: 0 })
    const res = await request(app).delete(`${URL_A}/missing`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })
})
