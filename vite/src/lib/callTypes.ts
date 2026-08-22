/**
 * The client's view of a Call.
 *
 * These mirror the three mappers in `server/src/routes/calls.ts` exactly — the
 * only shapes that ever reach the browser. `orgId` and `userId` are absent on
 * purpose: the caller is the requester and names the org in the path, so the
 * server leaves both out rather than putting a tenant key in one more place that
 * could drift.
 *
 * Three shapes, not one, because the server returns three:
 *  - `Call` — what POST echoes back (`mapCallToApi`). The call has not run yet,
 *    so it carries no duration and no timestamps beyond `createdAt`.
 *  - `CallHistoryItem` — one row of the history list (`mapCallToHistoryApi`).
 *  - `CallDetail` — the full record with transcript and a signed recording link
 *    (`mapCallToDetailApi`). DELETE returns this shape too.
 */

/** Allowed values mirror the comments on `Call.direction` in schema.prisma. */
export type CallDirection = 'outbound' | 'inbound'

/** Allowed values mirror the comments on `Call.status` in schema.prisma. */
export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled'

export type RecordingDecisionReason =
  | 'allowed'
  | 'recording-disabled'
  | 'two-party-consent-state'
  | 'state-not-allowed'
  | 'unknown-destination-state'

/** Allowed values mirror the comments on `Call.transcriptStatus` in schema.prisma. */
export type TranscriptStatus = 'pending' | 'done' | 'failed' | 'skipped-not-recorded'

/** The independent lifecycle for a review asset, separate from Call.status. */
export type ReviewLifecycleState =
  | 'unavailable'
  | 'unavailable-by-consent'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'missing'

/** Audio is the only source today; video is reserved for a later player. */
export type CallMediaSource = {
  kind: 'audio' | 'video'
  url: string
  /** Absolute expiry; clients refresh the call read before retrying an expired URL. */
  expiresAt: string
}

export interface CallReviewPerson {
  id: string
  firstName: string | null
  lastName: string | null
  preferredFirstName: string | null
  title?: string | null
}

export interface CallReviewCompany {
  id: string
  name: string | null
}

export interface CallReviewDeal {
  id: string
  name: string
  status: string
}

export interface TimedTranscriptSegment {
  id: string
  position: number
  speakerKey: string
  startMs: number
  endMs: number
  text: string
  words: unknown
}

export interface CallTranscriptPass {
  id: string
  provider: string
  plainText: string
  segments: TimedTranscriptSegment[]
}

export interface CallReviewSpeaker {
  id: string
  speakerKey: string
  displayName: string | null
  source: string
  confidence: number | null
  confirmedAt: string | null
  manualOverride: boolean
  person: CallReviewPerson | null
}

/** The typed, one-request read model for the call review workbench. */
export interface CallReviewReadModel {
  crm: {
    person: CallReviewPerson | null
    company: CallReviewCompany | null
    deal: CallReviewDeal | null
  }
  recording: { state: ReviewLifecycleState; source: CallMediaSource | null }
  transcript: { state: ReviewLifecycleState; pass: CallTranscriptPass | null }
  speakers: CallReviewSpeaker[]
}

/** What POST echoes back: the queued row, before the call has run. */
export interface Call {
  id: string
  direction: CallDirection
  status: CallStatus
  fromE164: string
  toE164: string
  recordingPlanned: boolean | null
  recordingReason: RecordingDecisionReason | null
  /** Null until Twilio accepts the call. */
  twilioCallSid: string | null
  createdAt: string
}

/**
 * One row of the history list. Everything `Call` carries, plus the fields a
 * history table shows and sorts on — `durationS` and the two run timestamps — and
 * `transcriptStatus`, so the Transcript column reads a real value without
 * fetching each row's detail. It stops short of the transcript TEXT and the
 * signed recording link, which only `CallDetail` carries.
 */
export interface CallHistoryItem extends Call {
  durationS: number | null
  startedAt: string | null
  endedAt: string | null
  transcriptStatus: TranscriptStatus
}

/**
 * The full record a call-detail view shows: every history field (including
 * `transcriptStatus`), plus the ones a table has no use for — the recording flags
 * and the transcript TEXT — and a freshly signed `recordingUrl`. That URL is NOT
 * the stored column value (a bare object key): the server signs it at request
 * time, so it is null until a recording exists.
 */
export interface CallDetail extends CallHistoryItem {
  destinationState: string | null
  recordingEnabled: boolean | null
  recordingUrl: string | null
  transcript: string | null
  /** Present on authenticated GET detail responses; optional while DELETE remains legacy-compatible. */
  review?: CallReviewReadModel
}

/** What POST accepts. Recording is decided by the organization policy. */
export interface CreateCallInput {
  toE164: string
}

/** The columns the history list may sort on. Mirrors `SORT_FIELDS` on the server. */
export const CALL_SORT_COLUMNS = ['createdAt', 'toE164', 'status', 'durationS'] as const
export type CallSortColumn = (typeof CALL_SORT_COLUMNS)[number]

/** What the history table asks the server for. Every field lives in the URL. */
export interface GetCallsParams {
  page?: number
  limit?: number
  sort?: CallSortColumn
  dir?: 'asc' | 'desc'
  /** Digits of the destination number, like "201". */
  q?: string
}

/** The history list. One page, plus the totals the pager reads. */
export interface GetCallsResponse {
  calls: CallHistoryItem[]
  total: number
  page: number
  limit: number
}

/** What POST returns: the queued row, wrapped. */
export interface CreateCallResponse {
  call: Call
}

/** What GET :id and DELETE :id return: the full record, wrapped. */
export interface CallDetailResponse {
  call: CallDetail
}

/** What GET /voice-token returns: a short-lived credential for `new Device(token)`. */
export interface VoiceTokenResponse {
  token: string
  identity: string
  ttlSeconds: number
}
