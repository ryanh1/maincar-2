export interface RecordingPolicy {
  recordCalls: boolean
  blockedStates: string[]
}

export interface RecordingPolicyResponse {
  recordingPolicy: RecordingPolicy
}

export type RecordingPolicyPatch = Partial<RecordingPolicy>
