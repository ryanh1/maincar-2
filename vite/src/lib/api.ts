/**
 * The one HTTP entry point for the app. Use `jsonFetch` for EVERY API call
 * (CLAUDE.md → Frontend Data Fetching Patterns).
 *
 * It handles, in one place:
 *   - injecting the Firebase ID token
 *   - logging the full URL and response (silence with VITE_DISABLE_API_LOGGING=true)
 *   - 4xx surfaces the server's own message; 5xx surfaces a generic one, because
 *     a server stack trace is not something a user can act on
 *   - 204 No Content, which would make `res.json()` throw
 *
 * `fetch`, never `axios`.
 */
import { API_URL, API_LOGGING_ENABLED } from '@/config'
import { getFirebaseAuth } from '@/dependencies/firebase'

export class ApiError extends Error {
  readonly status: number
  /**
   * The response body's `status` discriminator when the server sends one (e.g.
   * "quota_exceeded"). It lets a caller branch on the SPECIFIC outcome even for a
   * 5xx, where the human-facing `message` stays generic.
   */
  readonly code?: string
  /** The parsed JSON response, when the server supplied one. */
  readonly body?: unknown

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

function resolveUrl(input: RequestInfo): RequestInfo {
  if (!API_URL || typeof input !== 'string' || !input.startsWith('/')) return input
  return `${API_URL}${input}`
}

/**
 * Invite tokens travel in the path, and this logger prints the path. Logging is
 * on by default in a production build, so without this every invitee's token
 * lands in their browser console (MAI-7 → "No token appears in any log line or
 * logged URL"). The route shape is what makes a log line useful anyway; the
 * secret in it never was.
 */
function redactTokens(url: string): string {
  return url
    .replace(/\/api\/public\/invitations\/[^/?#]+/, '/api/public/invitations/:token')
    .replace(/\/api\/invitations\/[^/?#]+\/accept/, '/api/invitations/:token/accept')
}

function getFullUrl(input: RequestInfo): string {
  const url = typeof input === 'string' ? input : input.url
  const absolute = url.startsWith('http') ? url : `${window.location.origin}${url}`
  return redactTokens(absolute)
}

export async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const auth = getFirebaseAuth()
  const idToken = await auth.currentUser?.getIdToken().catch(() => null)
  const method = init?.method ?? 'GET'
  const fullUrl = getFullUrl(input)

  if (API_LOGGING_ENABLED) {
    console.log(`[API] ${method} ${fullUrl}`)
  }

  const { headers: customHeaders, ...restInit } = init ?? {}
  // The browser owns a multipart boundary. Supplying application/json (or a
  // bare multipart value) makes multer receive an unreadable upload.
  const headers = new Headers(customHeaders)
  if (!(typeof FormData !== 'undefined' && restInit.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`)

  const res = await fetch(resolveUrl(input), {
    ...restInit,
    headers,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[API] ${method} ${fullUrl} failed:`, { status: res.status, body: text })

    let userMessage = 'Something went wrong. Please try again.'
    let code: string | undefined
    let body: unknown
    try {
      const parsed: { error?: unknown; status?: unknown } = JSON.parse(text)
      body = parsed
      if (res.status >= 400 && res.status < 500 && typeof parsed.error === 'string') {
        userMessage = parsed.error
      }
      if (typeof parsed.status === 'string') code = parsed.status
    } catch {
      /* not JSON */
    }
    throw new ApiError(userMessage, res.status, code, body)
  }

  if (res.status === 204) {
    if (API_LOGGING_ENABLED) {
      console.log(`[API] ${method} ${fullUrl} response: (204 No Content)`)
    }
    return undefined as T
  }

  const data = (await res.json()) as T

  if (API_LOGGING_ENABLED) {
    console.log(`[API] ${method} ${fullUrl} response:`, data)
  }

  return data
}
