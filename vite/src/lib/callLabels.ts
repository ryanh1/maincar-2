/**
 * Human labels for a Call's enum fields.
 *
 * A raw enum value is never shown to a person (frontend.md → Page and section
 * structure: "Never show a raw enum value"). The history table, and the detail
 * view that MAI-40 builds next, both read these — so the mapping lives here, once,
 * rather than inline in either screen.
 */
import type { CallDirection, CallStatus, TranscriptStatus } from '@/lib/callTypes'

// Which way the call went, for the detail view. Mirrors the schema's
// `Call.direction` values — a raw enum is never shown to a person.
const CALL_DIRECTION_LABEL: Record<CallDirection, string> = {
  outbound: 'Outbound',
  inbound: 'Inbound',
}

export function getCallDirectionLabel(direction: string): string {
  return CALL_DIRECTION_LABEL[direction as CallDirection] ?? direction
}

// The outcome a rep reads off the row. Mirrors the schema's `Call.status` values.
const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  queued: 'Queued',
  ringing: 'Ringing',
  'in-progress': 'In progress',
  completed: 'Completed',
  busy: 'Busy',
  failed: 'Failed',
  'no-answer': 'No answer',
  canceled: 'Canceled',
}

export function getCallStatusLabel(status: string): string {
  return CALL_STATUS_LABEL[status as CallStatus] ?? status
}

// Where the transcript stands. `skipped-not-recorded` is the common resting state
// for a call that was never recorded, so it reads as a plain dash, not an error.
const TRANSCRIPT_STATUS_LABEL: Record<TranscriptStatus, string> = {
  pending: 'Pending',
  done: 'Ready',
  failed: 'Failed',
  'skipped-not-recorded': 'None',
}

export function getTranscriptStatusLabel(status: string): string {
  return TRANSCRIPT_STATUS_LABEL[status as TranscriptStatus] ?? status
}
