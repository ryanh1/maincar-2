export interface RecordingPolicy {
  recordCalls: boolean
  blockTwoPartyConsentStates: boolean
  allowedStates: string[]
}

export interface RecordingPolicyResponse {
  recordingPolicy: RecordingPolicy
}

export type RecordingPolicyPatch = Partial<RecordingPolicy>
