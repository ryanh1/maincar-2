/**
 * emailActivity — the type-safe half of the Email / EmailParticipant /
 * EmailAttachment string columns, plus the row → API mappers the read routes use
 * (MAI-137 T9; spec §5.12, §6).
 *
 * The database columns are plain `String`s, because a Postgres enum needs an
 * ALTER TYPE dance to gain a value and this schema will gain values — a new
 * provider, a new role (.claude/rules/database-and-prisma.md → No Enums). The
 * unions below are the other half of that pair: the allowed values written once,
 * next to the guard that narrows an unknown string to them.
 *
 * The mappers live here rather than in the route so the shape a client sees is
 * stated in ONE place and can be unit-tested without an HTTP round-trip. Two
 * rules they hold to:
 *
 *   1. `orgId` never leaves the server. It is the tenant boundary, and the caller
 *      already knows it — it is in the path they asked on.
 *   2. A participant's `address` is ALWAYS returned, matched to a Person or not.
 *      The raw address is what was actually on the message; a personId is a link
 *      we drew later, and drawing it must never replace what the message said.
 */
import type { Email, EmailAttachment, EmailParticipant } from '../generated/prisma/client.js'

// --- The string unions -------------------------------------------------------

/** Which way the message went. `Email.direction`. */
export const EMAIL_DIRECTIONS = ['outbound', 'inbound'] as const
export type EmailDirection = (typeof EMAIL_DIRECTIONS)[number]

/** The provider's own importance flag. `Email.importance`. */
export const EMAIL_IMPORTANCES = ['low', 'normal', 'high'] as const
export type EmailImportance = (typeof EMAIL_IMPORTANCES)[number]

/**
 * Where an address sat on the message. `EmailParticipant.role`.
 *
 * `from` and `sender` are BOTH here and are not the same thing: RFC5322 lets a
 * message be written by one mailbox (`From`) and physically sent by another
 * (`Sender`) — a delegate or a shared mailbox. Collapsing them would lose the
 * fact that an assistant sent it.
 */
export const EMAIL_PARTICIPANT_ROLES = ['from', 'sender', 'to', 'cc', 'bcc', 'reply_to'] as const
export type EmailParticipantRole = (typeof EMAIL_PARTICIPANT_ROLES)[number]

/** Where the message was synced from. `Email.provider`. */
export const EMAIL_PROVIDERS = ['gmail', 'm365', 'imap'] as const
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number]

export function isEmailDirection(value: unknown): value is EmailDirection {
  return typeof value === 'string' && (EMAIL_DIRECTIONS as readonly string[]).includes(value)
}

export function isEmailImportance(value: unknown): value is EmailImportance {
  return typeof value === 'string' && (EMAIL_IMPORTANCES as readonly string[]).includes(value)
}

export function isEmailParticipantRole(value: unknown): value is EmailParticipantRole {
  return (
    typeof value === 'string' && (EMAIL_PARTICIPANT_ROLES as readonly string[]).includes(value)
  )
}

export function isEmailProvider(value: unknown): value is EmailProvider {
  return typeof value === 'string' && (EMAIL_PROVIDERS as readonly string[]).includes(value)
}

// --- Mappers: database row → API shape ---------------------------------------

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/**
 * One address on a message.
 *
 * `address` is unconditional and `personId` is nullable — that pair IS §5.12. A
 * stranger on a thread renders from `address` + `name`; the same row gains a
 * `personId` the day they become a Person, and nothing else about it changes.
 */
export function mapParticipantToApi(participant: EmailParticipant) {
  return {
    id: participant.id,
    role: participant.role,
    name: participant.name,
    address: participant.address,
    personId: participant.personId,
  }
}

/**
 * One attachment.
 *
 * `storageUrl` is deliberately ABSENT: the column holds a bare S3 object key, not
 * a link a browser can open, exactly as `Call.recordingUrl` does. Handing the key
 * to a client would be handing out an internal path that does nothing. `isStored`
 * carries the only part of it a client can act on — whether our copy exists yet —
 * and the download route presigns it at request time when one lands.
 */
export function mapAttachmentToApi(attachment: EmailAttachment) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    isInline: attachment.isInline,
    contentId: attachment.contentId,
    isStored: attachment.storageUrl !== null,
  }
}

/**
 * The list-row shape: enough for an inbox row, and no message body.
 *
 * The bodies are the biggest columns on the table and a list never renders them,
 * so a page of 50 would be megabytes of HTML nobody reads. `snippet` is the
 * preview the provider already computed for exactly this.
 */
export function mapEmailToListApi(
  email: Email & { participants?: EmailParticipant[]; _count?: { attachments: number } },
) {
  return {
    id: email.id,
    direction: email.direction,
    subject: email.subject,
    snippet: email.snippet,
    conversationId: email.conversationId,
    importance: email.importance,
    isRead: email.isRead,
    isDraft: email.isDraft,
    hasAttachments: email.hasAttachments,
    provider: email.provider,
    mailAccountId: email.mailAccountId,
    companyId: email.companyId,
    dealId: email.dealId,
    sentAt: iso(email.sentAt),
    receivedAt: iso(email.receivedAt),
    createdAt: email.createdAt.toISOString(),
    ...(email.participants ? { participants: email.participants.map(mapParticipantToApi) } : {}),
  }
}

/**
 * The single-message shape: everything the list carries, plus the bodies, the
 * threading headers, the full participant list, and the attachments.
 *
 * `bodyHtml` is UNTRUSTED: it is whatever a stranger's mail client produced. It
 * is stored and returned as received, because rewriting the evidence of what was
 * actually sent is not this layer's call — the renderer is what must not execute
 * it (a sandboxed frame, or a sanitizer at the point of display).
 *
 * `syncCursor` and `providerMessageId` are internal sync bookkeeping and are not
 * returned; `webLink` is, because "open in Gmail" is a thing a person clicks.
 */
export function mapEmailToDetailApi(
  email: Email & { participants: EmailParticipant[]; attachments: EmailAttachment[] },
) {
  return {
    id: email.id,
    direction: email.direction,
    subject: email.subject,
    bodyHtml: email.bodyHtml,
    bodyText: email.bodyText,
    snippet: email.snippet,
    internetMessageId: email.internetMessageId,
    conversationId: email.conversationId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    importance: email.importance,
    isRead: email.isRead,
    isDraft: email.isDraft,
    hasAttachments: email.hasAttachments,
    provider: email.provider,
    folderOrLabels: email.folderOrLabels,
    webLink: email.webLink,
    mailAccountId: email.mailAccountId,
    companyId: email.companyId,
    dealId: email.dealId,
    sentAt: iso(email.sentAt),
    receivedAt: iso(email.receivedAt),
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
    participants: email.participants.map(mapParticipantToApi),
    attachments: email.attachments.map(mapAttachmentToApi),
  }
}
