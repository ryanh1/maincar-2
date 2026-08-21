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

/** What the greenroom recorded before the call was placed. Null if never asked. */
export type RecordingConsent = 'granted' | 'declined'

/** Allowed values mirror the comments on `Call.transcriptStatus` in schema.prisma. */
export type TranscriptStatus = 'pending' | 'done' | 'failed' | 'skipped-not-recorded'

/** What POST echoes back: the queued row, before the call has run. */
export interface Call {
  id: string
  direction: CallDirection
  status: CallStatus
  fromE164: string
  toE164: string
  recordingConsent: RecordingConsent | null
  /** Null until Twilio accepts the call. */
  twilioCallSid: string | null
  createdAt: string
}

/**
 * One row of the history list. Everything `Call` carries, plus the three fields a
 * history table shows and sorts on — `durationS` and the two run timestamps.
 */
export interface CallHistoryItem extends Call {
  durationS: number | null
  startedAt: string | null
  endedAt: string | null
}

/**
 * The full record a call-detail view shows: every history field, plus the ones a
 * table has no use for — the recording flags, the transcript, and its status —
 * and a freshly signed `recordingUrl`. That URL is NOT the stored column value
 * (a bare object key): the server signs it at request time, so it is null until
 * a recording exists.
 */
export interface CallDetail extends CallHistoryItem {
  recordingEnabled: boolean | null
  recordingUrl: string | null
  transcriptStatus: TranscriptStatus
  transcript: string | null
}

/** What POST accepts. `toE164` and `recordingConsent` are both required. */
export interface CreateCallInput {
  toE164: string
  recordingConsent: RecordingConsent
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
