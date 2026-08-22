/** The one voicemail shape the detail endpoint returns to the browser. */
export interface Voicemail {
  id: string
  fromE164: string
  toE164: string
  recordingUrl: string | null
  transcriptStatus: 'pending' | 'done' | 'failed'
  transcript: string | null
  durationS: number | null
  createdAt: string
}

export interface VoicemailResponse {
  voicemail: Voicemail
}
