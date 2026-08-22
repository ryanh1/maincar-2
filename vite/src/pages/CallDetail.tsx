import { useState } from 'react'
import { ArrowLeft, Check, Copy, Download, Phone, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useGetCallDetail } from '@/hooks/dialer'
import type { CallDetail as CallDetailShape, TranscriptStatus } from '@/hooks/dialer'
import {
  getCallDirectionLabel,
  getCallStatusLabel,
} from '@/lib/callLabels'
import { formatDateTime } from '@/lib/datetime'
import { formatElapsed } from '@/lib/duration'
import { useAuth } from '@/providers/useAuth'

// Deleting a call HISTORY record has no endpoint yet: DELETE /calls/:id is the
// hang-up (it cancels a live call), not a record delete. Rather than ship a
// live-looking control that does nothing (CLAUDE.md → Verification), the Delete
// button renders visibly disabled with an honest line naming what it waits on.
const DELETE_UNAVAILABLE = "Deleting call records isn't available yet."

/**
 * One call in full: who it was between, how it went, its transcript, and its
 * recording.
 *
 * The id comes from the path and the org from the signed-in user, so both halves
 * of the detail lookup are present before the query runs. Every time-of-day is
 * rendered through the datetime helpers in the VIEWING user's zone, with the zone
 * label — never a bare local time (CLAUDE.md → Dates & Times).
 */
export function CallDetail() {
  const { id } = useParams<{ id: string }>()
  const { user, org } = useAuth()
  const orgId = org?.id ?? null

  const callQuery = useGetCallDetail(orgId, id)
  const call = callQuery.data?.call

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/calls">
            <ArrowLeft size={16} aria-hidden />
            Back
          </Link>
        </Button>
      </div>

      <Separator className="my-8" />

      {callQuery.isPending && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {callQuery.isError && (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">Could not load this call.</p>
          <Button variant="secondary" size="sm" onClick={() => void callQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {call && <CallDetailBody call={call} timeZone={user?.timeZone} />}
    </div>
  )
}

function CallDetailBody({
  call,
  timeZone,
}: {
  call: CallDetailShape
  timeZone: string | null | undefined
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Phone size={16} aria-hidden className="text-muted-foreground" />
        <h1 className="text-base font-semibold tabular-nums">{call.toE164}</h1>
      </div>

      <CallFacts call={call} timeZone={timeZone} />
      <TranscriptSection status={call.transcriptStatus} transcript={call.transcript} />
      <RecordingSection recordingUrl={call.recordingUrl} number={call.toE164} reason={call.recordingReason} />

      {/* The reason this is dead is the whole message, so it is on the screen,
          not behind a hover. A tooltip is invisible until pointed at and absent
          on touch (.claude/rules/design-system.md → Icon-only buttons), and the
          design system already asks a disabled control for "an honest line". */}
      <div className="flex flex-col items-start gap-2">
        <Button variant="destructive" size="sm" disabled>
          <Trash2 size={16} aria-hidden />
          Delete call
        </Button>
        <p className="text-xs text-muted-foreground">{DELETE_UNAVAILABLE}</p>
      </div>
    </div>
  )
}

// The who/when/how-long facts, as a definition list. A missing timestamp is a
// dash, never a bare local time or an empty cell.
function CallFacts({
  call,
  timeZone,
}: {
  call: CallDetailShape
  timeZone: string | null | undefined
}) {
  const facts: { label: string; value: string; numeric?: boolean }[] = [
    { label: 'From', value: call.fromE164, numeric: true },
    { label: 'To', value: call.toE164, numeric: true },
    { label: 'Direction', value: getCallDirectionLabel(call.direction) },
    { label: 'Outcome', value: getCallStatusLabel(call.status) },
    {
      label: 'Duration',
      value: call.durationS === null ? '—' : formatElapsed(call.durationS),
      numeric: true,
    },
    {
      label: 'Started',
      value: call.startedAt ? formatDateTime(call.startedAt, timeZone) : '—',
    },
    {
      label: 'Ended',
      value: call.endedAt ? formatDateTime(call.endedAt, timeZone) : '—',
    },
  ]

  return (
    <div className="rounded-md border border-border p-4">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className={fact.numeric ? 'text-sm tabular-nums' : 'text-sm'}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// What the reader sees while the transcript is still being made, failed, was
// never recorded, or is ready. Only a ready transcript with text can be copied.
function TranscriptSection({
  status,
  transcript,
}: {
  status: TranscriptStatus
  transcript: string | null
}) {
  const text = status === 'done' ? (transcript ?? '') : ''
  const hasText = text.trim() !== ''

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Transcript</h2>
        {hasText && <CopyTranscriptButton text={text} />}
      </div>

      <div className="mt-3">
        {hasText ? (
          <p className="text-sm whitespace-pre-wrap">{text}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{transcriptMessage(status)}</p>
        )}
      </div>
    </div>
  )
}

// The resting message for a transcript that has no text to show. `done` with no
// text is the odd case — the job finished but produced nothing — so it reads as a
// plain fact, not an error.
function transcriptMessage(status: TranscriptStatus): string {
  switch (status) {
    case 'pending':
      return 'Transcribing…'
    case 'failed':
      return 'The transcript could not be generated.'
    case 'skipped-not-recorded':
      return 'This call was not recorded, so there is no transcript.'
    case 'done':
      return 'No speech was transcribed.'
    default:
      return ''
  }
}

// Copies the transcript to the clipboard, then swaps its icon to a checkmark for
// 1.5s (design-system.md → CopyButton). The label never changes; a failure is a
// toast, not a silent no-op.
function CopyTranscriptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy the transcript. Copy it by hand.')
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()}>
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      Copy transcript
    </Button>
  )
}

// The recording, if there is one: an inline player and a download link. No
// recording is an honest empty state, not a broken-looking player.
function RecordingSection({
  recordingUrl,
  number,
  reason,
}: {
  recordingUrl: string | null
  number: string
  reason: CallDetailShape['recordingReason']
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold">Recording</h2>

      {recordingUrl ? (
        <div className="mt-3 flex flex-col gap-3">
          <audio controls src={recordingUrl} className="w-full" aria-label={`Recording of the call to ${number}`}>
            Your browser cannot play this recording.
          </audio>
          <div>
            <Button asChild variant="secondary" size="sm">
              <a href={recordingUrl} download>
                <Download size={16} aria-hidden />
                Download
              </a>
            </Button>
          </div>
        </div>
      ) : <p className="mt-3 text-sm text-muted-foreground">{recordingReason(reason)}</p>}
    </div>
  )
}

function recordingReason(reason: CallDetailShape['recordingReason']): string {
  switch (reason) {
    case 'recording-disabled': return 'Recording was disabled for the organization.'
    case 'two-party-consent-state': return 'Recording was off because the destination appeared to be in a two-party-consent state.'
    case 'state-not-allowed': return 'Recording was off because the destination was not in the organization’s allowed states.'
    case 'unknown-destination-state': return 'Recording was off because the destination state could not be determined.'
    default: return 'This call has no recording.'
  }
}
