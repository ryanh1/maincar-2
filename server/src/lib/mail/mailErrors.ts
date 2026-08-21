// mailErrors.ts — the typed error set every mail module throws from.
//
// A caller never catches a Google or a Microsoft Graph error type. int-seam's two
// implementations (IH-15/IH-16) map every provider failure onto one of these, the
// factory (IH-17) throws MailboxNotFoundError, and the shared contract suite
// (IH-14) asserts on them BY NAME. The `name` on each class is therefore stable: a
// catch site and a test both switch on it, so it is an API and does not change
// casually. IH-12 extends this set as the seam grows — this is its first version.
//
// Each error extends Error directly rather than a shared base, so `instanceof` on
// one never accidentally matches another: a MailAuthError is not a MailApiError,
// and a test that asks for one does not silently accept the other.

/**
 * The provider returned something the implementation could not use — a malformed
 * body, an unexpected shape, a response that failed its `zod` parse. It is thrown
 * in place of a raw `TypeError`, so a caller always catches a mail error and never
 * a stray runtime crash from reaching into an undefined field.
 */
export class MailApiError extends Error {
  constructor(message = 'The mail provider returned an unusable response.') {
    super(message)
    this.name = 'MailApiError'
  }
}

/**
 * No mailbox matches the id and org asked for. Thrown by `getMailProvider` (IH-17);
 * a mailbox id from another org throws this too, never a leak that would confirm
 * the id names a real row in some other tenant.
 */
export class MailboxNotFoundError extends Error {
  constructor(message = 'No mailbox matches that id.') {
    super(message)
    this.name = 'MailboxNotFoundError'
  }
}

/**
 * The provider rejected the access token with a 401 even AFTER a fresh one was
 * minted. An implementation never handles a 401 itself — `withFreshAccessToken`
 * owns refreshing — so a 401 here means the grant is genuinely no longer good.
 */
export class MailAuthError extends Error {
  constructor(message = 'The mailbox rejected the access token.') {
    super(message)
    this.name = 'MailAuthError'
  }
}

/**
 * A stored sync cursor (Gmail `historyId`, Graph `deltaLink`) has expired, so a
 * delta from it is impossible and the caller must start a fresh sync rather than
 * silently miss the messages in the gap.
 */
export class CursorExpiredError extends Error {
  constructor(message = 'The sync cursor has expired; start a fresh sync.') {
    super(message)
    this.name = 'CursorExpiredError'
  }
}

/**
 * The provider is rate limiting. It carries `retryAfterMs` — how long the provider
 * asked the caller to wait, in milliseconds — so a backoff has a real number to use
 * instead of guessing.
 */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number, message = 'The mail provider is rate limiting the request.') {
    super(message)
    this.name = 'RateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}
