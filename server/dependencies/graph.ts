// graph.ts — the `@microsoft/microsoft-graph-client` client for Outlook mail +
// calendar, constructed HERE and nowhere else (CLAUDE.md → Third-party APIs / SDKs;
// SPEC-int-seam.md § Project structure). The Microsoft implementation of the mail
// seam (IH-16 microsoftMail) calls the thin methods below; it never touches the SDK,
// a Graph URL, or a token refresh.
//
// THIN ON PURPOSE. Each method is one Graph call in, the provider's payload out. No
// zod parsing, no error mapping, no config read, no database — those belong a layer
// up. This file:
//   - takes an ACCESS TOKEN and builds a client around it (it does not refresh; the
//     caller does that through withFreshAccessToken before it ever gets here),
//   - reads no config and imports no Prisma,
//   - omits the SDK's RetryHandler so a 429/503 surfaces to the caller instead of
//     being retried in here (SPEC-int-seam.md: the seam does not retry),
//   - surfaces the provider's HTTP status and error body UNCHANGED as a
//     ProviderApiError, so IH-16 can map it onto a typed seam error.

import {
  AuthenticationHandler,
  Client,
  HTTPMessageHandler,
  type AuthenticationProvider,
} from '@microsoft/microsoft-graph-client'

import { ProviderApiError, retryAfterMsFromHeaders } from './providerApiError.js'

/**
 * Turn a Graph `GraphError` into the wrapper's provider-agnostic error. The client
 * puts the HTTP status on `err.statusCode`, the raw error body (a JSON string) on
 * `err.body`, and the response headers on `err.headers` as a fetch `Headers`
 * instance — that is where a 429's Retry-After lives. The body is parsed back to
 * JSON when it was JSON so the mapper reads a shape, not a string; a non-JSON body
 * passes through untouched.
 */
function toProviderError(err: unknown): ProviderApiError {
  const e = err as { statusCode?: number; message?: string; body?: unknown; headers?: unknown }
  let body: unknown = e?.body
  if (typeof e?.body === 'string' && e.body !== '') {
    try {
      body = JSON.parse(e.body)
    } catch {
      body = e.body
    }
  }
  return new ProviderApiError('microsoft', {
    status: typeof e?.statusCode === 'number' ? e.statusCode : null,
    body,
    retryAfterMs: retryAfterMsFromHeaders(e?.headers),
    message: e?.message,
    cause: err,
  })
}

/** Run one Graph call, normalizing any failure. */
async function run<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    throw toProviderError(err)
  }
}

/**
 * The raw Graph mail + calendar calls IH-16 composes into the mail seam. Every
 * method returns Graph's own payload for the implementation to parse; this layer
 * does not validate, so the returns are deliberately `unknown`. `deltaLink` is the
 * opaque cursor Graph hands back (`@odata.deltaLink`); passing it replays from where
 * the last page ended — the Graph analogue of Gmail's `historyId`.
 */
export interface GraphClient {
  readonly provider: 'microsoft'
  /** Folder inventory for per-folder mailbox delta sync. */
  listMailFolders?(): Promise<unknown>
  /** A page of one folder's messages, or the next page when `deltaLink` is supplied. */
  listMessages(opts?: { deltaLink?: string; folderId?: string }): Promise<unknown>
  /** Historical messages, filtered by receivedDateTime for the initial import. */
  listBackfillMessages(opts: { cursor?: string; receivedAfter: string; limit: number }): Promise<unknown>
  /** One full message by id. */
  getMessage(id: string): Promise<unknown>
  /** Send a message. `saveToSentItems` defaults to true, matching Graph's own default. */
  sendMail(message: unknown, saveToSentItems?: boolean): Promise<unknown>
  /**
   * A page of calendar events, or the next page when `deltaLink` is supplied. The
   * first call needs a window: Graph's calendar delta is over a `startDateTime` /
   * `endDateTime` range.
   */
  listEvents(opts?: {
    deltaLink?: string
    startDateTime?: string
    endDateTime?: string
  }): Promise<unknown>
  /** Create one calendar event and return the provider's stored copy. */
  createEvent(event: unknown): Promise<unknown>
}

/** Calendar-specific Graph operations. Kept separate so the legacy mail adapter's focused fakes stay small. */
export interface GraphCalendarClient extends GraphClient {
  /** Calendar inventory, including an opaque Graph next link when another page exists. */
  listCalendars(opts?: { cursor?: string; limit?: number }): Promise<unknown>
  /** One calendar resource by Graph id. */
  getCalendar(calendarId: string): Promise<unknown>
  /** A selected calendar's bounded event view, following Graph's opaque next link. */
  listCalendarEvents(opts: {
    calendarId: string
    cursor?: string
    startDateTime?: string
    endDateTime?: string
    limit?: number
  }): Promise<unknown>
  /** Create an event in a selected calendar. */
  createCalendarEvent(calendarId: string, event: unknown): Promise<unknown>
  /** One event in a selected calendar. */
  getCalendarEvent(calendarId: string, eventId: string): Promise<unknown>
  /** Update one event, optionally using Graph's conditional-write header. */
  updateCalendarEvent(opts: {
    calendarId: string
    eventId: string
    event: unknown
    expectedVersion?: string
  }): Promise<unknown>
  /** Delete one event, optionally using Graph's conditional-write header. */
  deleteCalendarEvent(opts: { calendarId: string; eventId: string; expectedVersion?: string }): Promise<unknown>
  /** Send an RSVP action for one event. */
  respondToCalendarEvent(opts: {
    calendarId: string
    eventId: string
    response: 'accept' | 'decline' | 'tentativelyAccept'
    comment?: string
  }): Promise<unknown>
  /** Work/school mailbox free-busy data. Personal Microsoft accounts do not support this Graph API. */
  getSchedule(schedule: unknown): Promise<unknown>
}

/**
 * Build a Graph client bound to one access token. Construction is the only place a
 * Graph client comes into being in the whole repo.
 *
 * The middleware chain is deliberately just authentication → HTTP. `Client.init`
 * would install the SDK's default chain, which includes a RetryHandler that retries
 * a 429/503 and a RedirectHandler — both of which would hide a rate-limit the seam's
 * caller must own. Omitting them makes the first failure the one that surfaces.
 */
export function graphClient(accessToken: string): GraphCalendarClient {
  const authProvider: AuthenticationProvider = { getAccessToken: async () => accessToken }
  const authHandler = new AuthenticationHandler(authProvider)
  authHandler.setNext(new HTTPMessageHandler())
  const client = Client.initWithMiddleware({ middleware: authHandler })

  return {
    provider: 'microsoft',

    listMailFolders() {
      return run(() => client.api('/me/mailFolders').get())
    },

    listMessages(opts = {}) {
      // Follow an existing cursor if given; otherwise open a fresh folder delta.
      const resource = opts.deltaLink ?? `/me/mailFolders/${encodeURIComponent(opts.folderId ?? 'inbox')}/messages/delta`
      return run(() => client.api(resource).get())
    },

    listBackfillMessages({ cursor, receivedAfter, limit }) {
      if (cursor) return run(() => client.api(cursor).get())
      return run(() =>
        client
          .api('/me/messages')
          .filter(`receivedDateTime ge ${receivedAfter}`)
          .top(limit)
          .get(),
      )
    },

    getMessage(id) {
      return run(() => client.api(`/me/messages/${id}`).get())
    },

    sendMail(message, saveToSentItems = true) {
      return run(() => client.api('/me/sendMail').post({ message, saveToSentItems }))
    },

    listEvents(opts = {}) {
      if (opts.deltaLink) return run(() => client.api(opts.deltaLink as string).get())
      let req = client.api('/me/calendarView/delta')
      if (opts.startDateTime) req = req.query({ startDateTime: opts.startDateTime })
      if (opts.endDateTime) req = req.query({ endDateTime: opts.endDateTime })
      return run(() => req.get())
    },

    createEvent(event) {
      return run(() => client.api('/me/events').post(event))
    },

    listCalendars(opts = {}) {
      if (opts.cursor) return run(() => client.api(opts.cursor as string).get())
      let req = client.api('/me/calendars')
      if (opts.limit) req = req.top(opts.limit)
      return run(() => req.get())
    },

    getCalendar(calendarId) {
      return run(() => client.api(`/me/calendars/${encodeURIComponent(calendarId)}`).get())
    },

    listCalendarEvents(opts) {
      if (opts.cursor) return run(() => client.api(opts.cursor as string).get())
      let req = client.api(`/me/calendars/${encodeURIComponent(opts.calendarId)}/calendarView`).header('Prefer', 'outlook.timezone="UTC"')
      if (opts.startDateTime) req = req.query({ startDateTime: opts.startDateTime })
      if (opts.endDateTime) req = req.query({ endDateTime: opts.endDateTime })
      if (opts.limit) req = req.top(opts.limit)
      return run(() => req.get())
    },

    createCalendarEvent(calendarId, event) {
      return run(() => client.api(`/me/calendars/${encodeURIComponent(calendarId)}/events`).post(event))
    },

    getCalendarEvent(calendarId, eventId) {
      return run(() => client.api(`/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`).header('Prefer', 'outlook.timezone="UTC"').get())
    },

    updateCalendarEvent({ calendarId, eventId, event, expectedVersion }) {
      let req = client.api(`/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`).header('Prefer', 'outlook.timezone="UTC"')
      if (expectedVersion) req = req.header('If-Match', expectedVersion)
      return run(() => req.patch(event))
    },

    deleteCalendarEvent({ calendarId, eventId, expectedVersion }) {
      let req = client.api(`/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
      if (expectedVersion) req = req.header('If-Match', expectedVersion)
      return run(() => req.delete())
    },

    respondToCalendarEvent({ calendarId, eventId, response, comment }) {
      const body = { ...(comment ? { comment } : {}), sendResponse: true }
      return run(() =>
        client.api(`/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/${response}`).post(body),
      )
    },

    getSchedule(schedule) {
      return run(() => client.api('/me/calendar/getSchedule').header('Prefer', 'outlook.timezone="UTC"').post(schedule))
    },
  }
}
