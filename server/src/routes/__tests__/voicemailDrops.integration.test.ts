// The real-Postgres delete route: its transaction must leave an org with one
// drop and one default, even when two deletion requests arrive together.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const {
  verifyTokenMock,
  deleteObjectMock,
  putObjectBytesMock,
  queueTranscodeVoicemailDropMock,
  queueTranscribeVoicemailDropMock,
} = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  putObjectBytesMock: vi.fn(),
  queueTranscodeVoicemailDropMock: vi.fn(),
  queueTranscribeVoicemailDropMock: vi.fn(),
}))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
vi.mock('../../../dependencies/s3.js', () => ({
  deleteObject: deleteObjectMock,
  putObjectBytes: putObjectBytesMock,
}))
vi.mock('../../jobs/transcodeVoicemailDrop.js', () => ({
  queueTranscodeVoicemailDrop: queueTranscodeVoicemailDropMock,
}))
vi.mock('../../jobs/transcribeVoicemailDrop.js', () => ({
  queueTranscribeVoicemailDrop: queueTranscribeVoicemailDropMock,
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
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

function as(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

async function createDrop(
  orgId: string,
  name: string,
  isDefault: boolean,
  createdAt: Date,
) {
  return prisma.voicemailDrop.create({
    data: {
      orgId,
      name,
      audioUrl: `maincar-voicemail-drops/${orgId}/${name.toLowerCase().replaceAll(' ', '-')}.mp3`,
      duration: 15,
      isDefault,
      createdAt,
    },
  })
}

beforeAll(() => {
  verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  deleteObjectMock.mockResolvedValue(undefined)
  putObjectBytesMock.mockResolvedValue(undefined)
  queueTranscodeVoicemailDropMock.mockResolvedValue('transcode-job')
  queueTranscribeVoicemailDropMock.mockResolvedValue('transcribe-job')
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('DELETE /api/orgs/:orgId/voicemail-drops/:id (integration, real Postgres)', () => {
  it('promotes the oldest surviving drop when deleting the default, and refuses the final drop', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const oldest = await createDrop(org.orgId, 'Oldest', false, new Date('2026-08-20T12:00:00.000Z'))
    await createDrop(org.orgId, 'Newer', false, new Date('2026-08-21T12:00:00.000Z'))
    const defaultDrop = await createDrop(org.orgId, 'Default', true, new Date('2026-08-22T12:00:00.000Z'))

    const deleted = await request(app)
      .delete(`/api/orgs/${org.orgId}/voicemail-drops/${defaultDrop.id}`)
      .set('Authorization', as(org.adminFirebaseUid))

    expect(deleted.status).toBe(204)
    expect(deleteObjectMock).toHaveBeenCalledWith(defaultDrop.audioUrl)
    expect(await prisma.voicemailDrop.findUnique({ where: { id: defaultDrop.id } })).toBeNull()
    const promoted = await prisma.voicemailDrop.findUniqueOrThrow({ where: { id: oldest.id } })
    expect(promoted.isDefault).toBe(true)

    const remaining = await prisma.voicemailDrop.findMany({ where: { orgId: org.orgId } })
    const finalAttempt = await request(app)
      .delete(`/api/orgs/${org.orgId}/voicemail-drops/${remaining[0]!.id}`)
      .set('Authorization', as(org.adminFirebaseUid))
    expect(finalAttempt.status).toBe(204)

    const last = await prisma.voicemailDrop.findFirstOrThrow({ where: { orgId: org.orgId } })
    const refused = await request(app)
      .delete(`/api/orgs/${org.orgId}/voicemail-drops/${last.id}`)
      .set('Authorization', as(org.adminFirebaseUid))
    expect(refused.status).toBe(400)
    expect(await prisma.voicemailDrop.count({ where: { orgId: org.orgId } })).toBe(1)
  })

  it('serializes simultaneous deletions so the library never becomes empty', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const first = await createDrop(org.orgId, 'Default', true, new Date('2026-08-20T12:00:00.000Z'))
    const second = await createDrop(org.orgId, 'Alternative', false, new Date('2026-08-21T12:00:00.000Z'))

    const [left, right] = await Promise.all([
      request(app)
        .delete(`/api/orgs/${org.orgId}/voicemail-drops/${first.id}`)
        .set('Authorization', as(org.adminFirebaseUid)),
      request(app)
        .delete(`/api/orgs/${org.orgId}/voicemail-drops/${second.id}`)
        .set('Authorization', as(org.adminFirebaseUid)),
    ])

    expect([left.status, right.status].sort()).toEqual([204, 400])
    const remaining = await prisma.voicemailDrop.findMany({ where: { orgId: org.orgId } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.isDefault).toBe(true)
  })
})

describe('PATCH /api/orgs/:orgId/voicemail-drops/:id (integration, real Postgres)', () => {
  it('renames a drop and atomically makes it the organization default', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const oldDefault = await createDrop(org.orgId, 'Original default', true, new Date('2026-08-20T12:00:00.000Z'))
    const promoted = await createDrop(org.orgId, 'Alternative', false, new Date('2026-08-21T12:00:00.000Z'))

    const response = await request(app)
      .patch(`/api/orgs/${org.orgId}/voicemail-drops/${promoted.id}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ name: 'New default', isDefault: true })

    expect(response.status).toBe(200)
    expect(response.body.drop).toMatchObject({ id: promoted.id, name: 'New default', isDefault: true })
    expect(await prisma.voicemailDrop.findUniqueOrThrow({ where: { id: oldDefault.id } })).toMatchObject({ isDefault: false })
    expect(await prisma.voicemailDrop.findUniqueOrThrow({ where: { id: promoted.id } })).toMatchObject({
      name: 'New default',
      isDefault: true,
    })
  })

  it('re-records a drop from WebM and queues its processing jobs', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const drop = await createDrop(org.orgId, 'Original', true, new Date('2026-08-20T12:00:00.000Z'))
    await prisma.voicemailDrop.updateMany({
      where: { id: drop.id, orgId: org.orgId },
      data: { transcript: 'Old transcript', transcriptStatus: 'done' },
    })
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00])

    const response = await request(app)
      .patch(`/api/orgs/${org.orgId}/voicemail-drops/${drop.id}`)
      .set('Authorization', as(org.adminFirebaseUid))
      .attach('audio', audio, { contentType: 'audio/webm', filename: 'replacement.webm' })

    expect(response.status).toBe(200)
    expect(putObjectBytesMock).toHaveBeenCalledWith({
      key: `maincar-voicemail-drops/${org.orgId}/${drop.id}.webm`,
      body: audio,
      contentType: 'audio/webm',
    })
    expect(queueTranscodeVoicemailDropMock).toHaveBeenCalledWith({ orgId: org.orgId, voicemailDropId: drop.id })
    expect(queueTranscribeVoicemailDropMock).toHaveBeenCalledWith(drop.id)
    expect(await prisma.voicemailDrop.findUniqueOrThrow({ where: { id: drop.id } })).toMatchObject({
      audioUrl: `maincar-voicemail-drops/${org.orgId}/${drop.id}.webm`,
      duration: 0,
      transcript: null,
      transcriptStatus: 'pending',
    })
  })
})
