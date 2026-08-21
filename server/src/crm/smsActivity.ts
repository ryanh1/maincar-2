/**
 * smsActivity — the type-safe half of the SmsMessage / MessageMedia string
 * columns, plus the row → API mappers the read routes use (MAI-138 T10; spec §6).
 *
 * The same pairing emailActivity.ts uses, for the same reason: the database
 * columns are plain `String`s, because a Postgres enum needs an ALTER TYPE dance
 * to gain a value and this schema WILL gain values — RCS today is a channel
 * nobody sends and tomorrow is one everybody does
 * (.claude/rules/database-and-prisma.md → No Enums). The unions below are the
 * other half: the allowed values written once, next to the guard that narrows an
 * unknown string to them.
 *
 * The mappers live here rather than in the route so the shape a client sees is
 * stated in ONE place and can be unit-tested without an HTTP round-trip. Three
 * rules they hold to:
 *
 *   1. `orgId` never leaves the server. It is the tenant boundary, and the caller
 *      already knows it — it is in the path they asked on.
 *   2. `fromE164` and `toE164` are ALWAYS returned, matched to a Person or not.
 *      The raw numbers are what was actually on the message; a personId is a link
 *      we drew later, and drawing it must never replace what the message said.
 *   3. A media row's storage key never leaves either — see mapMediaToApi.
 */
import type { MessageMedia, SmsMessage } from '../generated/prisma/client.js'

// --- The string unions -------------------------------------------------------

/** Which way the message went. `SmsMessage.direction`. */
export const SMS_DIRECTIONS = ['outbound', 'inbound'] as const
export type SmsDirection = (typeof SMS_DIRECTIONS)[number]

/**
 * Twilio's Message status, verbatim. `SmsMessage.status`.
 *
 * `received` is the INBOUND terminal state and the rest are the outbound
 * lifecycle, which is why they share one column rather than one per direction:
 * Twilio reports them all in the same `MessageStatus` field, and splitting them
 * here would mean re-deriving on every write which half a webhook value belongs
 * to.
 *
 * `undelivered` and `failed` are both failures and are NOT the same failure:
 * `failed` means Twilio never got it out the door, `undelivered` means it left
 * and the carrier rejected it. Collapsing them would lose which end broke.
 */
export const SMS_STATUSES = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'received',
] as const
export type SmsStatus = (typeof SMS_STATUSES)[number]

/**
 * How the message travelled. `SmsMessage.channel`.
 *
 * Media for every one of them hangs off MessageMedia, so gaining a channel is a
 * new string here and not a new table.
 */
export const SMS_CHANNELS = ['sms', 'mms', 'rcs', 'whatsapp'] as const
export type SmsChannel = (typeof SMS_CHANNELS)[number]

export function isSmsDirection(value: unknown): value is SmsDirection {
  return typeof value === 'string' && (SMS_DIRECTIONS as readonly string[]).includes(value)
}

export function isSmsStatus(value: unknown): value is SmsStatus {
  return typeof value === 'string' && (SMS_STATUSES as readonly string[]).includes(value)
}

export function isSmsChannel(value: unknown): value is SmsChannel {
  return typeof value === 'string' && (SMS_CHANNELS as readonly string[]).includes(value)
}

// --- Mappers: database row → API shape ---------------------------------------

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/**
 * One piece of MMS media.
 *
 * `storageUrl` is deliberately ABSENT: the column holds a bare S3 object key, not
 * a link a browser can open, exactly as `Call.recordingUrl` and
 * `EmailAttachment.storageUrl` do. Handing the key to a client would be handing
 * out an internal path that does nothing. `isStored` carries the only part of it
 * a client can act on — whether our copy exists yet — which matters more here
 * than it does for email: Twilio purges its own media, so an un-stored row is one
 * whose bytes may already be gone for good.
 */
export function mapMediaToApi(media: MessageMedia) {
  return {
    id: media.id,
    contentType: media.contentType,
    sizeBytes: media.sizeBytes,
    sortOrder: media.sortOrder,
    isStored: media.storageUrl !== null,
  }
}

/**
 * The list-row shape: enough for a conversation row, without the media rows.
 *
 * `body` IS here, unlike Email's bodies in its list: a text is at most a few
 * hundred characters and the body is the whole message — a text list with no text
 * in it is not a list anyone can read. `numMedia` tells the row whether to show a
 * paperclip without joining the media table for every row on the page.
 */
export function mapSmsToListApi(message: SmsMessage & { _count?: { media: number } }) {
  return {
    id: message.id,
    direction: message.direction,
    fromE164: message.fromE164,
    toE164: message.toE164,
    body: message.body,
    status: message.status,
    channel: message.channel,
    numSegments: message.numSegments,
    numMedia: message.numMedia,
    personId: message.personId,
    companyId: message.companyId,
    dealId: message.dealId,
    mailboxUserId: message.mailboxUserId,
    phoneNumberId: message.phoneNumberId,
    sentAt: iso(message.sentAt),
    deliveredAt: iso(message.deliveredAt),
    createdAt: message.createdAt.toISOString(),
  }
}

/**
 * The single-message shape: everything the list carries, plus the delivery
 * failure detail and the media rows in the order they arrived on the message.
 *
 * `errorCode`/`errorMessage` are returned because "why did this not arrive" is
 * the question a rep opens a failed text to ask. The Twilio SIDs are returned
 * too — they are non-secret identifiers, and they are what a support ticket
 * quotes. `price`/`priceUnit` are NOT: what a message cost is the org's billing
 * business, not a fact the conversation view has any use for.
 */
export function mapSmsToDetailApi(message: SmsMessage & { media: MessageMedia[] }) {
  return {
    id: message.id,
    direction: message.direction,
    fromE164: message.fromE164,
    toE164: message.toE164,
    body: message.body,
    status: message.status,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    channel: message.channel,
    numSegments: message.numSegments,
    numMedia: message.numMedia,
    twilioSid: message.twilioSid,
    messagingServiceSid: message.messagingServiceSid,
    personId: message.personId,
    companyId: message.companyId,
    dealId: message.dealId,
    mailboxUserId: message.mailboxUserId,
    phoneNumberId: message.phoneNumberId,
    sentAt: iso(message.sentAt),
    deliveredAt: iso(message.deliveredAt),
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    media: message.media.map(mapMediaToApi),
  }
}
