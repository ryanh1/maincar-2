// An integration test against a REAL Postgres schema (see
// vitest.integration.config.ts and src/test/integration/*).
//
// The unit suite mocks Prisma, so it proves the route ASKS for the right reads.
// This proves the things only real row state and real constraints can — which for
// T10 (MAI-138) is the whole acceptance list:
//   - an inbound text from an UNKNOWN number logs, every spine link null;
//   - an MMS with two images stores two media rows;
//   - twilioSid is UNIQUE, so a re-delivered webhook is idempotent;
// plus the SetNull/Cascade rules that decide what survives a deletion.
//
// The inbound cases are driven from a Twilio-shaped webhook payload rather than
// from hand-written column values, so this also answers the ticket's "simulate an
// inbound MMS webhook shape": the payload below is the form body Twilio actually
// POSTs, and `fromInboundWebhook` is the mapping the later webhook route will do.
// Run it with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import {
  createTestPrisma,
  seedCompany,
  seedOrgWithAdmin,
  seedPerson,
  seedPhoneNumber,
} from '../../test/integration/testPrisma.js'

/**
 * The form body Twilio POSTs to an inbound message webhook. Every value arrives
 * as a STRING — including the counts — which is exactly why the mapping below has
 * to parse them, and why a test that skipped the payload and wrote numbers
 * straight into the columns would not be testing the thing that breaks.
 */
type TwilioInboundPayload = Record<string, string>

function inboundPayload(overrides: TwilioInboundPayload = {}): TwilioInboundPayload {
  return {
    MessageSid: `SM${Math.random().toString(36).slice(2, 14)}`,
    AccountSid: 'AC00000000000000000000000000000000',
    From: '+12025550199',
    To: '+12025550123',
    Body: 'Hi, saw your listing',
    NumSegments: '1',
    NumMedia: '0',
    SmsStatus: 'received',
    ...overrides,
  }
}

/** The Prisma create input a webhook route will build from that payload. */
function fromInboundWebhook(
  payload: TwilioInboundPayload,
  ctx: { orgId: string; phoneNumberId?: string | null; mailboxUserId?: string | null },
) {
  const numMedia = Number(payload.NumMedia ?? '0')
  return {
    orgId: ctx.orgId,
    phoneNumberId: ctx.phoneNumberId ?? null,
    mailboxUserId: ctx.mailboxUserId ?? null,
    direction: 'inbound',
    fromE164: payload.From,
    toE164: payload.To,
    body: payload.Body ?? null,
    status: payload.SmsStatus ?? 'received',
    numSegments: Number(payload.NumSegments ?? '1'),
    numMedia,
    // MMS is not a different message, it is a message with media on it.
    channel: numMedia > 0 ? 'mms' : 'sms',
    twilioSid: payload.MessageSid,
    sentAt: new Date(),
    media: {
      create: Array.from({ length: numMedia }, (_unused, i) => ({
        orgId: ctx.orgId,
        contentType: payload[`MediaContentType${i}`],
        twilioMediaSid: payload[`MediaUrl${i}`].split('/').pop() ?? null,
        sortOrder: i,
      })),
    },
  }
}

describe('SMS activity spine (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // --- Acceptance: an inbound text from an unknown number logs ----------------

  it('logs an inbound text from an UNKNOWN number, every spine link null', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })

    // Nobody in this org has ever heard of +12025550199. The message still logs.
    const payload = inboundPayload({ To: ours.e164 })
    const message = await prisma.smsMessage.create({
      data: fromInboundWebhook(payload, {
        orgId,
        phoneNumberId: ours.id,
        mailboxUserId: adminUserId,
      }),
    })

    expect(message.personId).toBeNull()
    expect(message.companyId).toBeNull()
    expect(message.dealId).toBeNull()
    // And the row still says everything a rep needs to read it: the raw numbers
    // and the body are what was actually on the message.
    expect(message.fromE164).toBe('+12025550199')
    expect(message.toE164).toBe(ours.e164)
    expect(message.body).toBe('Hi, saw your listing')
    expect(message.direction).toBe('inbound')
    expect(message.status).toBe('received')
    expect(message.channel).toBe('sms')
    expect(message.numMedia).toBe(0)
  })

  it('matches that same text to a Person LATER without rewriting what was said', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const stranger = '+12025550444'

    const message = await prisma.smsMessage.create({
      data: fromInboundWebhook(inboundPayload({ From: stranger, To: ours.e164 }), {
        orgId,
        phoneNumberId: ours.id,
      }),
    })

    // The stranger becomes a Person at a Company — an import, an enrichment, a rep
    // adding them.
    const company = await seedCompany(prisma, { orgId, name: 'Acme' })
    const person = await seedPerson(prisma, { orgId, companyId: company.id, firstName: 'Dana' })

    // The match writes the links and NOTHING else. orgId is in the where clause,
    // and updateMany rather than update by id — the tenant key is where the
    // boundary lives (.claude/rules/database-and-prisma.md).
    const linked = await prisma.smsMessage.updateMany({
      where: { orgId, fromE164: stranger, personId: null },
      data: { personId: person.id, companyId: company.id },
    })
    expect(linked.count).toBe(1)

    const after = await prisma.smsMessage.findFirstOrThrow({ where: { id: message.id, orgId } })
    expect(after.personId).toBe(person.id)
    expect(after.companyId).toBe(company.id)
    // The raw numbers and the body are untouched: drawing a link must never
    // replace what the message said.
    expect(after.fromE164).toBe(stranger)
    expect(after.body).toBe('Hi, saw your listing')

    // And the Person can reach it from their side.
    const fromPerson = await prisma.person.findFirstOrThrow({
      where: { id: person.id, orgId },
      include: { smsMessages: true },
    })
    expect(fromPerson.smsMessages.map((m) => m.id)).toEqual([message.id])
  })

  // --- Acceptance: an MMS with two images stores two media rows ---------------

  it('stores an MMS with TWO images as two media rows, in the order Twilio numbered them', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })

    const payload = inboundPayload({
      To: ours.e164,
      Body: 'Here are the photos',
      NumMedia: '2',
      MediaContentType0: 'image/jpeg',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/SM0/Media/ME000000000001',
      MediaContentType1: 'image/png',
      MediaUrl1: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/SM0/Media/ME000000000002',
    })

    const message = await prisma.smsMessage.create({
      data: fromInboundWebhook(payload, { orgId, phoneNumberId: ours.id }),
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    })

    expect(message.channel).toBe('mms')
    expect(message.numMedia).toBe(2)
    expect(message.media).toHaveLength(2)
    expect(message.media.map((m) => m.contentType)).toEqual(['image/jpeg', 'image/png'])
    expect(message.media.map((m) => m.sortOrder)).toEqual([0, 1])
    expect(message.media.map((m) => m.twilioMediaSid)).toEqual([
      'ME000000000001',
      'ME000000000002',
    ])
    // Neither is ours yet — the fetch job has not run. That matters more here than
    // for email: Twilio purges its own copies, so an un-stored row is one whose
    // bytes are on a clock.
    expect(message.media.every((m) => m.storageUrl === null)).toBe(true)
    // The count Twilio reported and the rows we stored agree.
    expect(await prisma.messageMedia.count({ where: { orgId, smsMessageId: message.id } })).toBe(
      message.numMedia,
    )
  })

  it('cascades the media away with the message, and never the other way round', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const message = await prisma.smsMessage.create({
      data: fromInboundWebhook(
        inboundPayload({
          To: ours.e164,
          NumMedia: '1',
          MediaContentType0: 'video/mp4',
          MediaUrl0: 'https://api.twilio.com/x/Media/ME000000000003',
        }),
        { orgId, phoneNumberId: ours.id },
      ),
    })
    expect(await prisma.messageMedia.count({ where: { orgId, smsMessageId: message.id } })).toBe(1)

    await prisma.smsMessage.deleteMany({ where: { id: message.id, orgId } })
    expect(await prisma.messageMedia.count({ where: { orgId, smsMessageId: message.id } })).toBe(0)
  })

  // --- Acceptance: twilioSid is unique ---------------------------------------

  it('rejects a SECOND insert of the same twilioSid (the constraint itself)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const payload = inboundPayload({ To: ours.e164 })

    await prisma.smsMessage.create({ data: fromInboundWebhook(payload, { orgId }) })
    await expect(
      prisma.smsMessage.create({ data: fromInboundWebhook(payload, { orgId }) }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('is idempotent when Twilio RE-DELIVERS the same webhook', async () => {
    // Twilio retries a webhook it did not get a 2xx for, with the SAME MessageSid.
    // The delivery is the ordinary case, not an error, and it must not log the
    // text twice.
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const payload = inboundPayload({ To: ours.e164 })
    const create = fromInboundWebhook(payload, { orgId, phoneNumberId: ours.id })

    const first = await prisma.smsMessage.upsert({
      where: { twilioSid: payload.MessageSid },
      create,
      update: {},
    })
    const second = await prisma.smsMessage.upsert({
      where: { twilioSid: payload.MessageSid },
      // The retry carries the same body, and a status callback may have moved on.
      create,
      update: { status: 'received' },
    })

    expect(second.id).toBe(first.id)
    expect(await prisma.smsMessage.count({ where: { orgId, twilioSid: payload.MessageSid } })).toBe(
      1,
    )
    // And the retry did not duplicate the media either.
    expect(await prisma.messageMedia.count({ where: { orgId, smsMessageId: first.id } })).toBe(0)
  })

  it('does not collide two rows that have NO twilioSid yet (NULLs are distinct)', async () => {
    // A row written before Twilio has accepted the message has no SID. Two of them
    // are two messages, not a constraint violation.
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const base = {
      orgId,
      phoneNumberId: ours.id,
      mailboxUserId: adminUserId,
      direction: 'outbound',
      fromE164: ours.e164,
      toE164: '+12025550777',
    }

    await prisma.smsMessage.create({ data: { ...base, body: 'One', status: 'queued' } })
    await prisma.smsMessage.create({ data: { ...base, body: 'Two', status: 'queued' } })

    expect(await prisma.smsMessage.count({ where: { orgId, twilioSid: null } })).toBe(2)
  })

  it('holds twilioSid unique ACROSS orgs — a Twilio SID is global, not per tenant', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const payload = inboundPayload()

    await prisma.smsMessage.create({ data: fromInboundWebhook(payload, { orgId: a.orgId }) })
    await expect(
      prisma.smsMessage.create({ data: fromInboundWebhook(payload, { orgId: b.orgId }) }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  // --- What survives a deletion ----------------------------------------------

  it('keeps the text when the Person, Company, or Deal is deleted (SetNull)', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const company = await seedCompany(prisma, { orgId, name: 'Doomed Co' })
    const person = await seedPerson(prisma, { orgId, companyId: company.id, firstName: 'Gone' })
    const pipeline = await prisma.pipeline.create({
      data: { orgId, name: 'New Business', isDefault: true },
    })
    const stage = await prisma.pipelineStage.create({
      data: { orgId, pipelineId: pipeline.id, name: 'Qualified', sortOrder: 1 },
    })
    const deal = await prisma.deal.create({
      data: {
        orgId,
        name: 'Doomed expansion',
        companyId: company.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
      },
    })

    const message = await prisma.smsMessage.create({
      data: {
        ...fromInboundWebhook(inboundPayload({ To: ours.e164 }), { orgId, phoneNumberId: ours.id }),
        personId: person.id,
        companyId: company.id,
        dealId: deal.id,
      },
    })

    await prisma.deal.deleteMany({ where: { id: deal.id, orgId } })
    await prisma.person.deleteMany({ where: { id: person.id, orgId } })
    await prisma.company.deleteMany({ where: { id: company.id, orgId } })

    const survivor = await prisma.smsMessage.findFirstOrThrow({ where: { id: message.id, orgId } })
    expect(survivor.personId).toBeNull()
    expect(survivor.companyId).toBeNull()
    expect(survivor.dealId).toBeNull()
    // The message itself, and what it actually said, is untouched.
    expect(survivor.body).toBe('Hi, saw your listing')
    expect(survivor.fromE164).toBe('+12025550199')
  })

  it('keeps the text when the REP is deleted — the org record outlives the employee', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const message = await prisma.smsMessage.create({
      data: {
        orgId,
        mailboxUserId: adminUserId,
        direction: 'outbound',
        fromE164: '+12025550123',
        toE164: '+12025550199',
        body: 'Said before they left',
        status: 'delivered',
        sentAt: new Date('2026-08-20T09:30:00.000Z'),
        deliveredAt: new Date('2026-08-20T09:30:04.000Z'),
      },
    })

    await prisma.user.deleteMany({ where: { id: adminUserId } })

    const survivor = await prisma.smsMessage.findFirstOrThrow({ where: { id: message.id, orgId } })
    expect(survivor.mailboxUserId).toBeNull()
    expect(survivor.body).toBe('Said before they left')
    expect(survivor.deliveredAt).not.toBeNull()
  })

  it('cascades every message and its media away with the ORG', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const message = await prisma.smsMessage.create({
      data: fromInboundWebhook(
        inboundPayload({
          To: ours.e164,
          NumMedia: '1',
          MediaContentType0: 'image/gif',
          MediaUrl0: 'https://api.twilio.com/x/Media/ME000000000004',
        }),
        { orgId, phoneNumberId: ours.id },
      ),
    })

    await prisma.org.deleteMany({ where: { id: orgId } })

    expect(await prisma.smsMessage.count({ where: { id: message.id } })).toBe(0)
    expect(await prisma.messageMedia.count({ where: { smsMessageId: message.id } })).toBe(0)
  })

  // --- The tenant boundary and the feed --------------------------------------

  it('keeps one org out of another org text list', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)

    await prisma.smsMessage.create({
      data: fromInboundWebhook(inboundPayload({ Body: 'A' }), { orgId: a.orgId }),
    })
    const bRow = await prisma.smsMessage.create({
      data: fromInboundWebhook(inboundPayload({ Body: 'B' }), { orgId: b.orgId }),
    })

    const listA = await prisma.smsMessage.findMany({ where: { orgId: a.orgId } })
    expect(listA.map((m) => m.body)).toEqual(['A'])
    // And an id from org B is not findable under org A's tenant key.
    expect(await prisma.smsMessage.findFirst({ where: { id: bRow.id, orgId: a.orgId } })).toBeNull()
  })

  it('reads a Company feed of texts in one indexed round-trip, newest first', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })
    const company = await seedCompany(prisma, { orgId, name: 'Feedco' })

    const older = await prisma.smsMessage.create({
      data: {
        ...fromInboundWebhook(inboundPayload({ To: ours.e164, Body: 'older' }), { orgId }),
        companyId: company.id,
        sentAt: new Date('2026-08-18T10:00:00.000Z'),
      },
    })
    const newer = await prisma.smsMessage.create({
      data: {
        ...fromInboundWebhook(inboundPayload({ To: ours.e164, Body: 'newer' }), { orgId }),
        companyId: company.id,
        sentAt: new Date('2026-08-19T10:00:00.000Z'),
      },
    })

    const feed = await prisma.smsMessage.findMany({
      where: { orgId, companyId: company.id },
      orderBy: [{ sentAt: 'desc' }],
    })
    expect(feed.map((m) => m.id)).toEqual([newer.id, older.id])
  })

  it('round-trips an outbound failure: sent, never delivered, with the carrier reason', async () => {
    const { orgId, adminUserId } = await seedOrgWithAdmin(prisma)
    const ours = await seedPhoneNumber(prisma, { orgId, assignedUserId: adminUserId })

    const message = await prisma.smsMessage.create({
      data: {
        orgId,
        phoneNumberId: ours.id,
        mailboxUserId: adminUserId,
        direction: 'outbound',
        fromE164: ours.e164,
        toE164: '+12025550199',
        body: 'Are you still interested?',
        status: 'undelivered',
        errorCode: '30003',
        errorMessage: 'Unreachable destination handset',
        numSegments: 1,
        twilioSid: `SM${Math.random().toString(36).slice(2, 14)}`,
        sentAt: new Date('2026-08-20T09:30:00.000Z'),
      },
    })

    // It left, and it never landed. That gap IS the delivery failure — which is
    // why sentAt and deliveredAt are two columns and not one.
    expect(message.sentAt).not.toBeNull()
    expect(message.deliveredAt).toBeNull()
    expect(message.status).toBe('undelivered')
    expect(message.errorCode).toBe('30003')
  })
})
