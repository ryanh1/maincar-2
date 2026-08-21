// providerApiError.ts — the ONE error type the mail SDK wrappers (gmail.ts,
// graph.ts) throw. It carries the provider's HTTP status and error body UNCHANGED,
// so the mail implementations one layer up (IH-15 googleMail, IH-16 microsoftMail)
// can map each onto a typed seam error (src/lib/mail/mailErrors.ts: MailAuthError,
// RateLimitedError, CursorExpiredError, MailApiError).
//
// The wrappers DO NOT map. Mapping needs the seam's vocabulary, which lives a layer
// up in src/lib/mail; this file sits in the dependencies layer and must not reach
// into it. Surfacing the raw `status` and `body` here means a status the mapper did
// not anticipate is still visible to it, never swallowed into a generic failure.
//
// The wrappers also DO NOT retry (SPEC-int-seam.md: "The seam does not retry on its
// own — the caller owns that policy"). Both SDKs would otherwise retry a 429/503
// themselves, respecting Retry-After, and hide the rate-limit from the caller. So a
// 429 reaches here with its Retry-After already parsed into `retryAfterMs`, ready
// for the mapper to hand to RateLimitedError.

/** Which provider raised the error. Matches `MailProvider.provider`. */
export type MailApiProvider = 'google' | 'microsoft'

/**
 * A provider HTTP failure, surfaced with its status and body unchanged. `cause`
 * keeps the original SDK error (a gaxios `GaxiosError`, a Graph `GraphError`) for
 * logging, but a caller reads `status` / `body` / `retryAfterMs` and never a
 * provider-specific field.
 */
export class ProviderApiError extends Error {
  /** The provider that failed. */
  readonly provider: MailApiProvider
  /** The provider's HTTP status, or null when the SDK error carried none (a network fault). */
  readonly status: number | null
  /** The provider's error body, parsed to JSON when it was JSON, otherwise as given. */
  readonly body: unknown
  /** Retry-After from a 429/503, in milliseconds, or null when the response had none. */
  readonly retryAfterMs: number | null

  constructor(
    provider: MailApiProvider,
    opts: {
      status?: number | null
      body?: unknown
      retryAfterMs?: number | null
      message?: string
      cause?: unknown
    } = {},
  ) {
    const status = opts.status ?? null
    super(
      opts.message ?? `${provider} API error${status != null ? ` (${status})` : ''}`,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    )
    this.name = 'ProviderApiError'
    this.provider = provider
    this.status = status
    this.body = opts.body
    this.retryAfterMs = opts.retryAfterMs ?? null
  }
}

/**
 * Read one header off whatever a provider SDK hands back. gaxios attaches a fetch
 * `Headers` instance; a hand-built error or an older transport may use a plain
 * object keyed by lowercase name. This reads either, case-insensitively.
 */
export function readHeader(headers: unknown, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  const asHeaders = headers as { get?: (n: string) => string | null }
  if (typeof asHeaders.get === 'function') {
    return asHeaders.get(name) ?? asHeaders.get(lower)
  }
  const rec = headers as Record<string, unknown>
  const raw = rec[name] ?? rec[lower]
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null
  return raw != null ? String(raw) : null
}

/**
 * Parse an HTTP `Retry-After` value to milliseconds. The header is either
 * delta-seconds ("120") or an HTTP-date ("Wed, 21 Aug 2026 07:28:00 GMT"). A date
 * already in the past clamps to 0. An unparseable value returns null rather than a
 * guess — the caller then applies its own default backoff.
 */
export function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null
  const trimmed = retryAfter.trim()
  if (trimmed === '') return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const when = Date.parse(trimmed)
  if (Number.isNaN(when)) return null
  return Math.max(0, when - Date.now())
}

/** Convenience: pull `Retry-After` off a headers bag and return it in milliseconds. */
export function retryAfterMsFromHeaders(headers: unknown): number | null {
  return parseRetryAfterMs(readHeader(headers, 'retry-after'))
}
