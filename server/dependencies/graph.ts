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
  /** A page of inbox messages, or the next page when `deltaLink` is supplied. */
  listMessages(opts?: { deltaLink?: string }): Promise<unknown>
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

/**
 * Build a Graph client bound to one access token. Construction is the only place a
 * Graph client comes into being in the whole repo.
 *
 * The middleware chain is deliberately just authentication → HTTP. `Client.init`
 * would install the SDK's default chain, which includes a RetryHandler that retries
 * a 429/503 and a RedirectHandler — both of which would hide a rate-limit the seam's
 * caller must own. Omitting them makes the first failure the one that surfaces.
 */
export function graphClient(accessToken: string): GraphClient {
  const authProvider: AuthenticationProvider = { getAccessToken: async () => accessToken }
  const authHandler = new AuthenticationHandler(authProvider)
  authHandler.setNext(new HTTPMessageHandler())
  const client = Client.initWithMiddleware({ middleware: authHandler })

  return {
    provider: 'microsoft',

    listMessages(opts = {}) {
      // Follow an existing cursor if given; otherwise open a fresh inbox delta.
      const resource = opts.deltaLink ?? '/me/mailFolders/inbox/messages/delta'
      return run(() => client.api(resource).get())
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
  }
}
