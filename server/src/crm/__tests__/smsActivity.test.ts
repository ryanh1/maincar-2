// Unit tests for the SmsMessage / MessageMedia unions, guards, and mappers
// (MAI-138, T10).
//
// These prove the SHAPE a client sees, without an HTTP round-trip: which fields
// cross the wire, which deliberately do not, and that a text from a stranger maps
// to something readable with every spine link null. The route wiring is
// routes/__tests__/messages.test.ts; the real constraints are the integration
// suite.
import { describe, expect, it } from 'vitest'

import type { MessageMedia, SmsMessage } from '../../generated/prisma/client.js'
import {
  SMS_CHANNELS,
  SMS_DIRECTIONS,
  SMS_STATUSES,
  isSmsChannel,
  isSmsDirection,
  isSmsStatus,
  mapMediaToApi,
  mapSmsToDetailApi,
  mapSmsToListApi,
} from '../smsActivity.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')
const SENT = new Date('2026-08-20T09:30:00.000Z')
const DELIVERED = new Date('2026-08-20T09:30:04.000Z')

function smsRow(overrides: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'sms-1',
    orgId: 'org-a',
    personId: null,
    companyId: null,
    dealId: null,
    mailboxUserId: null,
    phoneNumberId: null,
    fromE164: '+12025550199',
    toE164: '+12025550123',
    direction: 'inbound',
    body: 'Hi, saw your listing',
    status: 'received',
    errorCode: null,
    errorMessage: null,
    numSegments: 1,
    numMedia: 0,
    channel: 'sms',
    twilioSid: 'SM0123456789abcdef',
    messagingServiceSid: null,
    price: '-0.0075',
    priceUnit: 'USD',
    sentAt: SENT,
    deliveredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function mediaRow(overrides: Partial<MessageMedia> = {}): MessageMedia {
  return {
    id: 'mm-1',
    orgId: 'org-a',
    smsMessageId: 'sms-1',
    contentType: 'image/jpeg',
    storageUrl: null,
    twilioMediaSid: 'ME0123456789abcdef',
    sizeBytes: 91_204,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// --- The unions ---------------------------------------------------------------

describe('the string unions', () => {
  it('lists both directions', () => {
    expect([...SMS_DIRECTIONS]).toEqual(['outbound', 'inbound'])
  })

  it("keeps Twilio's statuses verbatim, inbound terminal state included", () => {
    // `received` is the INBOUND terminal state, and it shares the column with the
    // outbound lifecycle because Twilio reports them all in one MessageStatus.
    expect([...SMS_STATUSES]).toEqual([
      'queued',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'failed',
      'received',
    ])
  })

  it('keeps undelivered and failed as SEPARATE failures', () => {
    // failed = never left Twilio. undelivered = left, and the carrier rejected it.
    // Collapsing them would lose which end broke.
    expect(SMS_STATUSES).toContain('failed')
    expect(SMS_STATUSES).toContain('undelivered')
  })

  it('carries the future channels on the same table', () => {
    expect([...SMS_CHANNELS]).toEqual(['sms', 'mms', 'rcs', 'whatsapp'])
  })

  it('narrows a known string and rejects everything else', () => {
    expect(isSmsDirection('inbound')).toBe(true)
    expect(isSmsDirection('sideways')).toBe(false)
    expect(isSmsStatus('delivered')).toBe(true)
    expect(isSmsStatus('DELIVERED')).toBe(false)
    expect(isSmsChannel('mms')).toBe(true)
    expect(isSmsChannel('pigeon')).toBe(false)
  })

  it('rejects a non-string without throwing', () => {
    for (const guard of [isSmsDirection, isSmsStatus, isSmsChannel]) {
      expect(guard(undefined)).toBe(false)
      expect(guard(null)).toBe(false)
      expect(guard(7)).toBe(false)
      expect(guard({})).toBe(false)
    }
  })
})

// --- The media mapper ---------------------------------------------------------

describe('mapMediaToApi', () => {
  it('never hands out the storage key, only whether our copy exists', () => {
    // The column is a bare S3 object KEY, exactly as Call.recordingUrl is. Handing
    // it to a client would be handing out an internal path that does nothing.
    const notYet = mapMediaToApi(mediaRow())
    expect(notYet).not.toHaveProperty('storageUrl')
    expect(notYet.isStored).toBe(false)

    const stored = mapMediaToApi(mediaRow({ storageUrl: 'maincar-mms/org-a/mm-1.jpg' }))
    expect(stored).not.toHaveProperty('storageUrl')
    expect(stored.isStored).toBe(true)
  })

  it('returns the type, size, and position a client can actually render', () => {
    expect(mapMediaToApi(mediaRow({ sortOrder: 1 }))).toEqual({
      id: 'mm-1',
      contentType: 'image/jpeg',
      sizeBytes: 91_204,
      sortOrder: 1,
      isStored: false,
    })
  })

  it('never returns orgId', () => {
    expect(mapMediaToApi(mediaRow())).not.toHaveProperty('orgId')
  })
})

// --- The list mapper ----------------------------------------------------------

describe('mapSmsToListApi', () => {
  it('maps an inbound text from a total stranger with every spine link null', () => {
    // THE acceptance case: nobody in the CRM, and the row still reads correctly
    // off its raw numbers alone.
    const row = mapSmsToListApi(smsRow())
    expect(row.personId).toBeNull()
    expect(row.companyId).toBeNull()
    expect(row.dealId).toBeNull()
    expect(row.fromE164).toBe('+12025550199')
    expect(row.toE164).toBe('+12025550123')
    expect(row.body).toBe('Hi, saw your listing')
  })

  it('KEEPS the body in a list row — unlike the email list', () => {
    // A text is a few hundred characters and the body is the whole message. A
    // text list with no text in it is not a list anyone can read.
    expect(mapSmsToListApi(smsRow()).body).toBe('Hi, saw your listing')
  })

  it('carries numMedia so a row shows a paperclip without joining the media table', () => {
    expect(mapSmsToListApi(smsRow({ numMedia: 2, channel: 'mms' })).numMedia).toBe(2)
  })

  it('serializes every timestamp as ISO, and a missing one as null', () => {
    const row = mapSmsToListApi(smsRow({ deliveredAt: null }))
    expect(row.sentAt).toBe('2026-08-20T09:30:00.000Z')
    expect(row.deliveredAt).toBeNull()
    expect(row.createdAt).toBe('2026-08-21T12:00:00.000Z')
  })

  it('never returns orgId or what the message cost', () => {
    const row = mapSmsToListApi(smsRow())
    expect(row).not.toHaveProperty('orgId')
    expect(row).not.toHaveProperty('price')
    expect(row).not.toHaveProperty('priceUnit')
  })
})

// --- The detail mapper --------------------------------------------------------

describe('mapSmsToDetailApi', () => {
  it('returns the delivery failure detail — the question a rep opens a failed text to ask', () => {
    const detail = mapSmsToDetailApi({
      ...smsRow({
        direction: 'outbound',
        status: 'undelivered',
        errorCode: '30003',
        errorMessage: 'Unreachable destination handset',
        sentAt: SENT,
        deliveredAt: null,
      }),
      media: [],
    })
    expect(detail.status).toBe('undelivered')
    expect(detail.errorCode).toBe('30003')
    expect(detail.errorMessage).toBe('Unreachable destination handset')
    // Left, never landed — and that gap IS the delivery failure.
    expect(detail.sentAt).not.toBeNull()
    expect(detail.deliveredAt).toBeNull()
  })

  it('returns a delivered message with both timestamps', () => {
    const detail = mapSmsToDetailApi({
      ...smsRow({ direction: 'outbound', status: 'delivered', deliveredAt: DELIVERED }),
      media: [],
    })
    expect(detail.sentAt).toBe('2026-08-20T09:30:00.000Z')
    expect(detail.deliveredAt).toBe('2026-08-20T09:30:04.000Z')
  })

  it('maps an MMS with two images to two media entries, in order', () => {
    const detail = mapSmsToDetailApi({
      ...smsRow({ channel: 'mms', numMedia: 2 }),
      media: [
        mediaRow({ id: 'mm-1', sortOrder: 0, contentType: 'image/jpeg' }),
        mediaRow({ id: 'mm-2', sortOrder: 1, contentType: 'image/png' }),
      ],
    })
    expect(detail.media).toHaveLength(2)
    expect(detail.media.map((m) => m.id)).toEqual(['mm-1', 'mm-2'])
    expect(detail.media.map((m) => m.sortOrder)).toEqual([0, 1])
    expect(detail.media.every((m) => m.isStored === false)).toBe(true)
  })

  it('returns the Twilio SIDs — non-secret identifiers a support ticket quotes', () => {
    const detail = mapSmsToDetailApi({ ...smsRow(), media: [] })
    expect(detail.twilioSid).toBe('SM0123456789abcdef')
    expect(detail).toHaveProperty('messagingServiceSid')
  })

  it('never returns orgId or the price — billing is not the conversation view', () => {
    const detail = mapSmsToDetailApi({ ...smsRow(), media: [] })
    expect(detail).not.toHaveProperty('orgId')
    expect(detail).not.toHaveProperty('price')
    expect(detail).not.toHaveProperty('priceUnit')
  })

  it('never leaks a media storage key through the detail shape either', () => {
    const detail = mapSmsToDetailApi({
      ...smsRow({ channel: 'mms', numMedia: 1 }),
      media: [mediaRow({ storageUrl: 'maincar-mms/org-a/mm-1.jpg' })],
    })
    expect(JSON.stringify(detail)).not.toContain('maincar-mms')
  })
})
