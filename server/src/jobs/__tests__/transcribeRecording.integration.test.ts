import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DeepgramTranscript } from '../../../dependencies/deepgram.js'
import type { PrismaClient } from '../../generated/prisma/client.js'
import { seedCall, seedOrgWithAdmin, seedPerson } from '../../test/integration/testPrisma.js'
import { createTestPrisma } from '../../test/integration/testPrisma.js'
import { persistFinalTranscript } from '../transcribeRecording.js'

const FIXTURE: DeepgramTranscript = {
  plainText: 'Hello there.\nHola.',
  segments: [{
    channel: 0,
    speaker: 1,
    speakerKey: 'deepgram:channel:0:speaker:1',
    startMs: 200,
    endMs: 900,
    confidence: 0.98,
    language: 'en',
    text: 'Hello there.',
    words: [{
      word: 'Hello', punctuatedWord: 'Hello', startMs: 200, endMs: 500,
      confidence: 0.99, speaker: 1, speakerConfidence: 0.99, channel: 0, language: 'en',
    }],
  }],
}

const DUAL_CHANNEL_FIXTURE: DeepgramTranscript = {
  plainText: 'Thanks for calling.\nHappy to help.\nOne more question.',
  segments: [
    {
      channel: 0, speaker: 0, speakerKey: 'deepgram:channel:0:speaker:0', startMs: 0, endMs: 700,
      confidence: 0.99, language: 'en', text: 'Thanks for calling.', words: [],
    },
    {
      channel: 1, speaker: 0, speakerKey: 'deepgram:channel:1:speaker:0', startMs: 800, endMs: 1_400,
      confidence: 0.88, language: 'en', text: 'Happy to help.', words: [],
    },
    {
      channel: 1, speaker: 1, speakerKey: 'deepgram:channel:1:speaker:1', startMs: 1_500, endMs: 2_000,
      confidence: 0.76, language: 'en', text: 'One more question.', words: [],
    },
  ],
}

describe('Deepgram final-pass persistence (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => { prisma = createTestPrisma() })
  afterAll(async () => { await prisma.$disconnect() })

  it('atomically stores language, confidence, channel, speaker and timed words without overwriting manual speakers', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const person = await seedPerson(prisma, { orgId: org.orgId, firstName: 'Jordan' })
    await prisma.call.updateMany({ where: { id: call.id, orgId: org.orgId }, data: { recordingPlanned: true } })
    await prisma.callSpeaker.create({
      data: {
        orgId: org.orgId, callId: call.id, speakerKey: FIXTURE.segments[0].speakerKey,
        displayName: 'Jordan Lee', source: 'manual', personId: person.id, confirmedAt: new Date(), manualOverride: true,
      },
    })

    await expect(persistFinalTranscript(prisma, call.id, org.orgId, FIXTURE)).resolves.toBe(true)

    const persisted = await prisma.call.findFirstOrThrow({
      where: { id: call.id, orgId: org.orgId },
      include: { finalTranscript: { include: { segments: true } }, speakers: true },
    })
    expect(persisted).toMatchObject({ transcriptStatus: 'done', transcript: FIXTURE.plainText })
    expect(persisted.finalTranscript).toMatchObject({ provider: 'deepgram', plainText: FIXTURE.plainText })
    expect(persisted.finalTranscript!.segments[0]).toMatchObject({
      speakerKey: FIXTURE.segments[0].speakerKey, startMs: 200, endMs: 900,
      words: [{ channel: 0, language: 'en', confidence: 0.99, speaker: 1 }],
    })
    expect(persisted.speakers).toEqual([expect.objectContaining({ displayName: 'Jordan Lee', personId: person.id, manualOverride: true })])
  })

  it('seeds the known rep and safe outside labels, while retaining a manual correction on reprocessing', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const person = await seedPerson(prisma, { orgId: org.orgId, firstName: 'Jordan' })
    await prisma.call.updateMany({ where: { id: call.id, orgId: org.orgId }, data: { recordingPlanned: true } })

    await expect(persistFinalTranscript(prisma, call.id, org.orgId, DUAL_CHANNEL_FIXTURE)).resolves.toBe(true)

    const seeded = await prisma.callSpeaker.findMany({ where: { callId: call.id, orgId: org.orgId }, orderBy: { speakerKey: 'asc' } })
    expect(seeded).toEqual(expect.arrayContaining([
      expect.objectContaining({
        speakerKey: 'deepgram:channel:0:speaker:0', userId: org.adminUserId, displayName: 'Avery Admin',
        source: 'call-user', confidence: 1, evidence: { type: 'call-user', userId: org.adminUserId },
      }),
      expect.objectContaining({
        speakerKey: 'deepgram:channel:1:speaker:0', userId: null, displayName: 'Person 1', source: 'provider',
        confidence: 0.88, evidence: expect.objectContaining({ type: 'deepgram-speaker', channel: 1, speaker: 0 }),
      }),
      expect.objectContaining({
        speakerKey: 'deepgram:channel:1:speaker:1', userId: null, displayName: 'Person 2', source: 'provider',
        confidence: 0.76, evidence: expect.objectContaining({ type: 'deepgram-speaker', channel: 1, speaker: 1 }),
      }),
    ]))

    await prisma.callSpeaker.updateMany({
      where: { callId: call.id, orgId: org.orgId, speakerKey: 'deepgram:channel:1:speaker:0' },
      data: { displayName: 'Jordan Lee', source: 'manual', personId: person.id, manualOverride: true, confirmedAt: new Date() },
    })

    await expect(persistFinalTranscript(prisma, call.id, org.orgId, DUAL_CHANNEL_FIXTURE)).resolves.toBe(true)
    await expect(prisma.callSpeaker.findFirstOrThrow({
      where: { callId: call.id, orgId: org.orgId, speakerKey: 'deepgram:channel:1:speaker:0' },
    })).resolves.toMatchObject({ displayName: 'Jordan Lee', personId: person.id, source: 'manual', manualOverride: true })
    await expect(prisma.callSpeaker.findFirstOrThrow({
      where: { callId: call.id, orgId: org.orgId, speakerKey: 'deepgram:channel:0:speaker:0' },
    })).resolves.toMatchObject({ userId: org.adminUserId, displayName: 'Avery Admin', source: 'call-user' })
  })

  it('settles a successful no-speech recording as done with an empty transcript', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    await prisma.call.updateMany({ where: { id: call.id, orgId: org.orgId }, data: { recordingPlanned: true } })

    await expect(persistFinalTranscript(prisma, call.id, org.orgId, { plainText: '', segments: [] })).resolves.toBe(true)

    const persisted = await prisma.call.findFirstOrThrow({
      where: { id: call.id, orgId: org.orgId }, include: { finalTranscript: { include: { segments: true } } },
    })
    expect(persisted).toMatchObject({ transcriptStatus: 'done', transcript: '' })
    expect(persisted.finalTranscript).toMatchObject({ provider: 'deepgram', plainText: '', segments: [] })
  })
})
