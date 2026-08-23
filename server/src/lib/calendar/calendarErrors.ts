/** A provider response could not be normalized into the calendar contract. */
export class CalendarApiError extends Error {
  constructor(message = 'The calendar provider returned an unusable response.') {
    super(message)
    this.name = 'CalendarApiError'
  }
}

/** A fresh access token was rejected by the calendar provider. */
export class CalendarAuthError extends Error {
  constructor(message = 'The calendar provider rejected the access token.') {
    super(message)
    this.name = 'CalendarAuthError'
  }
}

/** A provider cursor can no longer be resumed; callers must restart the sync. */
export class CalendarCursorExpiredError extends Error {
  constructor(message = 'The calendar sync cursor has expired; start a fresh sync.') {
    super(message)
    this.name = 'CalendarCursorExpiredError'
  }
}

/** The provider requested that the caller wait before retrying. */
export class CalendarRateLimitedError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number, message = 'The calendar provider is rate limiting the request.') {
    super(message)
    this.name = 'CalendarRateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

/** The requested lifecycle operation is not supported by this provider connection. */
export class CalendarCapabilityError extends Error {
  constructor(readonly capability: string, message = `The calendar provider does not support ${capability}.`) {
    super(message)
    this.name = 'CalendarCapabilityError'
  }
}

/** A write targeted a calendar event version that is no longer current. */
export class CalendarVersionConflictError extends Error {
  constructor(message = 'The calendar event changed before this update could be applied.') {
    super(message)
    this.name = 'CalendarVersionConflictError'
  }
}
