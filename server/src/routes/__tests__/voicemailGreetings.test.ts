import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const {
  prismaMock,
  verifyTokenMock,
  putObjectBytesMock,
  getRecordingDownloadUrlMock,
  deleteObjectMock,
  queueTranscodeGreetingMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    voicemailGreeting: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  putObjectBytesMock: vi.fn(),
  getRecordingDownloadUrlMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  queueTranscodeGreetingMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../../dependencies/s3.js', () => ({
  putObjectBytes: putObjectBytesMock,
  getRecordingDownloadUrl: getRecordingDownloadUrlMock,
  deleteObject: deleteObjectMock,
}))
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
    sourceKey: null,
    storageKey: null,
    status: 'ready',
    contentHash: 'hash',
    idempotencyKey: 'test-upload',
    durationSeconds: null,
    failureReason: null,
    deletedAt: null,
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
  prismaMock.voicemailGreeting.create.mockResolvedValue(greetingRow({ sourceKey: 'source' }))
  prismaMock.voicemailGreeting.findFirst.mockResolvedValue(null)
  prismaMock.voicemailGreeting.findMany.mockResolvedValue([])
  prismaMock.voicemailGreeting.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.$queryRaw.mockResolvedValue([{ id: ORG_ID }])
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  putObjectBytesMock.mockResolvedValue(undefined)
  getRecordingDownloadUrlMock.mockImplementation(async (key: string) => `https://signed.example/${key}`)
  deleteObjectMock.mockResolvedValue(undefined)
  queueTranscodeGreetingMock.mockResolvedValue('job-a')
})

describe('POST /api/orgs/:orgId/voicemail-greeting', () => {
  it('stores a WebM upload, queues conversion, and returns the pending greeting', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .set('Idempotency-Key', 'test-upload')
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      greeting: expect.objectContaining({ id: 'greeting-a', status: 'transcoding', uploadedAt: null }),
    })
    expect(putObjectBytesMock).toHaveBeenCalledWith(expect.objectContaining({
      body: WEBM,
      contentType: 'audio/webm',
      key: expect.stringMatching(/^voicemail-greeting-uploads\/org-a\/.+\.webm$/),
    }))
    expect(queueTranscodeGreetingMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ID,
      greetingId: expect.any(String),
    }))
  })

  it('rejects a file whose bytes are not WebM or MP3 before storing it', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .set('Idempotency-Key', 'test-invalid')
      .attach('audio', Buffer.from('not audio'), { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(400)
    expect(putObjectBytesMock).not.toHaveBeenCalled()
    expect(prismaMock.voicemailGreeting.create).not.toHaveBeenCalled()
  })

  it('accepts an MP3 upload', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .set('Idempotency-Key', 'test-mp3')
      .attach('audio', MP3, { filename: 'greeting.mp3', contentType: 'audio/mpeg' })

    expect(response.status).toBe(201)
    expect(putObjectBytesMock).toHaveBeenCalledWith(expect.objectContaining({
      body: MP3,
      contentType: 'audio/mpeg',
      key: expect.stringMatching(/^voicemail-greeting-uploads\/org-a\/.+\.mp3$/),
    }))
  })

  it('returns the original candidate for an idempotent retry without uploading again', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue(greetingRow({
      status: 'transcoding',
      sourceKey: 'voicemail-greeting-uploads/org-a/greeting-a.webm',
      contentHash: createHash('sha256').update(WEBM).digest('hex'),
    }))

    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .set('Idempotency-Key', 'test-upload')
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(200)
    expect(response.body.greeting).toMatchObject({ id: 'greeting-a', status: 'transcoding' })
    expect(prismaMock.voicemailGreeting.create).not.toHaveBeenCalled()
    expect(putObjectBytesMock).not.toHaveBeenCalled()
    expect(queueTranscodeGreetingMock).not.toHaveBeenCalled()
  })

  it('rejects an idempotency key reused with different audio', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue(greetingRow({
      contentHash: 'different-content',
    }))

    const response = await request(app)
      .post(URL)
      .set('Authorization', AUTH)
      .set('Idempotency-Key', 'test-upload')
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(422)
    expect(putObjectBytesMock).not.toHaveBeenCalled()
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
      .set('Idempotency-Key', 'test-other-org')
      .attach('audio', WEBM, { filename: 'greeting.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(404)
    expect(putObjectBytesMock).not.toHaveBeenCalled()
    expect(prismaMock.voicemailGreeting.create).not.toHaveBeenCalled()
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

  it('returns signed playback only for non-deleted tenant-owned candidates', async () => {
    prismaMock.voicemailGreeting.findMany.mockResolvedValue([
      greetingRow({ id: 'active', status: 'active', storageKey: 'greetings/org-a/active.mp3' }),
      greetingRow({ id: 'ready', status: 'ready', storageKey: 'greetings/org-a/ready.mp3' }),
    ])

    const response = await request(app)
      .get(URL)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(response.body.greeting.active).toMatchObject({
      id: 'active', audioUrl: 'https://signed.example/greetings/org-a/active.mp3',
    })
    expect(response.body.greeting.candidates).toHaveLength(1)
    expect(prismaMock.voicemailGreeting.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, status: { not: 'deleted' } },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('POST /api/orgs/:orgId/voicemail-greeting/:greetingId/activate', () => {
  it('atomically promotes only a ready candidate and retires its prior active greeting', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue(greetingRow({
      id: 'candidate-a', status: 'active', storageKey: 'greetings/org-a/candidate-a.mp3',
    }))

    const response = await request(app)
      .post(`${URL}/candidate-a/activate`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(200)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.voicemailGreeting.updateMany).toHaveBeenNthCalledWith(1, {
      where: { orgId: ORG_ID, status: 'active', id: { not: 'candidate-a' } },
      data: { status: 'deleted', deletedAt: expect.any(Date) },
    })
    expect(prismaMock.voicemailGreeting.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'candidate-a', orgId: ORG_ID, status: 'ready' },
      data: { status: 'active' },
    })
  })

  it('does not retire the existing active greeting when the candidate is not ready', async () => {
    prismaMock.voicemailGreeting.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const response = await request(app)
      .post(`${URL}/candidate-a/activate`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(409)
    expect(prismaMock.voicemailGreeting.updateMany).toHaveBeenCalledTimes(2)
  })
})

describe('DELETE /api/orgs/:orgId/voicemail-greeting/:greetingId', () => {
  it('deletes a tenant-owned candidate and removes its private objects', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue(greetingRow({
      id: 'candidate-a',
      sourceKey: 'uploads/org-a/candidate-a.webm',
      storageKey: 'greetings/org-a/candidate-a.mp3',
    }))

    const response = await request(app)
      .delete(`${URL}/candidate-a`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(204)
    expect(prismaMock.voicemailGreeting.updateMany).toHaveBeenCalledWith({
      where: { id: 'candidate-a', orgId: ORG_ID, status: { not: 'deleted' } },
      data: { status: 'deleted', deletedAt: expect.any(Date) },
    })
    expect(deleteObjectMock).toHaveBeenCalledWith('uploads/org-a/candidate-a.webm')
    expect(deleteObjectMock).toHaveBeenCalledWith('greetings/org-a/candidate-a.mp3')
  })

  it('does not reveal or delete a candidate outside the organization', async () => {
    prismaMock.voicemailGreeting.findFirst.mockResolvedValue(null)

    const response = await request(app)
      .delete(`${URL}/candidate-b`)
      .set('Authorization', AUTH)

    expect(response.status).toBe(404)
    expect(prismaMock.voicemailGreeting.updateMany).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })
})
