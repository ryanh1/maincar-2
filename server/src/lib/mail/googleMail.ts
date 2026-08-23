// googleMail.ts — the Gmail + Google Calendar implementation of `MailProvider`
// (SPEC-int-seam.md § Code style, IH-15). It composes the thin SDK wrapper in
// server/dependencies/gmail.ts and maps Google's world onto the seam:
//
//   - every access token comes from `withFreshAccessToken(connectionId)`, so this
//     file NEVER refreshes and NEVER handles a 401 itself — a 401 that survives a
//     fresh token is a real failure and becomes `MailAuthError` (SPEC AC 4).
//   - every provider payload is parsed with `zod` before it is trusted; a shape
//     Google changed surfaces as one `MailApiError` with a readable message, never
//     as `undefined.length` three frames up in the composer (SPEC § Code style).
//   - every Google error is normalized through mailErrors.ts. A caller catches a
//     Maincar error, never a gaxios one (SPEC AC 5).
//   - every `Date` crossing the seam is a UTC instant read from the provider's own
//     value (`internalDate`, RFC 3339), never `new Date()` computed here (SPEC AC 8/9).
//   - no message body is ever logged.
//
// PAGING. `listMessagesSince` is cursor-based. The initial read backfills through
// `messages.list` (paged by `pageToken`); once the backfill is exhausted the cursor
// switches to a Gmail `historyId` and every later read is a delta through
// `history.list`. That `historyId` cursor is the exact analogue of Microsoft Graph's
// `deltaLink` (microsoftMail / IH-16): both providers expose ONE "give me what
// changed since this opaque token" concept behind `listMessagesSince`, and a token
// the provider has expired throws `CursorExpiredError` so a caller restarts cleanly.

import { z } from 'zod'

import { gmailClient, type GmailClient } from '../../../dependencies/gmail.js'
import { ProviderApiError } from '../../../dependencies/providerApiError.js'
import { withFreshAccessToken } from './oauthConnections.js'
import {
  CursorExpiredError,
  MailApiError,
  MailAuthError,
  RateLimitedError,
} from './mailErrors.js'
import type {
  CalendarEvent,
  InboundMessage,
  MailAddress,
  MailProvider,
  OutboundEmail,
  SentEmail,
} from './MailProvider.js'

/** The mailbox fields googleMail needs — a subset of the `MailAccount` row. */
export interface GoogleMailAccount {
  /** The `OAuthConnection.id` whose grant sends and reads this mailbox. */
  connectionId: string
  /** The mailbox address, used as the `From` on an outbound message. */
  emailAddress: string
}

/**
 * How googleMail obtains a token-bound SDK client. In production it is one fresh
 * token per call through `withFreshAccessToken`; the contract suite injects a
 * client wired to mocked HTTP so no test reaches Google.
 */
export type MakeGmailClient = (connectionId: string) => Promise<GmailClient>

const defaultMakeClient: MakeGmailClient = async (connectionId) =>
  gmailClient(await withFreshAccessToken(connectionId))

// --- Provider-error mapping -------------------------------------------------
//
// The SDK wrapper throws a `ProviderApiError` carrying Google's HTTP status and
// (for a 429) its Retry-After already parsed. This is the ONE place those statuses
// become the seam's typed errors. A 404 is context-dependent — an expired
// `historyId` on a delta read, but a genuinely missing message on `getMessage` — so
// the cursor path handles its own 404 before delegating here.

/** Map a `ProviderApiError` onto the seam's typed error set. Never returns. */
function throwMappedError(err: ProviderApiError): never {
  switch (err.status) {
    case 401:
      // The token was fresh before the call (withFreshAccessToken owns refreshing),
      // so a 401 here is a dead grant, not a retryable blip. Surface it once.
      throw new MailAuthError()
    case 429:
    case 503:
      throw new RateLimitedError(err.retryAfterMs ?? 0)
    default:
      throw new MailApiError(`Gmail request failed${err.status != null ? ` (${err.status})` : ''}.`)
  }
}

/** Run a provider call, translating any `ProviderApiError` to a seam error. */
async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    if (err instanceof ProviderApiError) throwMappedError(err)
    throw err
  }
}

/** Parse a provider payload or throw a readable `MailApiError` — never a `TypeError`. */
function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new MailApiError(`Gmail returned ${what} that Maincar could not read.`)
  }
  return parsed.data
}

// --- zod schemas: the shapes we trust from Google ---------------------------

const HeaderSchema = z.object({ name: z.string(), value: z.string() })

type MessagePart = {
  mimeType?: string | null
  filename?: string | null
  headers?: { name: string; value: string }[] | null
  body?: { data?: string | null; size?: number | null } | null
  parts?: MessagePart[] | null
}

const MessagePartSchema: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().nullish(),
    filename: z.string().nullish(),
    headers: z.array(HeaderSchema).nullish(),
    body: z.object({ data: z.string().nullish(), size: z.number().nullish() }).nullish(),
    parts: z.array(MessagePartSchema).nullish(),
  }),
)

const GmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string().nullish(),
  labelIds: z.array(z.string()).nullish(),
  // Gmail's authoritative receive/send instant, ms since the UNIX epoch as a string.
  internalDate: z.string(),
  payload: MessagePartSchema.nullish(),
})

const GmailSendResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  // The created message carries Gmail's own send timestamp; we read it back rather
  // than computing one locally, so the stored record agrees with the provider.
  internalDate: z.string(),
})

const GmailProfileSchema = z.object({
  emailAddress: z.string().nullish(),
  historyId: z.string(),
})

const GmailListMessagesSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string().nullish() })).nullish(),
  nextPageToken: z.string().nullish(),
  resultSizeEstimate: z.number().nullish(),
})

const GmailHistoryListSchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(z.object({ message: z.object({ id: z.string(), threadId: z.string().nullish() }) }))
          .nullish(),
      }),
    )
    .nullish(),
  nextPageToken: z.string().nullish(),
  historyId: z.string(),
})

const CalendarDateSchema = z.object({
  date: z.string().nullish(), // all-day events: a bare calendar date, no time, no zone
  dateTime: z.string().nullish(), // timed events: an RFC 3339 instant with an offset
})

const CalendarAttendeeSchema = z.object({
  email: z.string().nullish(),
  displayName: z.string().nullish(),
})

const CalendarEventSchema = z.object({
  id: z.string(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  start: CalendarDateSchema.nullish(),
  end: CalendarDateSchema.nullish(),
  attendees: z.array(CalendarAttendeeSchema).nullish(),
  organizer: CalendarAttendeeSchema.nullish(),
})

const CalendarEventsListSchema = z.object({
  items: z.array(CalendarEventSchema).nullish(),
  nextPageToken: z.string().nullish(),
  nextSyncToken: z.string().nullish(),
})

// --- Address helpers --------------------------------------------------------

/** Render a MailAddress as an RFC 822 header value: `Name <email>` or bare `email`. */
function formatAddress(addr: MailAddress): string {
  return addr.name ? `${encodeHeaderWord(addr.name)} <${addr.email}>` : addr.email
}

/** Join a list of addresses for a To/Cc/Bcc header. */
function formatAddressList(addrs: MailAddress[]): string {
  return addrs.map(formatAddress).join(', ')
}

/**
 * Parse one RFC 822 address (`Name <email>` or bare `email`) into a MailAddress.
 * A display name in quotes is unquoted; anything without angle brackets is the email.
 */
function parseOneAddress(raw: string): MailAddress {
  const trimmed = raw.trim()
  const angle = trimmed.match(/^(.*)<([^>]+)>\s*$/)
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim()
    const email = angle[2].trim()
    return name ? { name, email } : { email }
  }
  return { email: trimmed }
}

/** Parse a To/Cc/From header value (comma-separated) into MailAddresses. */
function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseOneAddress)
}

/**
 * RFC 2047-encode a header word when it carries non-ASCII, so a display name or a
 * subject with an accent does not corrupt the header. Pure ASCII is left as-is.
 */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// --- RFC 822 message building ----------------------------------------------

const CRLF = '\r\n'

/**
 * Build the base64url-encoded RFC 822 message Gmail's `messages.send` takes as
 * `raw`. `bcc` IS written as a header here: Gmail reads it to deliver the blind
 * copy, then strips it before the message reaches any recipient, so a To/Cc
 * recipient never sees it. That is the seam's rule — bcc on the envelope, never in a
 * header a recipient can read — expressed in Gmail's wire form.
 */
function buildRawMessage(input: OutboundEmail, from: string): string {
  const headers: string[] = [
    `From: ${from}`,
    `To: ${formatAddressList(input.to)}`,
  ]
  if (input.cc && input.cc.length > 0) headers.push(`Cc: ${formatAddressList(input.cc)}`)
  if (input.bcc && input.bcc.length > 0) headers.push(`Bcc: ${formatAddressList(input.bcc)}`)
  if (input.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${input.inReplyToMessageId}`)
    headers.push(`References: ${input.inReplyToMessageId}`)
  }
  headers.push(`Subject: ${encodeHeaderWord(input.subject)}`)
  headers.push('MIME-Version: 1.0')

  const attachments = input.attachments ?? []
  let message: string
  if (attachments.length === 0) {
    headers.push('Content-Type: text/html; charset="UTF-8"')
    headers.push('Content-Transfer-Encoding: base64')
    message =
      headers.join(CRLF) +
      CRLF +
      CRLF +
      chunk76(Buffer.from(input.bodyHtml, 'utf8').toString('base64'))
  } else {
    const boundary = `maincar_${Math.random().toString(36).slice(2)}`
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    const parts: string[] = []
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      chunk76(Buffer.from(input.bodyHtml, 'utf8').toString('base64')),
    )
    for (const att of attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        chunk76(att.contentBase64),
      )
    }
    parts.push(`--${boundary}--`)
    message = headers.join(CRLF) + CRLF + CRLF + parts.join(CRLF)
  }
  return Buffer.from(message, 'utf8').toString('base64url')
}

/** Wrap a base64 body at 76 columns, as RFC 2045 asks. */
function chunk76(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join(CRLF)
}

// --- Message mapping --------------------------------------------------------

type ParsedMessage = z.infer<typeof GmailMessageSchema>

/** Find a header value case-insensitively on a message part. */
function header(parsed: ParsedMessage, name: string): string | undefined {
  const headers = parsed.payload?.headers ?? []
  const lower = name.toLowerCase()
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? undefined
}

/** Depth-first find the first body part of a given MIME type, decoding its base64url. */
function bodyOfType(part: MessagePart | null | undefined, mimeType: string): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8')
  }
  for (const child of part.parts ?? []) {
    const found = bodyOfType(child, mimeType)
    if (found !== null) return found
  }
  return null
}

/** Map a parsed Gmail message onto the seam's `InboundMessage`. */
function toInboundMessage(parsed: ParsedMessage): InboundMessage {
  const fromList = parseAddressList(header(parsed, 'from'))
  return {
    providerMsgId: parsed.id,
    threadId: parsed.threadId ?? null,
    from: fromList[0] ?? { email: '' },
    to: parseAddressList(header(parsed, 'to')),
    cc: parseAddressList(header(parsed, 'cc')),
    subject: header(parsed, 'subject') ?? null,
    bodyHtml: bodyOfType(parsed.payload, 'text/html'),
    bodyText: bodyOfType(parsed.payload, 'text/plain'),
    // internalDate is ms since the UNIX epoch — an absolute UTC instant.
    sentAt: new Date(Number(parsed.internalDate)),
    isOutbound: (parsed.labelIds ?? []).includes('SENT'),
  }
}

/** Order messages oldest-first — the read order the seam publishes. */
function oldestFirst(messages: InboundMessage[]): InboundMessage[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
}

// --- Calendar mapping -------------------------------------------------------

type ParsedEvent = z.infer<typeof CalendarEventSchema>

function toMailAddress(a: { email?: string | null; displayName?: string | null }): MailAddress {
  return a.displayName ? { name: a.displayName, email: a.email ?? '' } : { email: a.email ?? '' }
}

/** Map a parsed Google Calendar event onto the seam's `CalendarEvent`. */
function toCalendarEvent(parsed: ParsedEvent): CalendarEvent {
  const isAllDay = Boolean(parsed.start?.date)
  const startRaw = parsed.start?.dateTime ?? parsed.start?.date
  const endRaw = parsed.end?.dateTime ?? parsed.end?.date
  if (!startRaw || !endRaw) {
    throw new MailApiError('Google Calendar returned an event with no start or end.')
  }
  return {
    providerEventId: parsed.id,
    title: parsed.summary ?? null,
    description: parsed.description ?? null,
    // Both an RFC 3339 dateTime and a bare all-day date parse to a UTC instant.
    startsAt: new Date(startRaw),
    endsAt: new Date(endRaw),
    isAllDay,
    attendees: (parsed.attendees ?? []).map(toMailAddress),
    organizer: parsed.organizer ? toMailAddress(parsed.organizer) : null,
  }
}

// --- Cursor encoding --------------------------------------------------------
//
// The cursor is opaque to the caller. It carries one of two states: a `messages.list`
// backfill page token (during the initial full read) or a Gmail `historyId` (every
// read after the backfill is exhausted). A token this file did not mint — including
// one another provider or a stored row hands back — is treated as a `historyId`, so a
// stale delta cursor flows straight to `history.list` and expires there.

type BackfillCursor = { t: 'b'; p: string; h: string }
type DeltaCursor = { t: 'd'; h: string }

function encodeCursor(c: BackfillCursor | DeltaCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

type DecodedCursor = { mode: 'backfill'; pageToken: string; seed: string } | { mode: 'delta'; historyId: string }

function decodeCursor(cursor: string): DecodedCursor {
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as
      | Partial<BackfillCursor>
      | Partial<DeltaCursor>
    if (obj && obj.t === 'b' && typeof obj.p === 'string' && typeof obj.h === 'string') {
      return { mode: 'backfill', pageToken: obj.p, seed: obj.h }
    }
    if (obj && obj.t === 'd' && typeof obj.h === 'string') {
      return { mode: 'delta', historyId: obj.h }
    }
  } catch {
    // Not one of ours — fall through and treat the raw string as a historyId.
  }
  return { mode: 'delta', historyId: cursor }
}

// --- The provider -----------------------------------------------------------

/**
 * Build the Gmail + Google Calendar `MailProvider` for one mailbox. Every method
 * acquires a fresh token-bound client, so a token that expired between calls is
 * refreshed by `withFreshAccessToken` and never handled here.
 */
export function googleMail(
  account: GoogleMailAccount,
  makeClient: MakeGmailClient = defaultMakeClient,
): MailProvider {
  const client = (): Promise<GmailClient> => makeClient(account.connectionId)

  /** Fetch and map one full message by id. */
  async function fetchMessage(id: string): Promise<InboundMessage> {
    const raw = await guard(() => client().then((c) => c.getMessage(id, 'full')))
    return toInboundMessage(parseOrThrow(GmailMessageSchema, raw, 'a message'))
  }

  return {
    provider: 'google',

    async sendEmail(input: OutboundEmail): Promise<SentEmail> {
      const raw = buildRawMessage(input, formatAddress({ email: account.emailAddress }))
      const rawResp = await guard(() => client().then((c) => c.sendMessage(raw, input.threadId)))
      const sent = parseOrThrow(GmailSendResponseSchema, rawResp, 'a send receipt')
      return {
        providerMsgId: sent.id,
        threadId: sent.threadId,
        // The provider's own send instant, not one computed during this call.
        sentAt: new Date(Number(sent.internalDate)),
      }
    },

    async listMessagesSince(
      cursor: string | null,
      limit: number,
    ): Promise<{ messages: InboundMessage[]; nextCursor: string | null }> {
      const decoded = cursor === null ? null : decodeCursor(cursor)

      if (decoded === null || decoded.mode === 'backfill') {
        // --- Backfill: enumerate ids through messages.list, oldest-first ---
        // A fresh backfill first reads the mailbox's current historyId; it becomes
        // the delta cursor once the backfill is exhausted, so the very next read is a
        // delta rather than a re-scan.
        const seed =
          decoded === null
            ? parseOrThrow(GmailProfileSchema, await guard(() => client().then((c) => c.getProfile())), 'a profile')
                .historyId
            : decoded.seed
        const pageToken = decoded === null ? undefined : decoded.pageToken
        const listRaw = await guard(() =>
          client().then((c) => c.listMessages({ maxResults: limit, pageToken })),
        )
        const list = parseOrThrow(GmailListMessagesSchema, listRaw, 'a message list')
        const ids = (list.messages ?? []).map((m) => m.id)
        const messages = oldestFirst(await Promise.all(ids.map(fetchMessage)))
        const nextCursor = list.nextPageToken
          ? encodeCursor({ t: 'b', p: list.nextPageToken, h: seed })
          : encodeCursor({ t: 'd', h: seed })
        return { messages, nextCursor }
      }

      // --- Delta: history.list since a historyId ---
      // A historyId Gmail has aged out returns 404; that is the seam's
      // CursorExpiredError, telling the caller to restart the sync cleanly.
      let historyRaw: unknown
      try {
        historyRaw = await client().then((c) =>
          c.listHistory({ startHistoryId: decoded.historyId, maxResults: limit, historyTypes: ['messageAdded'] }),
        )
      } catch (err) {
        if (err instanceof ProviderApiError && err.status === 404) throw new CursorExpiredError()
        if (err instanceof ProviderApiError) throwMappedError(err)
        throw err
      }
      const history = parseOrThrow(GmailHistoryListSchema, historyRaw, 'a history page')
      const ids = (history.history ?? []).flatMap((h) =>
        (h.messagesAdded ?? []).map((a) => a.message.id),
      )
      const messages = oldestFirst(await Promise.all(ids.map(fetchMessage)))
      return { messages, nextCursor: encodeCursor({ t: 'd', h: history.historyId }) }
    },

    async getMessage(providerMsgId: string): Promise<InboundMessage> {
      return fetchMessage(providerMsgId)
    },

    async listBackfillMessages(cursor, limit, since) {
      const months = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (30 * 24 * 60 * 60 * 1000)))
      const raw = await guard(() =>
        client().then((c) => c.listMessages({ maxResults: limit, pageToken: cursor ?? undefined, q: `newer_than:${months}m` })),
      )
      const page = parseOrThrow(GmailListMessagesSchema, raw, 'a historical message list')
      const messages = oldestFirst(await Promise.all((page.messages ?? []).map((message) => fetchMessage(message.id))))
      return { messages, nextCursor: page.nextPageToken ?? null }
    },

    async listEventsSince(
      cursor: string | null,
      limit: number,
    ): Promise<{ events: CalendarEvent[]; nextCursor: string | null }> {
      // A stored `nextSyncToken` is Google Calendar's delta cursor — the analogue of
      // Graph's deltaLink. Replaying an expired one returns 410 Gone, which becomes
      // CursorExpiredError so the caller restarts the calendar sync.
      let raw: unknown
      try {
        raw = await client().then((c) =>
          c.listEvents(
            cursor === null
              ? { maxResults: limit, singleEvents: true, orderBy: 'startTime' }
              : { maxResults: limit, singleEvents: true, syncToken: cursor },
          ),
        )
      } catch (err) {
        if (err instanceof ProviderApiError && err.status === 410) throw new CursorExpiredError()
        if (err instanceof ProviderApiError) throwMappedError(err)
        throw err
      }
      const parsed = parseOrThrow(CalendarEventsListSchema, raw, 'an event list')
      const events = (parsed.items ?? []).map(toCalendarEvent)
      return { events, nextCursor: parsed.nextSyncToken ?? null }
    },

    async createEvent(
      input: Omit<CalendarEvent, 'providerEventId' | 'organizer'>,
    ): Promise<CalendarEvent> {
      const requestBody = input.isAllDay
        ? {
            summary: input.title ?? undefined,
            description: input.description ?? undefined,
            start: { date: input.startsAt.toISOString().slice(0, 10) },
            end: { date: input.endsAt.toISOString().slice(0, 10) },
            attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.name })),
          }
        : {
            summary: input.title ?? undefined,
            description: input.description ?? undefined,
            // Emit UTC instants; the seam does not carry a wall-clock zone.
            start: { dateTime: input.startsAt.toISOString(), timeZone: 'UTC' },
            end: { dateTime: input.endsAt.toISOString(), timeZone: 'UTC' },
            attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.name })),
          }
      const raw = await guard(() => client().then((c) => c.createEvent(requestBody)))
      return toCalendarEvent(parseOrThrow(CalendarEventSchema, raw, 'a created event'))
    },
  }
}
