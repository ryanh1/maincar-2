export type VoicemailGreetingStatus = 'uploading' | 'transcoding' | 'ready' | 'failed' | 'active'

export interface VoicemailGreeting {
  id: string
  status: VoicemailGreetingStatus
  durationSeconds: number | null
  failureReason: string | null
  audioUrl: string | null
  uploadedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VoicemailGreetingResponse {
  greeting: {
    active: VoicemailGreeting | null
    candidates: VoicemailGreeting[]
  }
}

export interface SingleVoicemailGreetingResponse {
  greeting: VoicemailGreeting
}
