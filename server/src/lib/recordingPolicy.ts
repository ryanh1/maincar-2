import { isTwoPartyConsentState } from './consentStates.js'
import { usStateForE164 } from './npaToState.js'

export const RECORDING_DECISION_REASONS = [
  'allowed',
  'recording-disabled',
  'two-party-consent-state',
  'state-not-allowed',
  'unknown-destination-state',
] as const

export type RecordingDecisionReason = (typeof RECORDING_DECISION_REASONS)[number]

export interface RecordingPolicy {
  recordCalls: boolean
  blockTwoPartyConsentStates: boolean
  allowedStates: string[]
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

  if (destinationState === null) {
    return policy.blockTwoPartyConsentStates
      ? { record: false, destinationState, reason: 'unknown-destination-state' }
      : { record: true, destinationState, reason: 'allowed' }
  }

  if (policy.blockTwoPartyConsentStates && isTwoPartyConsentState(destinationState)) {
    return { record: false, destinationState, reason: 'two-party-consent-state' }
  }

  if (policy.allowedStates.length > 0 && !policy.allowedStates.includes(destinationState)) {
    return { record: false, destinationState, reason: 'state-not-allowed' }
  }

  return { record: true, destinationState, reason: 'allowed' }
}
