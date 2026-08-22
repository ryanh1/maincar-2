// The review read model must be proved through the real route and real tenant
// rows: unit mocks cannot establish that a caller in one org cannot retrieve
// another org's CRM/transcript/media context.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock, presignMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  presignMock: vi.fn(),
}))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

// Signing is an external boundary. The route receives a deterministic short-lived
// URL here, while the persistence and authorization path stay fully real.
vi.mock('../../../dependencies/s3.js', () => ({
  getRecordingDownloadUrl: presignMock,
  RECORDING_URL_TTL_SECONDS: 3600,
}))

vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')

  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  url.searchParams.set('options', `-c search_path=${schema},public`)

  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema })
  return { default: new PrismaClient({ adapter }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedCall, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const as = (firebaseUid: string) => `Bearer ${firebaseUid}`

beforeAll(() => {
  verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
})

beforeEach(() => {
  presignMock.mockReset()
  presignMock.mockResolvedValue('https://minio.example.test/signed/call.mp3?sig=abc')
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('call review detail (integration, real Postgres, real route)', () => {
  it('does not disclose another organization’s call or issue a signed source', async () => {
    const mine = await seedOrgWithAdmin(prisma)
    const theirs = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: theirs.orgId, userId: theirs.adminUserId })

    const res = await request(app)
      .get(`/api/orgs/${mine.orgId}/calls/${call.id}`)
      .set('Authorization', as(mine.adminFirebaseUid))

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Call not found' })
    expect(presignMock).not.toHaveBeenCalled()
  })

  it('returns a fresh short-lived audio source while the transcript independently processes', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, status: 'completed' })
    await prisma.call.update({
      where: { id: call.id },
      data: {
        recordingEnabled: true,
        recordingStatus: 'stored',
        recordingUrl: `recordings/${call.id}.mp3`,
        transcriptStatus: 'pending',
      },
    })

    const before = Date.now()
    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/calls/${call.id}`)
      .set('Authorization', as(org.adminFirebaseUid))

    expect(res.status).toBe(200)
    expect(res.body.call.review.recording).toMatchObject({
      state: 'ready',
      source: { kind: 'audio', url: 'https://minio.example.test/signed/call.mp3?sig=abc' },
    })
    expect(new Date(res.body.call.review.recording.source.expiresAt).getTime()).toBeGreaterThan(before)
    expect(res.body.call.review.transcript).toEqual({ state: 'processing', pass: null })
    expect(presignMock).toHaveBeenCalledWith(`recordings/${call.id}.mp3`)
  })

  it('returns an honest missing source instead of a raw object key when signing fails', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId, status: 'completed' })
    await prisma.call.update({
      where: { id: call.id },
      data: { recordingStatus: 'stored', recordingUrl: `recordings/${call.id}.mp3` },
    })
    presignMock.mockRejectedValue(new Error('object is unavailable'))

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/calls/${call.id}`)
      .set('Authorization', as(org.adminFirebaseUid))

    expect(res.status).toBe(200)
    expect(res.body.call.review.recording).toEqual({ state: 'missing', source: null })
    expect(res.body.call.recordingUrl).toBeNull()
    expect(JSON.stringify(res.body)).not.toContain(`recordings/${call.id}.mp3`)
  })
})
