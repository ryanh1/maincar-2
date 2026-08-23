// gmail.ts — the `googleapis` client for Gmail + Google Calendar, constructed HERE
// and nowhere else (CLAUDE.md → Third-party APIs / SDKs; SPEC-int-seam.md § Project
// structure). The Google implementation of the mail seam (IH-15 googleMail) calls
// the thin methods below; it never touches the SDK, an endpoint, or a token refresh.
//
// THIN ON PURPOSE. Each method is one SDK call in, the provider's payload out. No
// zod parsing, no error mapping, no config read, no database — those all belong a
// layer up. This file:
//   - takes an ACCESS TOKEN and builds a client around it (it does not refresh; the
//     caller does that through withFreshAccessToken before it ever gets here),
//   - reads no config and imports no Prisma,
//   - disables the SDK's own retry so a 429/503 surfaces to the caller instead of
//     being retried in here (SPEC-int-seam.md: the seam does not retry),
//   - surfaces the provider's HTTP status and error body UNCHANGED as a
//     ProviderApiError, so IH-15 can map it onto a typed seam error.

import { google, type calendar_v3, type gmail_v1 } from 'googleapis'

import { ProviderApiError, retryAfterMsFromHeaders } from './providerApiError.js'

// gaxios retries a 429/5xx by default, waiting out the whole Retry-After before it
// throws — which would swallow the rate-limit the caller must see and own. Every
// call passes this so the first failure is the one that surfaces.
const NO_RETRY = { retry: false }

// Gmail addresses the signed-in user as the literal `me`; the token already names
// whose mailbox it is, so the implementations never pass a real address here.
const ME = 'me'

// A rep's default calendar. The one calendar id these wrappers assume; a caller
// that needs another passes it through the params.
const PRIMARY = 'primary'

/**
 * Turn a gaxios `GaxiosError` into the wrapper's provider-agnostic error. gaxios
 * puts the HTTP status on `err.status` (mirrored as `err.code` and
 * `err.response.status`), the parsed error body on `err.response.data`, and the
 * response headers on `err.response.headers` as a fetch `Headers` instance — that
 * is where a 429's Retry-After lives. A transport fault (no response) surfaces with
 * a null status, which the mapper reads as "unreachable", not "auth failed".
 */
function toProviderError(err: unknown): ProviderApiError {
  const e = err as {
    status?: number
    code?: number | string
    message?: string
    response?: { status?: number; data?: unknown; headers?: unknown }
  }
  const status =
    e?.response?.status ??
    (typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : null)
  return new ProviderApiError('google', {
    status,
    body: e?.response?.data,
    retryAfterMs: retryAfterMsFromHeaders(e?.response?.headers),
    message: e?.message,
    cause: err,
  })
}

/** Run one SDK call, returning its `data` and normalizing any failure. */
async function run<T>(op: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await op()).data
  } catch (err) {
    throw toProviderError(err)
  }
}

/**
 * The raw Gmail + Google Calendar calls IH-15 composes into the mail seam. Every
 * method returns the provider's own payload shape (googleapis' `Schema$*` types) for
 * the implementation to parse; this layer does not validate.
 */
export interface GmailClient {
  readonly provider: 'google'
  /** The mailbox's address and current `historyId` — the seed for a delta cursor. */
  getProfile(): Promise<gmail_v1.Schema$Profile>
  /** A page of message ids/threads. Used for the first read, before a cursor exists. */
  listMessages(
    params?: gmail_v1.Params$Resource$Users$Messages$List,
  ): Promise<gmail_v1.Schema$ListMessagesResponse>
  /** The delta since a `historyId` — the cursor-based read (SPEC-int-seam.md open q1). */
  listHistory(
    params: gmail_v1.Params$Resource$Users$History$List,
  ): Promise<gmail_v1.Schema$ListHistoryResponse>
  /** One full message, headers and body, for `getMessage` / hydrating a history page. */
  getMessage(id: string, format?: string): Promise<gmail_v1.Schema$Message>
  /** Send an RFC 822 message the caller base64url-encoded into `raw`. */
  sendMessage(raw: string, threadId?: string): Promise<gmail_v1.Schema$Message>
  /** A page of calendar events. The caller passes `timeMin` or a `syncToken` cursor. */
  listEvents(params?: calendar_v3.Params$Resource$Events$List): Promise<calendar_v3.Schema$Events>
  /** Create one calendar event and return the provider's stored copy. */
  createEvent(
    requestBody: calendar_v3.Schema$Event,
    params?: Omit<calendar_v3.Params$Resource$Events$Insert, 'requestBody'>,
  ): Promise<calendar_v3.Schema$Event>
}

/**
 * The Google Calendar calls used by the provider-neutral calendar adapter. Keeping
 * this separate from `GmailClient` lets the mail seam retain its deliberately small
 * surface while both adapters share one token-bound Google SDK wrapper.
 */
export interface GoogleCalendarClient {
  readonly provider: 'google'
  listCalendarList(
    params?: calendar_v3.Params$Resource$Calendarlist$List,
  ): Promise<calendar_v3.Schema$CalendarList>
  getCalendarListEntry(calendarId: string): Promise<calendar_v3.Schema$CalendarListEntry>
  listCalendarEvents(
    params: calendar_v3.Params$Resource$Events$List | undefined,
    calendarId: string,
  ): Promise<calendar_v3.Schema$Events>
  getEvent(calendarId: string, eventId: string): Promise<calendar_v3.Schema$Event>
  createCalendarEvent(requestBody: calendar_v3.Schema$Event, calendarId: string): Promise<calendar_v3.Schema$Event>
  patchEvent(
    calendarId: string,
    eventId: string,
    requestBody: calendar_v3.Schema$Event,
    expectedVersion?: string,
  ): Promise<calendar_v3.Schema$Event>
  updateEvent(
    calendarId: string,
    eventId: string,
    requestBody: calendar_v3.Schema$Event,
    expectedVersion?: string,
  ): Promise<calendar_v3.Schema$Event>
  deleteEvent(calendarId: string, eventId: string, expectedVersion?: string): Promise<void>
  queryFreeBusy(requestBody: calendar_v3.Schema$FreeBusyRequest): Promise<calendar_v3.Schema$FreeBusyResponse>
}

export type GoogleClient = GmailClient & GoogleCalendarClient

/**
 * Build a Gmail + Calendar client bound to one access token. Construction is the
 * only place a googleapis client comes into being in the whole repo. The token is
 * set on a bare OAuth2 client purely as a credential — no client id/secret, because
 * this wrapper neither obtains nor refreshes tokens.
 */
export function gmailClient(accessToken: string): GoogleClient {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  const gmail = google.gmail({ version: 'v1', auth })
  const calendar = google.calendar({ version: 'v3', auth })

  return {
    provider: 'google',

    getProfile() {
      return run(() => gmail.users.getProfile({ userId: ME }, NO_RETRY))
    },

    listMessages(params = {}) {
      return run(() => gmail.users.messages.list({ userId: ME, ...params }, NO_RETRY))
    },

    listHistory(params) {
      return run(() => gmail.users.history.list({ userId: ME, ...params }, NO_RETRY))
    },

    getMessage(id, format = 'full') {
      return run(() => gmail.users.messages.get({ userId: ME, id, format }, NO_RETRY))
    },

    sendMessage(raw, threadId) {
      return run(() =>
        gmail.users.messages.send({ userId: ME, requestBody: { raw, threadId } }, NO_RETRY),
      )
    },

    listEvents(params = {}) {
      return run(() => calendar.events.list({ calendarId: PRIMARY, ...params }, NO_RETRY))
    },

    createEvent(requestBody, params = {}) {
      return run(() =>
        calendar.events.insert({ calendarId: PRIMARY, ...params, requestBody }, NO_RETRY),
      )
    },

    listCalendarList(params = {}) {
      return run(() => calendar.calendarList.list(params, NO_RETRY))
    },

    getCalendarListEntry(calendarId) {
      return run(() => calendar.calendarList.get({ calendarId }, NO_RETRY))
    },

    listCalendarEvents(params, calendarId) {
      return run(() => calendar.events.list({ calendarId, ...params }, NO_RETRY))
    },

    createCalendarEvent(requestBody, calendarId) {
      return run(() => calendar.events.insert({ calendarId, requestBody }, NO_RETRY))
    },

    getEvent(calendarId, eventId) {
      return run(() => calendar.events.get({ calendarId, eventId }, NO_RETRY))
    },

    patchEvent(calendarId, eventId, requestBody, expectedVersion) {
      return run(() =>
        calendar.events.patch(
          { calendarId, eventId, requestBody },
          { ...NO_RETRY, headers: expectedVersion ? { 'If-Match': expectedVersion } : undefined },
        ),
      )
    },

    updateEvent(calendarId, eventId, requestBody, expectedVersion) {
      return run(() =>
        calendar.events.update(
          { calendarId, eventId, requestBody },
          { ...NO_RETRY, headers: expectedVersion ? { 'If-Match': expectedVersion } : undefined },
        ),
      )
    },

    async deleteEvent(calendarId, eventId, expectedVersion) {
      await run(() =>
        calendar.events.delete(
          { calendarId, eventId },
          { ...NO_RETRY, headers: expectedVersion ? { 'If-Match': expectedVersion } : undefined },
        ),
      )
    },

    queryFreeBusy(requestBody) {
      return run(() => calendar.freebusy.query({ requestBody }, NO_RETRY))
    },
  }
}
