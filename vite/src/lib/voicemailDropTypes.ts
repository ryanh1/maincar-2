export type VoicemailDropStatus = 'transcoding' | 'transcribing' | 'ready' | 'failed'
export type VoicemailDropTranscriptStatus = 'pending' | 'done' | 'failed'

export interface VoicemailDrop {
  id: string
  name: string
  duration: number
  transcript: string | null
  transcriptStatus: VoicemailDropTranscriptStatus
  status: VoicemailDropStatus
  isDefault: boolean
  /** A short-lived, server-signed playback URL. Null while audio is unavailable. */
  audioUrl: string | null
}

export interface VoicemailDropsResponse {
  drops: VoicemailDrop[]
  total: number
}

export interface VoicemailDropResponse {
  drop: VoicemailDrop
}
