// Unit tests for the Microsoft Graph SDK wrapper (dependencies/graph.ts).
//
// The Microsoft mail implementation (IH-16) mocks this module wholesale, so its real
// body only runs here. Unlike gaxios, the Graph client makes its requests through
// the global `fetch`, so these tests stub `fetch` and let the REAL SDK run against
// synthetic `Response`s — the wrapper's own request-building and its GraphError
// handling are exercised, not a hand-built stand-in. No network, no Microsoft
// account, not a cent of spend. The point under test is that the wrapper surfaces
// the provider's HTTP status and body UNCHANGED, parses a 429's Retry-After, and
// never retries (its middleware chain omits the SDK's RetryHandler).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { graphClient } from '../graph.js'
import { ProviderApiError } from '../providerApiError.js'

let fetchMock: ReturnType<typeof vi.fn>

/** A JSON Graph response. 202/204 carry no body, matching Graph's real send/no-content replies. */
function graphResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const noBody = status === 202 || status === 204
  return new Response(noBody ? null : JSON.stringify(body), {
    status,
    headers: noBody ? headers : { 'content-type': 'application/json', ...headers },
  })
}

/** The url a recorded fetch call was made to. */
function urlOf(call: unknown[]): string {
  const input = call[0]
  return typeof input === 'string' ? input : (input as Request).url
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('graphClient happy path', () => {
  it('getMessage GETs the message by id and returns Graph payload', async () => {
    fetchMock.mockResolvedValue(graphResponse(200, { id: 'm1', subject: 'Hello' }))
    const msg = await graphClient('tok').getMessage('m1')
    expect(msg).toEqual({ id: 'm1', subject: 'Hello' })
    expect(urlOf(fetchMock.mock.calls[0])).toBe('https://graph.microsoft.com/v1.0/me/messages/m1')
  })

  it('sendMail POSTs the message under a sendMail envelope', async () => {
    fetchMock.mockResolvedValue(graphResponse(202, null))
    await graphClient('tok').sendMail({ subject: 'Hi', body: { contentType: 'HTML', content: '<p>x</p>' } }, false)
    const [input, init] = fetchMock.mock.calls[0]
    expect(urlOf([input])).toBe('https://graph.microsoft.com/v1.0/me/sendMail')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      message: { subject: 'Hi', body: { contentType: 'HTML', content: '<p>x</p>' } },
      saveToSentItems: false,
    })
  })

  it('listMessages opens a fresh inbox delta, or follows a supplied deltaLink', async () => {
    // A fresh Response per call: a Response body can only be read once.
    fetchMock.mockImplementation(async () => graphResponse(200, { value: [] }))
    const c = graphClient('tok')
    await c.listMessages()
    expect(urlOf(fetchMock.mock.calls[0])).toBe(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta',
    )
    const deltaLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc'
    await c.listMessages({ deltaLink })
    expect(urlOf(fetchMock.mock.calls[1])).toBe(deltaLink)
  })

  it('lists folders and starts a delta in the requested folder', async () => {
    fetchMock.mockImplementation(async () => graphResponse(200, { value: [] }))
    const c = graphClient('tok')
    await c.listMailFolders!()
    await c.listMessages({ folderId: 'sentitems' })

    expect(urlOf(fetchMock.mock.calls[0])).toBe('https://graph.microsoft.com/v1.0/me/mailFolders')
    expect(urlOf(fetchMock.mock.calls[1])).toBe(
      'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta',
    )
  })

  it('createEvent POSTs to /me/events and returns the stored event', async () => {
    fetchMock.mockResolvedValue(graphResponse(201, { id: 'ev-1', subject: 'Demo' }))
    const ev = await graphClient('tok').createEvent({ subject: 'Demo' })
    expect(ev).toEqual({ id: 'ev-1', subject: 'Demo' })
    const [input, init] = fetchMock.mock.calls[0]
    expect(urlOf([input])).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('listEvents carries the calendar window on the first call', async () => {
    fetchMock.mockResolvedValue(graphResponse(200, { value: [] }))
    await graphClient('tok').listEvents({
      startDateTime: '2026-08-01T00:00:00Z',
      endDateTime: '2026-08-31T00:00:00Z',
    })
    const url = new URL(urlOf(fetchMock.mock.calls[0]))
    expect(url.pathname).toBe('/v1.0/me/calendarView/delta')
    expect(url.searchParams.get('startDateTime')).toBe('2026-08-01T00:00:00Z')
    expect(url.searchParams.get('endDateTime')).toBe('2026-08-31T00:00:00Z')
  })
})

describe('graphClient error surfacing', () => {
  it('surfaces a 401 as a ProviderApiError carrying the status and body unchanged', async () => {
    const inner = { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' }
    fetchMock.mockResolvedValue(graphResponse(401, { error: inner }))
    const err = (await graphClient('tok')
      .getMessage('m1')
      .catch((e) => e)) as ProviderApiError
    expect(err).toBeInstanceOf(ProviderApiError)
    expect(err.provider).toBe('microsoft')
    expect(err.status).toBe(401)
    // The Graph SDK unwraps the `error` envelope into GraphError.body; the wrapper
    // surfaces that inner object (parsed back from the SDK's JSON string) unchanged.
    expect(err.body).toEqual(inner)
    expect(err.retryAfterMs).toBeNull()
    // No RetryHandler in the chain: a 401 hits the wire exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a 429 with its Retry-After parsed to milliseconds and does not retry', async () => {
    const inner = { code: 'TooManyRequests', message: 'Throttled.' }
    fetchMock.mockResolvedValue(graphResponse(429, { error: inner }, { 'retry-after': '42' }))
    const err = (await graphClient('tok')
      .listMessages()
      .catch((e) => e)) as ProviderApiError
    expect(err).toBeInstanceOf(ProviderApiError)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(42_000)
    expect(err.body).toEqual(inner)
    // The design guarantee: the seam does not retry, so the 429 surfaces on the
    // first and only request rather than after the SDK waits out Retry-After.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
