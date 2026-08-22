/** The one voicemail shape the detail endpoint returns to the browser. */
export interface Voicemail {
  id: string
  fromE164: string
  toE164: string
  recordingUrl: string | null
  transcriptStatus: VoicemailTranscriptStatus
  transcript: string | null
  durationS: number | null
  createdAt: string
}

export interface VoicemailResponse {
  voicemail: Voicemail
}

/** Values mirror Voicemail.transcriptStatus in server/prisma/schema.prisma. */
export type VoicemailTranscriptStatus = 'pending' | 'done' | 'failed'

/** One inbox row. Media stays on the detail endpoint so a list cannot leak an S3 key. */
export interface VoicemailListItem {
  id: string
  fromE164: string
  durationS: number | null
  transcriptStatus: VoicemailTranscriptStatus
  transcript: string | null
  createdAt: string
}

export interface GetVoicemailsParams {
  page?: number
  limit?: number
  /** Digits of the caller number, like 201. */
  q?: string
}

export interface GetVoicemailsResponse {
  voicemails: VoicemailListItem[]
  total: number
  page: number
  limit: number
}
