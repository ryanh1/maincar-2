import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// jsonFetch reads the Firebase token and the API base URL from config. Mock both
// so the test controls auth state and stays same-origin.
const { getIdTokenMock, currentUserRef } = vi.hoisted(() => ({
  getIdTokenMock: vi.fn(),
  currentUserRef: { value: null as null | { getIdToken: () => Promise<string> } },
}))

vi.mock('@/config', () => ({ API_URL: '', API_LOGGING_ENABLED: false }))
vi.mock('@/dependencies/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: currentUserRef.value }),
}))

import { ApiError, jsonFetch } from '@/lib/api'

function mockResponse(opts: {
  ok: boolean
  status: number
  body?: unknown
  text?: string
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    json: async () => opts.body,
    text: async () => opts.text ?? JSON.stringify(opts.body ?? ''),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  getIdTokenMock.mockResolvedValue('test-token')
  currentUserRef.value = { getIdToken: getIdTokenMock }
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('jsonFetch', () => {
  it('sends the Firebase ID token as a Bearer header', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, status: 200, body: { ok: true } }))

    await jsonFetch('/api/health')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('omits the Authorization header when nobody is signed in', async () => {
    currentUserRef.value = null
    fetchMock.mockResolvedValue(mockResponse({ ok: true, status: 200, body: { ok: true } }))

    await jsonFetch('/api/health')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: { user: { id: 'u1' } } }),
    )

    const data = await jsonFetch<{ user: { id: string } }>('/api/auth/me')

    expect(data.user.id).toBe('u1')
  })

  it('returns undefined for 204, rather than throwing on an empty body', async () => {
    // A 204 is `ok` in the real fetch API, and calling res.json() on it throws.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('no body')
      },
      text: async () => '',
    } as unknown as Response)

    await expect(jsonFetch('/api/thing', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it("surfaces the server's own message on a 4xx", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 400, text: JSON.stringify({ error: 'Name is required' }) }),
    )

    await expect(jsonFetch('/api/thing')).rejects.toMatchObject({
      message: 'Name is required',
      status: 400,
    })
  })

  it('hides the server message on a 5xx and uses a generic one', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        text: JSON.stringify({ error: 'ECONNREFUSED at pg.connect' }),
      }),
    )

    await expect(jsonFetch('/api/thing')).rejects.toMatchObject({
      message: 'Something went wrong. Please try again.',
      status: 500,
    })
  })

  it('captures the body status discriminator as `code`, even on a 5xx', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 502,
        text: JSON.stringify({ error: 'upstream', status: 'send_failed' }),
      }),
    )

    const err = await jsonFetch('/api/thing').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('send_failed')
  })

  it('still throws an ApiError when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 502, text: '<html>Bad Gateway</html>' }),
    )

    await expect(jsonFetch('/api/thing')).rejects.toBeInstanceOf(ApiError)
  })

  // The error path logs unconditionally — VITE_DISABLE_API_LOGGING does not
  // silence it — so an unredacted path would put every failed invite token into
  // the browser console (MAI-7 → "No token appears in any log line or logged URL").
  it('never logs an invite token', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 404, body: { error: 'Invitation unavailable' } }),
    )

    await expect(jsonFetch('/api/public/invitations/s3cr3t-token-value')).rejects.toThrow()

    const logged = errorSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('s3cr3t-token-value')
    expect(logged).toContain('/api/public/invitations/:token')
    errorSpy.mockRestore()
  })

  it('never logs an accept token', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 409, body: { error: 'Wrong account' } }),
    )

    await expect(
      jsonFetch('/api/invitations/s3cr3t-token-value/accept', { method: 'POST' }),
    ).rejects.toThrow()

    const logged = errorSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('s3cr3t-token-value')
    expect(logged).toContain('/api/invitations/:token/accept')
    errorSpy.mockRestore()
  })
})
