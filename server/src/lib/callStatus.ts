/**
 * The call-status vocabulary shared by the Twilio status webhook
 * (routes/twilioVoice.ts), the double-call guard (routes/calls.ts), and the
 * stale-call reaper (jobs/reapStaleCalls.ts).
 *
 * Pulled into one file so the three cannot drift into disagreeing about which
 * statuses count as "in flight" or how a Twilio CallStatus maps onto
 * Call.status — the reaper reconciles against the same Twilio API the webhook
 * itself reports through, so both need the identical mapping.
 */

/**
 * Twilio's `CallStatus` → our `Call.status`.
 *
 * Twilio's vocabulary (queued, ringing, in-progress, completed, busy, failed,
 * no-answer, canceled) is exactly the set `Call.status` allows
 * (server/prisma/schema.prisma → Call), so this is a whitelist, not a rename: it
 * exists so a value Twilio might one day add is dropped rather than written blind
 * into the column. A `CallStatus` not in this map means "unrecognized".
 */
export const TWILIO_TO_CALL_STATUS: Record<string, string> = {
  queued: 'queued',
  ringing: 'ringing',
  'in-progress': 'in-progress',
  completed: 'completed',
  busy: 'busy',
  failed: 'failed',
  'no-answer': 'no-answer',
  canceled: 'canceled',
}

/**
 * The statuses a call does not come back from. Reaching one of these is the
 * moment the call ended.
 */
export const TERMINAL_CALL_STATUSES = new Set([
  'completed',
  'busy',
  'failed',
  'no-answer',
  'canceled',
])

/**
 * The call states that mean "a call is already up" — used both by the
 * double-call guard (a second call to the same number while one of these is up
 * is the double-click it guards against) and by the stale-call reaper (these are
 * the only statuses a row can be stuck in).
 */
export const IN_FLIGHT_STATUSES = ['queued', 'ringing', 'in-progress']

// `AnsweredBy` comes from Twilio Answering Machine Detection (AMD). The
// machine-end variants are emitted by DetectMessageEnd; machine_start comes
// from Enable. Human, fax, and unknown are deliberately not outcomes — a rep
// remains responsible for those calls.
const MACHINE_ANSWERED_BY = new Set([
  'machine_start',
  'machine_end_beep',
  'machine_end_silence',
  'machine_end_other',
])

/**
 * The stable disposition value that Twilio facts can settle without asking an
 * LLM or a rep. `null` means the call stays undispositioned for the rep.
 *
 * The values intentionally match organization-configurable DispositionDef
 * values. The webhook still verifies an active record exists before writing;
 * this function only makes the deterministic mapping explicit and testable.
 */
export function automaticDispositionValue(
  callStatus: string | undefined,
  answeredBy: string | undefined,
): string | null {
  if (answeredBy && MACHINE_ANSWERED_BY.has(answeredBy)) return 'voicemail'

  switch (callStatus) {
    case 'busy': return 'busy'
    case 'failed': return 'failed'
    case 'no-answer': return 'no_answer'
    default: return null
  }
}
