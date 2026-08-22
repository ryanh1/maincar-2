import { usStateForE164 } from './npaToState.js'

export const RECORDING_DECISION_REASONS = [
  'allowed',
  'recording-disabled',
  'state-blocked',
  'unknown-destination-state',
] as const

export type RecordingDecisionReason = (typeof RECORDING_DECISION_REASONS)[number]

export interface RecordingPolicy {
  recordCalls: boolean
  /** USPS codes plus UNKNOWN. This persisted set is the policy source of truth. */
  blockedStates: string[]
}

export interface RecordingPolicyDecision {
  record: boolean
  destinationState: string | null
  reason: RecordingDecisionReason
}

/**
 * Resolves the organization policy once, synchronously, before the Call row and
 * Twilio bridge are created. The saved result is the only decision Twilio reads.
 */
export function decideRecordingPolicy(
  policy: RecordingPolicy,
  toE164: string,
): RecordingPolicyDecision {
  const destinationState = usStateForE164(toE164)

  if (!policy.recordCalls) {
    return { record: false, destinationState, reason: 'recording-disabled' }
  }

  if (destinationState === null && policy.blockedStates.includes('UNKNOWN')) {
    return { record: false, destinationState, reason: 'unknown-destination-state' }
  }

  if (destinationState !== null && policy.blockedStates.includes(destinationState)) {
    return { record: false, destinationState, reason: 'state-blocked' }
  }

  return { record: true, destinationState, reason: 'allowed' }
}
