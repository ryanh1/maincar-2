// The canonical transcript data model has to be proved against Postgres: its
// unique keys and cascades are the safety boundary between provider-owned timed
// words and manual speaker identity.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import type { PrismaClient } from '../generated/prisma/client.js'
import { createTestPrisma, seedCall, seedOrgWithAdmin, seedPerson } from '../test/integration/testPrisma.js'

describe('canonical call transcript schema (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('stores one final pass with ordered, timed segments and stable speaker keys', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const transcript = await prisma.transcript.create({
      data: {
        orgId: org.orgId,
        callId: call.id,
        provider: 'deepgram',
        plainText: 'Hello there.',
      },
    })

    await prisma.transcriptSegment.createMany({
      data: [
        {
          orgId: org.orgId,
          transcriptId: transcript.id,
          position: 1,
          speakerKey: 'channel-1',
          startMs: 900,
          endMs: 1_400,
          text: 'there.',
          words: [{ word: 'there', startMs: 900, endMs: 1_400 }],
        },
        {
          orgId: org.orgId,
          transcriptId: transcript.id,
          position: 0,
          speakerKey: 'channel-0',
          startMs: 0,
          endMs: 700,
          text: 'Hello',
          words: [{ word: 'Hello', startMs: 0, endMs: 700 }],
        },
      ],
    })

    const persisted = await prisma.transcript.findFirstOrThrow({
      where: { id: transcript.id, orgId: org.orgId },
      include: { segments: { orderBy: { position: 'asc' } } },
    })

    expect(persisted.plainText).toBe('Hello there.')
    expect(persisted.segments.map((segment) => segment.speakerKey)).toEqual(['channel-0', 'channel-1'])
    expect(persisted.segments[0]).toMatchObject({ startMs: 0, endMs: 700, words: [{ word: 'Hello' }] })
    await expect(
      prisma.transcript.create({
        data: { orgId: org.orgId, callId: call.id, provider: 'deepgram', plainText: 'duplicate' },
      }),
    ).rejects.toThrow()
  })

  it('preserves a manual speaker correction when provider-owned segments are replaced', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const person = await seedPerson(prisma, { orgId: org.orgId, firstName: 'Jordan' })
    const transcript = await prisma.transcript.create({
      data: { orgId: org.orgId, callId: call.id, provider: 'deepgram', plainText: 'Original pass.' },
    })
    await prisma.transcriptSegment.create({
      data: {
        orgId: org.orgId,
        transcriptId: transcript.id,
        position: 0,
        speakerKey: 'channel-0',
        startMs: 0,
        endMs: 500,
        text: 'Original pass.',
        words: [],
      },
    })
    await prisma.callSpeaker.create({
      data: {
        orgId: org.orgId,
        callId: call.id,
        speakerKey: 'channel-0',
        displayName: 'Jordan Lee',
        source: 'manual',
        evidence: { reason: 'rep confirmed identity' },
        confidence: 1,
        personId: person.id,
        confirmedAt: new Date(),
        manualOverride: true,
      },
    })

    await prisma.$transaction([
      prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id, orgId: org.orgId } }),
      prisma.transcriptSegment.create({
        data: {
          orgId: org.orgId,
          transcriptId: transcript.id,
          position: 0,
          speakerKey: 'channel-0',
          startMs: 0,
          endMs: 650,
          text: 'Replacement pass.',
          words: [{ word: 'Replacement', startMs: 0, endMs: 650 }],
        },
      }),
      prisma.transcript.update({
        where: { callId: call.id },
        data: { plainText: 'Replacement pass.' },
      }),
    ])

    await expect(
      prisma.callSpeaker.findFirstOrThrow({ where: { callId: call.id, orgId: org.orgId, speakerKey: 'channel-0' } }),
    ).resolves.toMatchObject({ displayName: 'Jordan Lee', personId: person.id, manualOverride: true })
  })

  it('cascades transcript-derived rows but not the call-linked speaker identity', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const transcript = await prisma.transcript.create({
      data: { orgId: org.orgId, callId: call.id, provider: 'legacy', plainText: 'Imported transcript.' },
    })
    await prisma.transcriptSegment.create({
      data: {
        orgId: org.orgId,
        transcriptId: transcript.id,
        position: 0,
        speakerKey: 'channel-0',
        startMs: 0,
        endMs: 100,
        text: 'Imported transcript.',
        words: [],
      },
    })
    await prisma.callSpeaker.create({
      data: { orgId: org.orgId, callId: call.id, speakerKey: 'channel-0', source: 'provider' },
    })

    await prisma.transcript.delete({ where: { id: transcript.id } })

    await expect(prisma.transcriptSegment.findMany({ where: { transcriptId: transcript.id } })).resolves.toEqual([])
    await expect(prisma.callSpeaker.findFirstOrThrow({ where: { callId: call.id, orgId: org.orgId } })).resolves.toMatchObject({
      speakerKey: 'channel-0',
    })
  })

  it('creates the required indexes and cascades all transcript intelligence when its call is removed', async () => {
    const schema = inject('testSchema')
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = ${schema}
    `
    expect(indexes.map((index) => index.indexname)).toEqual(
      expect.arrayContaining([
        'Transcript_callId_key',
        'Transcript_orgId_idx',
        'TranscriptSegment_transcriptId_position_key',
        'TranscriptSegment_transcriptId_speakerKey_idx',
        'CallSpeaker_callId_speakerKey_key',
      ]),
    )

    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const transcript = await prisma.transcript.create({
      data: { orgId: org.orgId, callId: call.id, provider: 'deepgram', plainText: 'Remove me.' },
    })
    await prisma.transcriptSegment.create({
      data: {
        orgId: org.orgId,
        transcriptId: transcript.id,
        position: 0,
        speakerKey: 'channel-0',
        startMs: 0,
        endMs: 100,
        text: 'Remove me.',
        words: [],
      },
    })
    await prisma.callSpeaker.create({
      data: { orgId: org.orgId, callId: call.id, speakerKey: 'channel-0', source: 'provider' },
    })

    await prisma.call.delete({ where: { id: call.id } })

    await expect(prisma.transcript.findMany({ where: { callId: call.id } })).resolves.toEqual([])
    await expect(prisma.transcriptSegment.findMany({ where: { transcriptId: transcript.id } })).resolves.toEqual([])
    await expect(prisma.callSpeaker.findMany({ where: { callId: call.id } })).resolves.toEqual([])
  })
})
