/**
 * Server-side boundary for caller-ID-name registration.
 *
 * Carrier-specific credentials and SDK calls belong here. The current Twilio
 * account has no configured Trust Hub CNAM registration, so the production
 * adapter tells the product that plainly instead of attempting a paid or
 * irreversible carrier operation. Jobs depend only on this small contract and
 * use fakes in tests.
 */
export type CallerNameRegistrationResult =
  | { kind: 'pending'; requestId: string }
  | { kind: 'active' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unsupported'; reason: string }

export type CallerNameRegistrationInput = {
  /** The carrier's private identifier for the owned phone number. */
  phoneNumberSid: string
  /** E.164 value used only at the server-to-carrier boundary. */
  e164: string
  callerName: string
}

const NOT_CONFIGURED_REASON =
  'Caller-ID name registration is not configured for this carrier. Contact your account admin.'

/**
 * Submit a CNAM registration request.
 *
 * Twilio requires a vetted Trust Hub business profile and CNAM trust product
 * before a number can be registered. Until those account-level prerequisites
 * are configured, no carrier call is made and the UI receives an actionable
 * unsupported outcome.
 */
export async function submitCallerNameRegistration(
  _input: CallerNameRegistrationInput,
): Promise<CallerNameRegistrationResult> {
  return { kind: 'unsupported', reason: NOT_CONFIGURED_REASON }
}

/**
 * Read the carrier's latest state for one registration request.
 *
 * This is intentionally separate from submission: at-least-once jobs can run
 * it repeatedly without creating a second carrier registration.
 */
export async function reconcileCallerNameRegistration(
  _input: { requestId: string },
): Promise<CallerNameRegistrationResult> {
  return { kind: 'unsupported', reason: NOT_CONFIGURED_REASON }
}
