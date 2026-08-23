/**
 * The one typed boundary for recording-transcription lifecycle evidence. It
 * deliberately records identifiers and provider metadata only — never audio,
 * transcript text, request bodies, signed URLs, or raw provider errors.
 */
export const TRANSCRIPTION_STAGES = ['recording', 'provider', 'persistence'] as const
export type TranscriptionStage = (typeof TRANSCRIPTION_STAGES)[number]

export type TranscriptLifecycleState = 'pending' | 'done' | 'failed' | 'skipped-not-recorded'

export interface TranscriptionDiagnostic {
  correlationId: string
  orgId: string
  job: { name: 'transcribe-recording'; retryCount: number; retryLimit: number }
  recording: { available: boolean; source: 'private-s3' | 'unavailable' }
  provider: { name: 'deepgram'; outcome: 'not-called' | 'succeeded' | 'failed'; status: number | null }
  stage: TranscriptionStage
  transcriptState: TranscriptLifecycleState
  nextAction: string
}

function nextAction(
  stage: TranscriptionStage,
  providerStatus: number | null,
  transcriptState: TranscriptLifecycleState,
): string {
  if (transcriptState === 'done' || transcriptState === 'skipped-not-recorded') return 'none'
  if (stage === 'recording') return 'verify-private-recording-object'
  if (stage === 'persistence') return 'verify-transcript-persistence'
  if (providerStatus === 401 || providerStatus === 403) return 'verify-deepgram-credentials'
  if (providerStatus === 429) return 'review-deepgram-rate-limit'
  return 'inspect-deepgram-response'
}

export function transcriptionDiagnostic(input: {
  callId: string
  orgId: string
  retryCount: number
  retryLimit: number
  recordingAvailable: boolean
  providerOutcome: TranscriptionDiagnostic['provider']['outcome']
  providerStatus?: number | null
  stage: TranscriptionStage
  transcriptState: TranscriptLifecycleState
}): TranscriptionDiagnostic {
  const providerStatus = input.providerStatus ?? null
  return {
    correlationId: `transcribe-recording:${input.callId}`,
    orgId: input.orgId,
    job: { name: 'transcribe-recording', retryCount: input.retryCount, retryLimit: input.retryLimit },
    recording: { available: input.recordingAvailable, source: input.recordingAvailable ? 'private-s3' : 'unavailable' },
    provider: { name: 'deepgram', outcome: input.providerOutcome, status: providerStatus },
    stage: input.stage,
    transcriptState: input.transcriptState,
    nextAction: nextAction(input.stage, providerStatus, input.transcriptState),
  }
}
