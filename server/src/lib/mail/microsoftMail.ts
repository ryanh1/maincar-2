// microsoftMail.ts — the Outlook mail + Microsoft Calendar implementation of
// `MailProvider` (SPEC-int-seam.md § Code style, IH-16). It is the sibling of
// googleMail.ts: same shape, same rules, Graph's world mapped onto the seam.
//
//   - every access token comes from `withFreshAccessToken(connectionId)`, so this
//     file NEVER refreshes and NEVER handles a 401 itself — a 401 that survives a
//     fresh token is a real failure and becomes `MailAuthError` (SPEC AC 4).
//   - every provider payload is parsed with `zod` before it is trusted; a shape
//     Microsoft changed surfaces as one `MailApiError` with a readable message,
//     never as `undefined.length` three frames up in the composer (SPEC § Code style).
//   - every Graph error is normalized through mailErrors.ts. A caller catches a
//     Maincar error, never a Graph one (SPEC AC 5).
//   - every `Date` crossing the seam is a UTC instant. Graph's calendar returns a
//     wall-clock `dateTime` with a SEPARATE `timeZone` field and NO offset in the
//     string, so a naive `new Date(dateTime)` would read it as server-local. This
//     file combines the two into a real UTC instant (SPEC AC 8/9). Mail datetimes
//     (`sentDateTime`) already carry `Z`.
//   - no message body is ever logged.
//
// PAGING. `listMessagesSince` is cursor-based. Graph's inbox delta returns each page
// with either an `@odata.nextLink` (more pages this sweep) or an `@odata.deltaLink`
// (caught up — replay it later for what changed since). Both are opaque, absolute
// URLs, so the cursor IS that URL, stored and replayed verbatim through the SDK
// wrapper's `deltaLink` argument. That deltaLink is the exact analogue of Gmail's
// `historyId` (googleMail / IH-15): one "give me what changed since this token"
// concept behind `listMessagesSince`. A delta token Graph has invalidated comes back
// 410 Gone, which becomes `CursorExpiredError` so a caller restarts cleanly.

import { z } from 'zod'

import { graphClient, type GraphClient } from '../../../dependencies/graph.js'
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
  SendEmailResult,
} from './MailProvider.js'

/** The mailbox fields microsoftMail needs — a subset of the `MailAccount` row. */
export interface MicrosoftMailAccount {
  /** The `OAuthConnection.id` whose grant sends and reads this mailbox. */
  connectionId: string
  /** The mailbox address; used as the sender identity and to flag the rep's own mail. */
  emailAddress: string
}

/**
 * How microsoftMail obtains a token-bound SDK client. In production it is one fresh
 * token per call through `withFreshAccessToken`; the contract suite injects a client
 * wired to mocked HTTP so no test reaches Microsoft.
 */
export type MakeGraphClient = (connectionId: string) => Promise<GraphClient>

const defaultMakeClient: MakeGraphClient = async (connectionId) =>
  graphClient(await withFreshAccessToken(connectionId))

// --- The calendar delta window ---------------------------------------------
//
// Graph's `calendarView/delta` needs a bounded time window on the FIRST sync
// (later reads just follow the deltaLink). The seam carries no window, so a broad
// default is chosen here. Nothing calls this on a schedule (SPEC AC 10); it is the
// capability the CRM sync initiative consumes, and it will pass its own window when
// this method grows one.
const CALENDAR_WINDOW_PAST_DAYS = 365
const CALENDAR_WINDOW_FUTURE_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

// --- Provider-error mapping -------------------------------------------------
//
// The SDK wrapper throws a `ProviderApiError` carrying Graph's HTTP status and (for
// a 429/503) its Retry-After already parsed. This is the ONE place those statuses
// become the seam's typed errors. A 410 Gone on a delta read means the token
// expired — that is context the cursor paths handle themselves before delegating
// here (Gmail signals the same with 404 on history / 410 on calendar).

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
      throw new MailApiError(`Graph request failed${err.status != null ? ` (${err.status})` : ''}.`)
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

/**
 * Run a delta read, translating a 410 Gone into `CursorExpiredError` and any other
 * `ProviderApiError` through the shared mapper. Graph expires a delta token with
 * 410, telling the caller the gap is unrecoverable and a fresh sync is needed.
 */
async function guardDelta<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    if (err instanceof ProviderApiError && err.status === 410) throw new CursorExpiredError()
    if (err instanceof ProviderApiError) throwMappedError(err)
    throw err
  }
}

/** Parse a provider payload or throw a readable `MailApiError` — never a `TypeError`. */
function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new MailApiError(`Graph returned ${what} that Maincar could not read.`)
  }
  return parsed.data
}

// --- zod schemas: the shapes we trust from Graph ----------------------------

const GraphAddressSchema = z.object({
  name: z.string().nullish(),
  address: z.string().nullish(),
})

const GraphRecipientSchema = z.object({ emailAddress: GraphAddressSchema.nullish() })

const GraphBodySchema = z.object({
  contentType: z.string().nullish(), // 'html' | 'text'
  content: z.string().nullish(),
})

const GraphMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullish(),
  subject: z.string().nullish(),
  from: GraphRecipientSchema.nullish(),
  sender: GraphRecipientSchema.nullish(),
  toRecipients: z.array(GraphRecipientSchema).nullish(),
  ccRecipients: z.array(GraphRecipientSchema).nullish(),
  body: GraphBodySchema.nullish(),
  // An absolute UTC instant carrying `Z`, unlike the calendar's wall-clock dateTime.
  sentDateTime: z.string(),
  receivedDateTime: z.string().nullish(),
})

const GraphMessagesDeltaSchema = z.object({
  value: z.array(GraphMessageSchema).nullish(),
  '@odata.nextLink': z.string().nullish(),
  '@odata.deltaLink': z.string().nullish(),
})

const GraphMailFoldersSchema = z.object({
  value: z.array(z.object({ id: z.string() })).nullish(),
})

// Graph's `POST /me/sendMail` returns 202 with no body; the composed transport that
// backs this seam surfaces the created message so `sentAt` is the PROVIDER's send
// instant, read back here rather than computed locally (SPEC AC 8).
const GraphSendResponseSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullish(),
  sentDateTime: z.string(),
})

const GraphDateTimeSchema = z.object({
  // Graph's local wall-clock, e.g. "2021-03-01T09:00:00.0000000" — NO offset here.
  dateTime: z.string(),
  // The zone that wall-clock is in, e.g. "UTC". The pair is one instant.
  timeZone: z.string().nullish(),
})

const GraphEventSchema = z.object({
  id: z.string(),
  subject: z.string().nullish(),
  bodyPreview: z.string().nullish(),
  body: GraphBodySchema.nullish(),
  start: GraphDateTimeSchema.nullish(),
  end: GraphDateTimeSchema.nullish(),
  isAllDay: z.boolean().nullish(),
  attendees: z.array(z.object({ emailAddress: GraphAddressSchema.nullish() })).nullish(),
  organizer: GraphRecipientSchema.nullish(),
})

const GraphEventsDeltaSchema = z.object({
  value: z.array(GraphEventSchema).nullish(),
  '@odata.nextLink': z.string().nullish(),
  '@odata.deltaLink': z.string().nullish(),
})

// --- Date handling ----------------------------------------------------------

/**
 * Combine Graph's wall-clock `dateTime` and its separate `timeZone` into a real UTC
 * instant. A string that already carries `Z` or a numeric offset is absolute and is
 * parsed as-is. Otherwise the wall time is interpreted IN its named zone: 'UTC' just
 * gains a `Z`; any other IANA zone is resolved through `Intl` so the returned
 * instant is the same one Graph meant, never a server-local mis-read.
 */
function graphDateToUtc(dateTime: string, timeZone: string | null | undefined): Date {
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(dateTime.trim())) return new Date(dateTime)
  const zone = (timeZone ?? 'UTC').trim()
  if (zone === '' || zone.toUpperCase() === 'UTC') return new Date(`${stripFraction(dateTime)}Z`)
  return wallTimeInZoneToUtc(dateTime, zone)
}

/** Trim Graph's 7-digit fractional seconds to a form `Date` parses, keeping millis. */
function stripFraction(dateTime: string): string {
  return dateTime.replace(/(\.\d{3})\d+$/, '$1')
}

/**
 * Interpret `dateTime` as a wall-clock time in `timeZone` and return the UTC instant.
 * The zone's offset is read at the candidate instant through `Intl`, then applied.
 * A best-effort second pass would refine the rare DST-boundary case; a single pass
 * is exact everywhere else and is all the (UTC-only) mocks and callers here need.
 */
function wallTimeInZoneToUtc(dateTime: string, timeZone: string): Date {
  const m = dateTime.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return new Date(dateTime)
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0))
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s)
  return new Date(asIfUtc - zoneOffsetMs(timeZone, asIfUtc))
}

/** The offset (ms) of `timeZone` from UTC at the given instant: local = utc + offset. */
function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asLocal = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'))
  return asLocal - utcMs
}

// --- Address helpers --------------------------------------------------------

/** Map a Graph email address onto the seam's `MailAddress`. */
function toMailAddress(addr: { name?: string | null; address?: string | null } | null | undefined): MailAddress {
  const email = addr?.address ?? ''
  return addr?.name ? { name: addr.name, email } : { email }
}

/** Map a list of Graph recipients onto `MailAddress[]`, dropping any with no address. */
function toMailAddresses(
  recipients: { emailAddress?: { name?: string | null; address?: string | null } | null }[] | null | undefined,
): MailAddress[] {
  return (recipients ?? []).map((r) => toMailAddress(r.emailAddress)).filter((a) => a.email !== '')
}

/** Render a `MailAddress` as a Graph recipient object. */
function toGraphRecipient(addr: MailAddress): { emailAddress: { address: string; name?: string } } {
  return { emailAddress: addr.name ? { address: addr.email, name: addr.name } : { address: addr.email } }
}

// --- Message mapping --------------------------------------------------------

type ParsedMessage = z.infer<typeof GraphMessageSchema>

/** Map a parsed Graph message onto the seam's `InboundMessage`. */
function toInboundMessage(parsed: ParsedMessage, mailboxAddress: string): InboundMessage {
  const contentType = (parsed.body?.contentType ?? '').toLowerCase()
  const content = parsed.body?.content ?? ''
  const fromAddr = toMailAddress((parsed.from ?? parsed.sender)?.emailAddress)
  return {
    providerMsgId: parsed.id,
    threadId: parsed.conversationId ?? null,
    from: fromAddr,
    to: toMailAddresses(parsed.toRecipients),
    cc: toMailAddresses(parsed.ccRecipients),
    subject: parsed.subject ?? null,
    bodyHtml: contentType === 'html' && content !== '' ? content : null,
    bodyText: contentType === 'text' && content !== '' ? content : null,
    // sentDateTime is an absolute UTC instant.
    sentAt: new Date(parsed.sentDateTime),
    // Graph has no "SENT" label; the rep's own outbound mail is the mail whose
    // sender is the mailbox itself.
    isOutbound: fromAddr.email !== '' && fromAddr.email.toLowerCase() === mailboxAddress.toLowerCase(),
  }
}

/** Order messages oldest-first — the read order the seam publishes. */
function oldestFirst(messages: InboundMessage[]): InboundMessage[] {
  return [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
}

// --- Calendar mapping -------------------------------------------------------

type ParsedEvent = z.infer<typeof GraphEventSchema>

/** Map a parsed Graph event onto the seam's `CalendarEvent`. */
function toCalendarEvent(parsed: ParsedEvent): CalendarEvent {
  if (!parsed.start?.dateTime || !parsed.end?.dateTime) {
    throw new MailApiError('Graph returned an event with no start or end.')
  }
  return {
    providerEventId: parsed.id,
    title: parsed.subject ?? null,
    description: parsed.body?.content ?? parsed.bodyPreview ?? null,
    startsAt: graphDateToUtc(parsed.start.dateTime, parsed.start.timeZone),
    endsAt: graphDateToUtc(parsed.end.dateTime, parsed.end.timeZone),
    isAllDay: parsed.isAllDay ?? false,
    attendees: (parsed.attendees ?? []).map((a) => toMailAddress(a.emailAddress)),
    organizer: parsed.organizer?.emailAddress ? toMailAddress(parsed.organizer.emailAddress) : null,
  }
}

/** Build the Graph `dateTimeTimeZone` for an outbound instant, always in UTC. */
function toGraphDateTime(instant: Date, isAllDay: boolean): { dateTime: string; timeZone: string } {
  const iso = instant.toISOString() // "...Z"
  // Graph's dateTime carries no offset — the zone lives in the sibling field.
  const dateTime = isAllDay ? `${iso.slice(0, 10)}T00:00:00.000` : iso.slice(0, -1)
  return { dateTime, timeZone: 'UTC' }
}

// --- Message building (send) ------------------------------------------------

/**
 * Build the Graph `message` for `POST /me/sendMail`. `bcc` goes in `bccRecipients`:
 * Graph delivers the blind copy from the envelope and never writes it into a header
 * a To/Cc recipient can read. That is the seam's rule — bcc on the envelope, never
 * in a visible header — expressed in Graph's wire form.
 */
function buildGraphMessage(input: OutboundEmail, from: MailAddress): Record<string, unknown> {
  const message: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: 'HTML', content: input.bodyHtml },
    from: toGraphRecipient(from),
    toRecipients: input.to.map(toGraphRecipient),
  }
  if (input.cc && input.cc.length > 0) message.ccRecipients = input.cc.map(toGraphRecipient)
  if (input.bcc && input.bcc.length > 0) message.bccRecipients = input.bcc.map(toGraphRecipient)
  const attachments = input.attachments ?? []
  if (attachments.length > 0) {
    message.attachments = attachments.map((att) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.filename,
      contentType: att.contentType,
      contentBytes: att.contentBase64,
    }))
  }
  return message
}

// --- The provider -----------------------------------------------------------

/**
 * Build the Outlook mail + Microsoft Calendar `MailProvider` for one mailbox. Every
 * method acquires a fresh token-bound client, so a token that expired between calls
 * is refreshed by `withFreshAccessToken` and never handled here.
 */
export function microsoftMail(
  account: MicrosoftMailAccount,
  makeClient: MakeGraphClient = defaultMakeClient,
): MailProvider {
  const client = (): Promise<GraphClient> => makeClient(account.connectionId)

  /** Fetch and map one full message by id. */
  async function fetchMessage(id: string): Promise<InboundMessage> {
    const raw = await guard(() => client().then((c) => c.getMessage(id)))
    return toInboundMessage(parseOrThrow(GraphMessageSchema, raw, 'a message'), account.emailAddress)
  }

  return {
    provider: 'microsoft',

    async sendEmail(input: OutboundEmail): Promise<SendEmailResult> {
      const message = buildGraphMessage(input, { email: account.emailAddress })
      const rawResp = await guard(() => client().then((c) => c.sendMail(message, true)))
      // Graph's documented success response is 202 Accepted with no body. It has
      // accepted the request but has not given us a message id or sent timestamp
      // to record; mailbox sync will add the authoritative Email row later.
      if (rawResp == null) return { kind: 'accepted' }
      const sent = parseOrThrow(GraphSendResponseSchema, rawResp, 'a send receipt')
      return {
        providerMsgId: sent.id,
        threadId: sent.conversationId ?? '',
        // The provider's own send instant, not one computed during this call.
        sentAt: new Date(sent.sentDateTime),
      }
    },

    async listMessagesSince(
      cursor: string | null,
      _limit: number,
    ): Promise<{ messages: InboundMessage[]; nextCursor: string | null }> {
      // Every Graph folder owns a distinct deltaLink. Store their complete cursor
      // map as one opaque value so moving mail between Inbox, Sent, and user folders
      // never turns the mailbox into an Inbox-only projection. Older bare deltaLinks
      // remain readable as a single Inbox cursor during rollout.
      type CursorMap = Record<string, string | null>
      const decode = (value: string | null): CursorMap => {
        if (value === null) return {}
        try {
          const parsed = JSON.parse(value) as { folders?: CursorMap }
          if (parsed && parsed.folders && typeof parsed.folders === 'object') return parsed.folders
        } catch { /* A pre-MAI-438 cursor is an Inbox deltaLink. */ }
        return { inbox: value }
      }
      const encode = (folders: CursorMap): string => JSON.stringify({ folders })
      const stored = decode(cursor)
      const graph = await client()
      let folderIds = Object.keys(stored)
      if (graph.listMailFolders) {
        const rawFolders = await guardDelta(() => graph.listMailFolders!())
        folderIds = parseOrThrow(GraphMailFoldersSchema, rawFolders, 'mail folders').value?.map((folder) => folder.id) ?? []
      }
      if (folderIds.length === 0) folderIds = ['inbox']

      const next: CursorMap = { ...stored }
      const messages: InboundMessage[] = []
      for (const folderId of folderIds) {
        const raw = await guardDelta(() => graph.listMessages(stored[folderId] ? { deltaLink: stored[folderId]! } : { folderId }))
        const page = parseOrThrow(GraphMessagesDeltaSchema, raw, 'a message delta page')
        messages.push(...(page.value ?? []).map((m) => toInboundMessage(m, account.emailAddress)))
        next[folderId] = page['@odata.nextLink'] ?? page['@odata.deltaLink'] ?? null
      }
      return { messages: oldestFirst(messages), nextCursor: encode(next) }
    },

    async getMessage(providerMsgId: string): Promise<InboundMessage> {
      return fetchMessage(providerMsgId)
    },

    async listBackfillMessages(cursor, limit, since) {
      const raw = await guard(() =>
        client().then((c) => c.listBackfillMessages({
          ...(cursor ? { cursor } : {}),
          receivedAfter: since.toISOString(),
          limit,
        })),
      )
      const page = parseOrThrow(GraphMessagesDeltaSchema, raw, 'a historical message page')
      return {
        // List responses are intentionally skinny; hydrate each id so the matcher
        // and persisted activity see the full provider message, not a preview.
        messages: oldestFirst(await Promise.all((page.value ?? []).map((message) => fetchMessage(message.id)))),
        nextCursor: page['@odata.nextLink'] ?? null,
      }
    },

    async listEventsSince(
      cursor: string | null,
      _limit: number,
    ): Promise<{ events: CalendarEvent[]; nextCursor: string | null }> {
      // Graph's calendar delta needs a window on the first sweep; later reads follow
      // the deltaLink. A replayed-but-expired delta returns 410 Gone, which becomes
      // CursorExpiredError so the caller restarts the calendar sync.
      const now = Date.now()
      const raw = await guardDelta(() =>
        client().then((c) =>
          c.listEvents(
            cursor === null
              ? {
                  startDateTime: new Date(now - CALENDAR_WINDOW_PAST_DAYS * DAY_MS).toISOString(),
                  endDateTime: new Date(now + CALENDAR_WINDOW_FUTURE_DAYS * DAY_MS).toISOString(),
                }
              : { deltaLink: cursor },
          ),
        ),
      )
      const page = parseOrThrow(GraphEventsDeltaSchema, raw, 'an event delta page')
      const events = (page.value ?? []).map(toCalendarEvent)
      const nextCursor = page['@odata.nextLink'] ?? page['@odata.deltaLink'] ?? null
      return { events, nextCursor }
    },

    async createEvent(
      input: Omit<CalendarEvent, 'providerEventId' | 'organizer'>,
    ): Promise<CalendarEvent> {
      const event: Record<string, unknown> = {
        subject: input.title ?? undefined,
        body: input.description != null ? { contentType: 'HTML', content: input.description } : undefined,
        start: toGraphDateTime(input.startsAt, input.isAllDay),
        end: toGraphDateTime(input.endsAt, input.isAllDay),
        isAllDay: input.isAllDay,
        attendees: input.attendees.map((a) => ({ ...toGraphRecipient(a), type: 'required' })),
      }
      const raw = await guard(() => client().then((c) => c.createEvent(event)))
      return toCalendarEvent(parseOrThrow(GraphEventSchema, raw, 'a created event'))
    },
  }
}
