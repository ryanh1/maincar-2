// Unit tests for the activity-feed helpers (MAI-140 T12, spec §5.11a / §6).
//
// These cover the pure decisions — how a Call/Email/SmsMessage/Meeting row becomes
// the ONE feed line it deserves, which key columns are refused as empty, and how
// text is condensed for a row that has to paint itself with no join. The two claims
// only a real database can prove — that a rolled-back activity leaves NO feed row,
// and that the unique key actually stops a duplicate — live in
// ../../routes/__tests__/activity.integration.test.ts.
import { describe, expect, it, vi } from 'vitest'

import {
  ACTIVITY_DIRECTIONS,
  ACTIVITY_SOURCE_TYPES,
  ActivityFeedError,
  activityFromCall,
  activityFromEmail,
  activityFromMeeting,
  activityFromSms,
  condense,
  formatDuration,
  isActivityDirection,
  isActivitySourceType,
  mapActivityToApi,
  PREVIEW_MAX_LENGTH,
  recordActivityInTx,
  SUMMARY_MAX_LENGTH,
  type ActivityFeedClient,
  type NewActivityEntry,
} from '../activityFeed.js'
import type { Call, Email, Meeting, SmsMessage } from '../../generated/prisma/client.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')
const EARLIER = new Date('2026-08-20T09:30:00.000Z')

// The shape recordActivityInTx hands to Prisma. Captured rather than read off
// `mock.calls` so the assertions below are typed rather than cast at every site.
interface UpsertArgs {
  where: { orgId_sourceType_sourceId: Record<string, string> }
  create: Record<string, unknown>
  update: Record<string, unknown>
}

// A stand-in for the transaction client: a feed write only ever touches
// activityEntry.upsert, and the type says it must be a transaction client.
function fakeTx() {
  const calls: UpsertArgs[] = []
  const upsert = vi.fn(async (args: UpsertArgs) => {
    calls.push(args)
    return { id: 'feed-1' }
  })
  return { tx: { activityEntry: { upsert } } as unknown as ActivityFeedClient, upsert, calls }
}

function callRow(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    orgId: 'org-a',
    userId: 'user-a',
    fromE164: '+12025550000',
    toE164: '+12025550123',
    direction: 'outbound',
    status: 'queued',
    twilioCallSid: null,
    recordingConsent: 'granted',
    recordingEnabled: null,
    recordingUrl: null,
    recordingStatus: 'pending',
    transcriptStatus: 'pending',
    transcript: null,
    durationS: null,
    startedAt: null,
    endedAt: null,
    personId: null,
    companyId: null,
    dealId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Call
}

function emailRow(overrides: Partial<Email> = {}): Email {
  return {
    id: 'email-1',
    orgId: 'org-a',
    companyId: null,
    dealId: null,
    mailAccountId: null,
    direction: 'outbound',
    subject: 'Following up on the demo',
    bodyHtml: '<p>Hi Jane</p>',
    bodyText: 'Hi Jane',
    snippet: 'Hi Jane — great speaking today.',
    internetMessageId: null,
    conversationId: null,
    inReplyTo: null,
    references: [],
    importance: 'normal',
    isRead: false,
    isDraft: false,
    hasAttachments: false,
    provider: 'gmail',
    providerMessageId: null,
    providerThreadId: null,
    folderOrLabels: [],
    webLink: null,
    syncCursor: null,
    sentAt: EARLIER,
    receivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Email
}

function smsRow(overrides: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'sms-1',
    orgId: 'org-a',
    personId: null,
    companyId: null,
    dealId: null,
    mailboxUserId: 'user-a',
    phoneNumberId: null,
    fromE164: '+12025550000',
    toE164: '+12025550123',
    direction: 'outbound',
    body: 'Running five minutes late.',
    status: 'delivered',
    errorCode: null,
    errorMessage: null,
    numSegments: 1,
    numMedia: 0,
    channel: 'sms',
    twilioSid: null,
    messagingServiceSid: null,
    price: null,
    priceUnit: null,
    sentAt: EARLIER,
    deliveredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as SmsMessage
}

function meetingRow(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg-1',
    orgId: 'org-a',
    companyId: null,
    dealId: null,
    title: 'Discovery call',
    description: null,
    location: 'HQ, Room 4',
    joinUrl: 'https://meet.google.com/abc-defg-hij',
    conferenceProvider: 'google_meet',
    isAllDay: false,
    startsAt: EARLIER,
    endsAt: NOW,
    timeZone: 'America/New_York',
    status: 'confirmed',
    organizerEmail: 'rep@maincar.com',
    organizerPersonId: null,
    provider: 'google',
    providerEventId: null,
    iCalUid: null,
    recurringEventId: null,
    syncCursor: null,
    webLink: null,
    recordingUrl: null,
    recordingProvider: null,
    transcriptStatus: null,
    externalRecordingId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Meeting
}

function entry(overrides: Partial<NewActivityEntry> = {}): NewActivityEntry {
  return {
    orgId: 'org-a',
    sourceType: 'call',
    sourceId: 'call-1',
    summary: 'Called +12025550123',
    occurredAt: NOW,
    ...overrides,
  }
}

describe('the string unions', () => {
  it('accepts every documented source type and nothing else', () => {
    for (const value of ACTIVITY_SOURCE_TYPES) expect(isActivitySourceType(value)).toBe(true)
    expect(isActivitySourceType('voicemail')).toBe(false)
    expect(isActivitySourceType(null)).toBe(false)
    expect(isActivitySourceType(undefined)).toBe(false)
  })

  it('carries stage_change, so a deal moving is a thing the feed can show', () => {
    expect(ACTIVITY_SOURCE_TYPES).toContain('stage_change')
  })

  it('accepts every documented direction and nothing else', () => {
    for (const value of ACTIVITY_DIRECTIONS) expect(isActivityDirection(value)).toBe(true)
    expect(isActivityDirection('internal')).toBe(false)
    expect(isActivityDirection(null)).toBe(false)
  })
})

describe('condense', () => {
  it('flattens whitespace so a pasted body renders as one line', () => {
    expect(condense('Hi   Jane,\n\n Great\tspeaking. ', 100)).toBe('Hi Jane, Great speaking.')
  })

  it('returns null for absent or whitespace-only text — a cleared value is absent', () => {
    expect(condense(null, 100)).toBeNull()
    expect(condense(undefined, 100)).toBeNull()
    expect(condense('   \n ', 100)).toBeNull()
  })

  it('caps at the limit and marks the cut', () => {
    const out = condense('x'.repeat(500), 10)
    expect(out).toHaveLength(10)
    expect(out!.endsWith('…')).toBe(true)
  })

  it('leaves text at exactly the limit untouched', () => {
    const exact = 'y'.repeat(10)
    expect(condense(exact, 10)).toBe(exact)
  })
})

describe('formatDuration', () => {
  it('reads the way a person says it', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(252)).toBe('4m 12s')
    expect(formatDuration(120)).toBe('2m')
    expect(formatDuration(3600)).toBe('1h')
    expect(formatDuration(3720)).toBe('1h 2m')
  })

  it('is null for a call that never ran, so no row says "0s"', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(-5)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
  })
})

describe('activityFromCall', () => {
  it('summarizes an outbound call by the number dialed, and carries the spine', () => {
    const built = activityFromCall(
      callRow({ personId: 'person-1', companyId: 'co-1', dealId: 'deal-1' }),
    )
    expect(built).toMatchObject({
      orgId: 'org-a',
      sourceType: 'call',
      sourceId: 'call-1',
      summary: 'Called +12025550123',
      direction: 'outbound',
      createdByUserId: 'user-a',
      personId: 'person-1',
      companyId: 'co-1',
      dealId: 'deal-1',
    })
  })

  it('names the caller, not the callee, on an inbound call', () => {
    const built = activityFromCall(callRow({ direction: 'inbound' }))
    expect(built.summary).toBe('Call from +12025550000')
    expect(built.direction).toBe('inbound')
  })

  it('appends the duration once it is known', () => {
    expect(activityFromCall(callRow({ durationS: 252 })).summary).toBe(
      'Called +12025550123 — 4m 12s',
    )
  })

  it('places the call when it started, falling back to when the row was written', () => {
    expect(activityFromCall(callRow()).occurredAt).toBe(NOW)
    expect(activityFromCall(callRow({ startedAt: EARLIER })).occurredAt).toBe(EARLIER)
  })

  it('leaves direction null rather than storing a value the union does not allow', () => {
    expect(activityFromCall(callRow({ direction: 'sideways' })).direction).toBeNull()
  })
})

describe('activityFromEmail', () => {
  it('summarizes by subject and says which way it went', () => {
    expect(activityFromEmail(emailRow()).summary).toBe('Email sent: Following up on the demo')
    expect(activityFromEmail(emailRow({ direction: 'inbound' })).summary).toBe(
      'Email received: Following up on the demo',
    )
  })

  it('falls back to "(no subject)" rather than an empty feed line', () => {
    expect(activityFromEmail(emailRow({ subject: null })).summary).toBe('Email sent: (no subject)')
    expect(activityFromEmail(emailRow({ subject: '   ' })).summary).toBe('Email sent: (no subject)')
  })

  it('previews the provider snippet, never the HTML body', () => {
    const built = activityFromEmail(emailRow())
    expect(built.preview).toBe('Hi Jane — great speaking today.')
    expect(built.preview).not.toContain('<p>')
  })

  it('falls back to the plaintext body when there is no snippet', () => {
    expect(activityFromEmail(emailRow({ snippet: null })).preview).toBe('Hi Jane')
  })

  it('takes the person and the actor from the caller — an Email has neither', () => {
    const bare = activityFromEmail(emailRow())
    expect(bare.personId).toBeNull()
    expect(bare.createdByUserId).toBeNull()

    const linked = activityFromEmail(emailRow(), {
      personId: 'person-9',
      createdByUserId: 'user-9',
    })
    expect(linked.personId).toBe('person-9')
    expect(linked.createdByUserId).toBe('user-9')
  })

  it('prefers sentAt, then receivedAt, then the row', () => {
    expect(activityFromEmail(emailRow()).occurredAt).toBe(EARLIER)
    expect(activityFromEmail(emailRow({ sentAt: null, receivedAt: EARLIER })).occurredAt).toBe(
      EARLIER,
    )
    expect(activityFromEmail(emailRow({ sentAt: null, receivedAt: null })).occurredAt).toBe(NOW)
  })
})

describe('activityFromSms', () => {
  it('summarizes by the other end and carries the body as the preview', () => {
    const built = activityFromSms(smsRow())
    expect(built.summary).toBe('Texted +12025550123')
    expect(built.preview).toBe('Running five minutes late.')
    expect(built.createdByUserId).toBe('user-a')
  })

  it('names the sender on an inbound text', () => {
    expect(activityFromSms(smsRow({ direction: 'inbound' })).summary).toBe(
      'Text from +12025550000',
    )
  })

  it('says how many pictures came with an MMS that has no words', () => {
    const built = activityFromSms(smsRow({ body: null, numMedia: 2 }))
    expect(built.summary).toBe('Texted +12025550123 — 2 attached')
    expect(built.preview).toBeNull()
  })
})

describe('activityFromMeeting', () => {
  it('summarizes by title and previews the room', () => {
    const built = activityFromMeeting(meetingRow())
    expect(built.summary).toBe('Meeting: Discovery call')
    expect(built.preview).toBe('HQ, Room 4')
  })

  it('never puts the joinUrl in the preview — a feed row is not a link', () => {
    const built = activityFromMeeting(meetingRow({ location: null }))
    expect(built.preview).toBe('google_meet')
    expect(built.preview).not.toContain('http')
  })

  it('says so when a meeting was cancelled, because that is news about the account', () => {
    expect(activityFromMeeting(meetingRow({ status: 'cancelled' })).summary).toBe(
      'Meeting cancelled: Discovery call',
    )
  })

  it('has no direction, and is placed when it starts rather than when it synced', () => {
    const built = activityFromMeeting(meetingRow())
    expect(built.direction).toBeNull()
    expect(built.occurredAt).toBe(EARLIER)
  })

  it('links the organizer as the person', () => {
    expect(activityFromMeeting(meetingRow({ organizerPersonId: 'person-3' })).personId).toBe(
      'person-3',
    )
  })
})

describe('recordActivityInTx', () => {
  it('upserts on (orgId, sourceType, sourceId) so a re-save refreshes one row', async () => {
    const { tx, upsert, calls } = fakeTx()
    await recordActivityInTx(tx, entry())

    expect(upsert).toHaveBeenCalledTimes(1)
    const args = calls[0]
    expect(args.where.orgId_sourceType_sourceId).toEqual({
      orgId: 'org-a',
      sourceType: 'call',
      sourceId: 'call-1',
    })
    // The identity of a row is never updatable: an update must not be able to move
    // a feed row onto a different activity.
    expect(args.update).not.toHaveProperty('orgId')
    expect(args.update).not.toHaveProperty('sourceType')
    expect(args.update).not.toHaveProperty('sourceId')
  })

  it('defaults every optional link to null rather than leaving it undefined', async () => {
    const { tx, calls } = fakeTx()
    await recordActivityInTx(tx, entry())

    expect(calls[0].create).toMatchObject({
      preview: null,
      direction: null,
      createdByUserId: null,
      companyId: null,
      personId: null,
      dealId: null,
    })
  })

  it('condenses the summary and the preview before they are stored', async () => {
    const { tx, calls } = fakeTx()
    await recordActivityInTx(
      tx,
      entry({ summary: 'a'.repeat(500), preview: 'b'.repeat(500) }),
    )

    expect(calls[0].create.summary).toHaveLength(SUMMARY_MAX_LENGTH)
    expect(calls[0].create.preview).toHaveLength(PREVIEW_MAX_LENGTH)
  })

  // The key columns are NOT NULL in the schema, but an empty string is a legal
  // non-null value — and every unkeyed write would collide on the same row. These
  // are refused loudly, inside the transaction, so the activity rolls back with it.
  it('refuses an empty org, source id, or summary', async () => {
    const { tx, upsert } = fakeTx()
    await expect(recordActivityInTx(tx, entry({ orgId: '  ' }))).rejects.toBeInstanceOf(
      ActivityFeedError,
    )
    await expect(recordActivityInTx(tx, entry({ sourceId: '' }))).rejects.toBeInstanceOf(
      ActivityFeedError,
    )
    await expect(recordActivityInTx(tx, entry({ summary: '   ' }))).rejects.toBeInstanceOf(
      ActivityFeedError,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('refuses a source type or direction outside its union', async () => {
    const { tx, upsert } = fakeTx()
    await expect(
      recordActivityInTx(tx, entry({ sourceType: 'voicemail' as never })),
    ).rejects.toBeInstanceOf(ActivityFeedError)
    await expect(
      recordActivityInTx(tx, entry({ direction: 'sideways' as never })),
    ).rejects.toBeInstanceOf(ActivityFeedError)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('trims the key columns, so " call-1 " and "call-1" are one row', async () => {
    const { tx, calls } = fakeTx()
    await recordActivityInTx(tx, entry({ orgId: ' org-a ', sourceId: ' call-1 ' }))

    expect(calls[0].where.orgId_sourceType_sourceId.orgId).toBe('org-a')
    expect(calls[0].where.orgId_sourceType_sourceId.sourceId).toBe('call-1')
  })

  /**
   * The atomicity rule is a TYPE rule, so this is a type test: `@ts-expect-error`
   * fails the build if the line it guards ever stops being an error.
   *
   * It is here because the obvious spelling of the rule DOES NOT WORK, and looks
   * like it does. `Prisma.TransactionClient` is `Omit<PrismaClient, …>`, and
   * TypeScript is structural, so a full PrismaClient satisfies it — a parameter
   * typed as a bare TransactionClient accepts the singleton without complaint, and
   * the "feed rows are atomic with their activity" guarantee quietly becomes a
   * comment. `ActivityFeedClient` intersects the omitted members away to close
   * that. If someone simplifies the type back, this test goes red.
   */
  it('REFUSES the base PrismaClient at the type level, so a feed row cannot be written outside a transaction', () => {
    const notATransaction = {
      activityEntry: { upsert: vi.fn() },
      $connect: async () => {},
      $disconnect: async () => {},
      $extends: () => ({}),
    }

    // @ts-expect-error a client that can $connect/$disconnect is the singleton, not
    // a transaction client, and recordActivityInTx must not accept it.
    const rejected: ActivityFeedClient = notATransaction
    expect(rejected).toBeDefined()
  })
})

describe('mapActivityToApi', () => {
  it('returns everything a row renders, and never the tenant boundary', () => {
    const shaped = mapActivityToApi({
      id: 'feed-1',
      sourceType: 'call',
      sourceId: 'call-1',
      summary: 'Called +12025550123 — 4m 12s',
      preview: 'completed',
      direction: 'outbound',
      occurredAt: EARLIER,
      createdByUserId: 'user-a',
      companyId: 'co-1',
      personId: 'person-1',
      dealId: null,
      createdAt: NOW,
    })

    expect(shaped).not.toHaveProperty('orgId')
    expect(shaped.occurredAt).toBe(EARLIER.toISOString())
    expect(shaped.createdAt).toBe(NOW.toISOString())
    expect(shaped.summary).toBe('Called +12025550123 — 4m 12s')
    expect(shaped.dealId).toBeNull()
  })
})
