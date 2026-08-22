import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, putObjectBytesMock, queueTranscodeGreetingMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    voicemailGreeting: { upsert: vi.fn(), findFirst: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
  putObjectBytesMock: vi.fn(),
  queueTranscodeGreetingMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../../dependencies/s3.js', () => ({ putObjectBytes: putObjectBytesMock }))
vi.mock('../../jobs/transcodeGreeting.js', () => ({ queueTranscodeGreeting: queueTranscodeGreetingMock }))

import app from '../../app.js'

const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/voicemail-greeting`
const AUTH = 'Bearer fake-token'
const NOW = new Date('2026-08-22T12:00:00.000Z')
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01])
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])

function greetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'greeting-a',
    orgId: ORG_ID,
    audioUrl: null,
    status: 'pending',
    uploadedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true,
  })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  })
  prismaMock.voicemailGreeting.upsert.mockResolvedValue(greetingRow())
  prismaMock.voicemailGreeting.findFirst.mockResolvedValue(null)
  putObjectBytesMock.mockResolvedValue(undefined)
  queueTranscodeGreetingMock.mockResolvedValue('job-a')
})

describe('POST /api/orgs/:orgId/voicemail-greeting', () => {
  it('stores a WebM upload, queues conversion, and returns the pending greeting', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      greeting: expect.objectContaining({ id: 'greeting-a', status: 'pending', uploadedAt: null }),
    })
    expect(putObjectBytesMock).toHaveBeenCalledWith(expect.objectContaining({
      body: WEBM,
      contentType: 'audio/webm',
      key: expect.stringMatching(/^voicemail-greeting-uploads\/org-a\/.+\.webm$/),
    }))
    expect(queueTranscodeGreetingMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      tempObjectKey: expect.stringMatching(/^voicemail-greeting-uploads\/org-a\/.+\.webm$/),
    }))
  })

  it('rejects a file whose bytes are not WebM or MP3 before storing it', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .attach('audio', Buffer.from('not audio'), { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(400)
    expect(putObjectBytesMock).not.toHaveBeenCalled()
    expect(prismaMock.voicemailGreeting.upsert).not.toHaveBeenCalled()
  })

  it('accepts an MP3 upload', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .attach('audio', MP3, { filename: 'greeting.mp3', contentType: 'audio/mpeg' })

    expect(response.status).toBe(201)
    expect(putObjectBytesMock).toHaveBeenCalledWith(expect.objectContaining({
      body: MP3,
      contentType: 'audio/mpeg',
      key: expect.stringMatching(/^voicemail-greeting-uploads\/org-a\/.+\.mp3$/),
    }))
  })

  it('rejects an unauthenticated upload before storing it', async () => {
    verifyTokenMock.mockRejectedValue(new Error('invalid token'))

    const response = await request(app)
      .post(URL)
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(401)
    expect(putObjectBytesMock).not.toHaveBeenCalled()
  })

  it('refuses a member of another organization before storing their upload', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null)

    const response = await request(app)
      .post('/api/orgs/org-b/voicemail-greeting')
      .set('Authorization', AUTH)
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(404)
    expect(putObjectBytesMock).not.toHaveBeenCalled()
    expect(prismaMock.voicemailGreeting.upsert).not.toHaveBeenCalled()
  })
})

describe('GET /api/orgs/:orgId/voicemail-greeting', () => {
  it('returns the authorized greeting lifecycle read model', async () => {
    const response = await request(app)
      .get(URL)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      greeting: expect.objectContaining({ active: null, candidates: [] }),
    })
  })
})
