// Unit tests for the Gmail SDK wrapper (dependencies/gmail.ts).
//
// The Google mail implementation (IH-15) mocks this module wholesale, so its real
// body only runs here. `googleapis` is mocked at the module boundary — no network,
// no Google account, not a cent of spend — and the mocked calls reject with errors
// shaped exactly like a real gaxios `GaxiosError` (a `status`, a `code`, a
// `response.status`, a parsed `response.data`, and a fetch `Headers` instance for
// `response.headers`), which is what the wrapper reads. The point under test is that
// the wrapper surfaces the provider's HTTP status and body UNCHANGED, parses a 429's
// Retry-After, and never retries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  setCredentials,
  getProfile,
  messagesGet,
  messagesList,
  messagesSend,
  historyList,
  eventsList,
  eventsInsert,
  gmailFactory,
  calendarFactory,
} = vi.hoisted(() => {
  const messages = {
    get: vi.fn(),
    list: vi.fn(),
    send: vi.fn(),
  }
  return {
    setCredentials: vi.fn(),
    getProfile: vi.fn(),
    messagesGet: messages.get,
    messagesList: messages.list,
    messagesSend: messages.send,
    historyList: vi.fn(),
    eventsList: vi.fn(),
    eventsInsert: vi.fn(),
    gmailFactory: vi.fn(() => ({
      users: {
        getProfile,
        messages: { get: messages.get, list: messages.list, send: messages.send },
        history: { list: historyList },
      },
    })),
    calendarFactory: vi.fn(() => ({ events: { list: eventsList, insert: eventsInsert } })),
  }
})

vi.mock('googleapis', () => {
  class OAuth2 {
    setCredentials = setCredentials
  }
  return { google: { auth: { OAuth2 }, gmail: gmailFactory, calendar: calendarFactory } }
})

import { gmailClient } from '../gmail.js'
import { ProviderApiError } from '../providerApiError.js'

/** An error shaped like a real gaxios GaxiosError, as the probe against the real SDK showed. */
function gaxiosError(status: number, data: unknown, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    status,
    code: status,
    response: { status, data, headers: new Headers(headers) },
  })
}

const AUTH_BODY = {
  error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' },
}
const RATE_BODY = { error: { code: 429, message: 'Rate Limit Exceeded' } }

beforeEach(() => {
  messagesGet.mockResolvedValue({ data: { id: 'm1', threadId: 't1' } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('gmailClient construction', () => {
  it('sets the access token as a credential and builds a gmail + calendar client', () => {
    gmailClient('access-token-123')
    expect(setCredentials).toHaveBeenCalledWith({ access_token: 'access-token-123' })
    expect(gmailFactory).toHaveBeenCalledWith(expect.objectContaining({ version: 'v1' }))
    expect(calendarFactory).toHaveBeenCalledWith(expect.objectContaining({ version: 'v3' }))
  })
})

describe('gmailClient happy path', () => {
  it('getMessage returns the provider payload and asks for the full message with retry disabled', async () => {
    const msg = await gmailClient('tok').getMessage('m1')
    expect(msg).toEqual({ id: 'm1', threadId: 't1' })
    // The retry-disabling second argument is the guardrail that keeps a 429 from
    // being retried inside the SDK; assert it is passed on every call.
    expect(messagesGet).toHaveBeenCalledWith({ userId: 'me', id: 'm1', format: 'full' }, { retry: false })
  })

  it('sendMessage puts the raw message and threadId in the request body', async () => {
    messagesSend.mockResolvedValue({ data: { id: 'sent-1', threadId: 't9' } })
    const sent = await gmailClient('tok').sendMessage('cmF3LW1lc3NhZ2U', 't9')
    expect(sent).toEqual({ id: 'sent-1', threadId: 't9' })
    expect(messagesSend).toHaveBeenCalledWith(
      { userId: 'me', requestBody: { raw: 'cmF3LW1lc3NhZ2U', threadId: 't9' } },
      { retry: false },
    )
  })

  it('listMessages and listHistory default the userId to the token holder', async () => {
    messagesList.mockResolvedValue({ data: { messages: [{ id: 'm1' }] } })
    historyList.mockResolvedValue({ data: { history: [], historyId: '99' } })
    const c = gmailClient('tok')
    await c.listMessages({ q: 'is:unread' })
    await c.listHistory({ startHistoryId: '10' })
    expect(messagesList).toHaveBeenCalledWith({ userId: 'me', q: 'is:unread' }, { retry: false })
    expect(historyList).toHaveBeenCalledWith({ userId: 'me', startHistoryId: '10' }, { retry: false })
  })

  it('createEvent and listEvents default the calendar to primary', async () => {
    eventsInsert.mockResolvedValue({ data: { id: 'ev-1' } })
    eventsList.mockResolvedValue({ data: { items: [] } })
    const c = gmailClient('tok')
    await c.createEvent({ summary: 'Demo' })
    await c.listEvents({ timeMin: '2026-08-21T00:00:00Z' })
    expect(eventsInsert).toHaveBeenCalledWith(
      { calendarId: 'primary', requestBody: { summary: 'Demo' } },
      { retry: false },
    )
    expect(eventsList).toHaveBeenCalledWith(
      { calendarId: 'primary', timeMin: '2026-08-21T00:00:00Z' },
      { retry: false },
    )
  })
})

describe('gmailClient error surfacing', () => {
  it('surfaces a 401 as a ProviderApiError carrying the status and body unchanged', async () => {
    messagesGet.mockRejectedValue(gaxiosError(401, AUTH_BODY))
    const err = await gmailClient('tok')
      .getMessage('m1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(ProviderApiError)
    expect(err.provider).toBe('google')
    expect(err.status).toBe(401)
    expect(err.body).toEqual(AUTH_BODY)
    expect(err.retryAfterMs).toBeNull()
    // A 401 is a real failure, not a retry candidate: the SDK method ran exactly once.
    expect(messagesGet).toHaveBeenCalledTimes(1)
  })

  it('surfaces a 429 with its Retry-After parsed to milliseconds', async () => {
    messagesList.mockRejectedValue(gaxiosError(429, RATE_BODY, { 'retry-after': '42' }))
    const err = await gmailClient('tok')
      .listMessages()
      .catch((e) => e)
    expect(err).toBeInstanceOf(ProviderApiError)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(42_000)
    expect(err.body).toEqual(RATE_BODY)
    expect(messagesList).toHaveBeenCalledTimes(1)
  })

  it('surfaces a transport fault (no HTTP response) with a null status', async () => {
    messagesGet.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }))
    const err = await gmailClient('tok')
      .getMessage('m1')
      .catch((e) => e)
    expect(err).toBeInstanceOf(ProviderApiError)
    expect(err.status).toBeNull()
    expect(err.retryAfterMs).toBeNull()
  })
})
