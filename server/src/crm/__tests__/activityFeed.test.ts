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
  activityFromNote,
  activityFromSms,
  condense,
  formatDuration,
  isActivityDirection,
  isActivitySourceType,
  mapActivityToApi,
  PREVIEW_MAX_LENGTH,
  recordActivityInTx,
  SUMMARY_MAX_LENGTH,
  TIMELINE_EVENT_INTENSITIES,
  TIMELINE_EVENT_MARKER_TYPES,
  TIMELINE_EVENT_SUBTYPES,
  TIMELINE_EVENT_VERSION,
  validateTimelineEventProjection,
  type ActivityFeedClient,
  type NewActivityEntry,
  type TimelineEventProjection,
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

  it('documents timeline-only source types as string values, never Prisma enums', () => {
    expect(ACTIVITY_SOURCE_TYPES).toEqual(expect.arrayContaining(['task', 'record_created', 'custom']))
  })
})

describe('the versioned timeline-event projection', () => {
  function projection(overrides: Partial<TimelineEventProjection> = {}): TimelineEventProjection {
    return {
      version: TIMELINE_EVENT_VERSION,
      title: 'Call with Jane Doe',
      preview: 'Discussed the September rollout.',
      subtype: 'completed',
      intensity: 3,
      display: {
        actorName: 'Al Pha',
        personName: 'Jane Doe',
        dealName: 'Enterprise renewal',
      },
      ...overrides,
    }
  }

  it('validates the durable v1 shape before it is written', () => {
    expect(validateTimelineEventProjection(projection())).toMatchObject(projection())
    expect(TIMELINE_EVENT_SUBTYPES).toContain('completed')
    expect(TIMELINE_EVENT_INTENSITIES).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps deal-ribbon marker data optional and typed', () => {
    const marked = projection({
      marker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
    })

    expect(validateTimelineEventProjection(marked)).toEqual(marked)
    expect(TIMELINE_EVENT_MARKER_TYPES).toEqual([
      'deal_created',
      'stage_moved',
      'closed_won',
      'closed_lost',
    ])
  })

  it.each([
    projection({ version: 2 as never }),
    projection({ title: '   ' }),
    projection({ preview: 'x'.repeat(PREVIEW_MAX_LENGTH + 1) }),
    projection({ subtype: 'not-a-subtype' as never }),
    projection({ intensity: 0 as never }),
    projection({ display: { actorName: '   ' } }),
    projection({ marker: { type: 'stage_moved', before: 'Discovery' } as never }),
  ])('rejects an invalid projection before persistence: %o', (invalid) => {
    expect(() => validateTimelineEventProjection(invalid)).toThrow(ActivityFeedError)
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

// The note builder (MAI-141 T13). A note is the one activity with no title, no
// counterparty and no subject, so its own opening line is the summary.
describe('activityFromNote', () => {
  function noteRow(overrides: Partial<{ bodyText: string; authorUserId: string | null }> = {}) {
    return {
      id: 'note-1',
      orgId: 'org-a',
      bodyText: 'They want pricing by Friday.\nSend the deck first.',
      authorUserId: 'user-a' as string | null,
      createdAt: EARLIER,
      ...overrides,
    }
  }

  it('summarizes with the note’s opening line and previews the rest', () => {
    const built = activityFromNote(noteRow())
    expect(built.sourceType).toBe('note')
    expect(built.sourceId).toBe('note-1')
    expect(built.summary).toBe('Note: They want pricing by Friday.')
    expect(built.preview).toBe('They want pricing by Friday. Send the deck first.')
  })

  it('still builds a row for a note whose body is a picture', () => {
    // An empty summary would be refused by recordActivityInTx, so the fallback is
    // what keeps an image-only note in the feed at all.
    expect(activityFromNote(noteRow({ bodyText: '' })).summary).toBe('Note added')
    expect(activityFromNote(noteRow({ bodyText: '   ' })).summary).toBe('Note added')
  })

  it('keeps the summary inside the column’s budget for a wall-of-text note', () => {
    const built = activityFromNote(noteRow({ bodyText: 'z'.repeat(SUMMARY_MAX_LENGTH * 2) }))
    expect(built.summary.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH)
    expect(built.preview!.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH)
  })

  it('has no direction, and is placed when the note was written', () => {
    const built = activityFromNote(noteRow())
    expect(built.direction).toBeNull()
    expect(built.occurredAt).toBe(EARLIER)
  })

  it('credits the author, and carries the at-most-one spine link it was handed', () => {
    const built = activityFromNote(noteRow(), {
      companyId: 'co-1',
      personId: 'person-1',
      dealId: null,
    })
    expect(built.createdByUserId).toBe('user-a')
    expect(built.companyId).toBe('co-1')
    expect(built.personId).toBe('person-1')
    expect(built.dealId).toBeNull()
  })

  it('defaults every spine link to null when the caller passes none', () => {
    const built = activityFromNote(noteRow({ authorUserId: null }))
    expect(built.createdByUserId).toBeNull()
    expect(built.companyId).toBeNull()
    expect(built.personId).toBeNull()
    expect(built.dealId).toBeNull()
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

  it('persists a validated v1 projection while preserving the generic feed fields', async () => {
    const { tx, calls } = fakeTx()
    await recordActivityInTx(
      tx,
      entry({
        timeline: {
          version: 1,
          title: 'Call with Jane Doe',
          preview: 'Discussed the September rollout.',
          subtype: 'completed',
          intensity: 3,
          display: { actorName: 'Al Pha', personName: 'Jane Doe', dealName: 'Enterprise renewal' },
          marker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
        },
      }),
    )

    expect(calls[0].create).toMatchObject({
      summary: 'Called +12025550123',
      preview: 'Discussed the September rollout.',
      timelineVersion: 1,
      timelineTitle: 'Call with Jane Doe',
      timelineSubtype: 'completed',
      timelineIntensity: 3,
      timelineDisplay: {
        actorName: 'Al Pha',
        personName: 'Jane Doe',
        dealName: 'Enterprise renewal',
      },
      timelineMarker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
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

  it('refuses an invalid timeline projection before it reaches Prisma', async () => {
    const { tx, upsert } = fakeTx()
    await expect(
      recordActivityInTx(
        tx,
        entry({
          timeline: {
            version: 1,
            title: 'Call with Jane Doe',
            intensity: 0 as never,
            display: {},
          },
        }),
      ),
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
