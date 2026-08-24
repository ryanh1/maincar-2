import { useCallback, useRef, useState, type PointerEvent } from 'react'
import { Check, Copy, Download, MessageSquarePlus, Phone } from 'lucide-react'
import { toast } from 'sonner'

import { AudioPlayer, type AudioMediaSource } from '@/components/call-review/AudioPlayer'
import { CallCommentsRail } from '@/components/call-review/CallCommentsRail'
import type { SpeakerRibbonSpeaker } from '@/components/call-review/SpeakerRibbon'
import { TimedTranscript, type TimedTranscriptSelection } from '@/components/call-review/TimedTranscript'
import { Button } from '@/components/ui/button'
import { useGetCallComments, useSynchronizeCallComments } from '@/hooks/callComments'
import type { CallDetail } from '@/hooks/dialer'
import type { CallCommentDraftAnchor } from '@/lib/callCommentTypes'
import { getCallDirectionLabel, getCallStatusLabel } from '@/lib/callLabels'
import { formatDateTime } from '@/lib/datetime'
import { formatElapsed } from '@/lib/duration'
import { getStoredCallReviewLayout, saveCallReviewLayout, type CallReviewLayout, type CallReviewLayoutPreset } from '@/lib/callReviewLayout'
import { cn } from '@/lib/utils'

const LAYOUTS: Array<{ preset: CallReviewLayoutPreset; playbackWidth: number; label: string }> = [
  { preset: 'focused-comments', playbackWidth: 40, label: 'Focus comments' },
  { preset: 'balanced', playbackWidth: 60, label: 'Balanced' },
  { preset: 'focused-transcript', playbackWidth: 70, label: 'Focus transcript' },
]

function getPersonName(call: CallDetail): string | null {
  const person = call.review?.crm.person
  if (!person) return null
  return person.preferredFirstName ?? ([person.firstName, person.lastName].filter(Boolean).join(' ') || null)
}

function getSpeakerLabel(speakerKey: string, speaker: NonNullable<CallDetail['review']>['speakers'][number] | undefined, unknownNumber: number): string {
  if (speaker?.displayName) return speaker.displayName
  const personName = speaker?.person?.preferredFirstName ?? ([speaker?.person?.firstName, speaker?.person?.lastName].filter(Boolean).join(' ') || null)
  if (personName) return personName
  if (speakerKey === 'rep') return 'You'
  return `Person ${unknownNumber}`
}

/** The call-review frame keeps both panes mounted across responsive navigation. */
export function CallDetail_Workbench({
  call,
  orgId,
  timeZone,
  userId,
}: {
  call: CallDetail
  orgId: string
  timeZone: string | null | undefined
  userId: string
}) {
  const [layout, setLayout] = useState<CallReviewLayout>(() => getStoredCallReviewLayout(userId))
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [selection, setSelection] = useState<TimedTranscriptSelection | null>(null)
  const [seekRequest, setSeekRequest] = useState<{ atMs: number; sequence: number } | null>(null)
  const [commentDraft, setCommentDraft] = useState<CallCommentDraftAnchor | null>(null)
  const comments = useGetCallComments(orgId, call.id)
  const workbenchRef = useRef<HTMLDivElement>(null)
  const requestSeek = useCallback((atMs: number) => {
    setSeekRequest((current) => ({ atMs, sequence: (current?.sequence ?? 0) + 1 }))
  }, [])
  const activateMoment = useCallback((atMs: number) => {
    setCurrentTimeMs(atMs)
    requestSeek(atMs)
  }, [requestSeek])
  const {
    activeCommentId,
    activePane,
    activateComment,
    commentPins,
    nearestCommentId,
    setActivePane,
  } = useSynchronizeCallComments({
    callId: call.id,
    threads: comments.data?.comments,
    currentTimeMs,
    onActivateMoment: activateMoment,
  })

  function updateLayout(next: CallReviewLayout): void {
    setLayout(next)
    saveCallReviewLayout(userId, next)
  }

  function choosePreset(preset: CallReviewLayoutPreset): void {
    const next = LAYOUTS.find((option) => option.preset === preset)
    if (next) updateLayout({ preset: next.preset, playbackWidth: next.playbackWidth })
  }

  function updateWidth(nextWidth: number): void {
    const playbackWidth = Math.max(30, Math.min(70, Math.round(nextWidth)))
    const preset = LAYOUTS.find((option) => option.playbackWidth === playbackWidth)?.preset ?? 'balanced'
    updateLayout({ preset, playbackWidth })
  }

  function startResize(event: PointerEvent<HTMLDivElement>): void {
    const workbench = workbenchRef.current
    if (!workbench) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const resize = (moveEvent: globalThis.PointerEvent) => {
      const bounds = workbench.getBoundingClientRect()
      updateWidth(((moveEvent.clientX - bounds.left) / bounds.width) * 100)
    }
    const stopResize = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResize)
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stopResize)
  }

  function resizeWithKeyboard(key: string): void {
    if (key === 'ArrowLeft') updateWidth(layout.playbackWidth - 2)
    if (key === 'ArrowRight') updateWidth(layout.playbackWidth + 2)
    if (key === 'Home') updateWidth(30)
    if (key === 'End') updateWidth(70)
  }

  const personName = getPersonName(call)
  const companyName = call.review?.crm.company?.name
  const dealName = call.review?.crm.deal?.name

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <nav aria-label="Call context" className="flex flex-wrap items-center gap-2 border-b border-border pb-3 text-xs text-text-muted">
        <span>Calls</span><span aria-hidden>/</span><span className="tabular-nums">{call.toE164}</span>
        {personName && <><span aria-hidden>/</span><span>{personName}</span></>}
        {companyName && <><span aria-hidden>/</span><span>{companyName}</span></>}
        {dealName && <><span aria-hidden>/</span><span>{dealName}</span></>}
      </nav>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2"><Phone size={16} aria-hidden className="text-text-muted" /><h1 className="text-base font-semibold tabular-nums">{call.toE164}</h1></div>
        <div className="flex flex-wrap gap-2" aria-label="Review layout">
          {LAYOUTS.map((option) => <Button key={option.preset} variant="secondary" size="sm" aria-pressed={layout.preset === option.preset} onClick={() => choosePreset(option.preset)}>{option.label}</Button>)}
        </div>
      </div>
      <div className="flex border border-border bg-surface p-1 md:hidden" role="tablist" aria-label="Call review panes">
        <button type="button" role="tab" id="call-review-playback-tab" aria-controls="call-review-playback" aria-selected={activePane === 'playback'} className={cn('h-8 flex-1 rounded-md text-sm font-medium', activePane === 'playback' && 'bg-bg')} onClick={() => setActivePane('playback')}>Playback</button>
        <button type="button" role="tab" id="call-review-comments-tab" aria-controls="call-review-comments" aria-selected={activePane === 'comments'} className={cn('h-8 flex-1 rounded-md text-sm font-medium', activePane === 'comments' && 'bg-bg')} onClick={() => setActivePane('comments')}>Comments</button>
      </div>
      <div ref={workbenchRef} className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-bg md:flex-row">
        <section id="call-review-playback" role="tabpanel" aria-labelledby="call-review-playback-tab" className={cn('min-h-0 flex-col overflow-y-auto md:flex', activePane === 'playback' ? 'flex' : 'hidden')} style={{ flexBasis: `${layout.playbackWidth}%` }}>
          <PlaybackPane
            key={call.id}
            call={call}
            timeZone={timeZone}
            currentTimeMs={currentTimeMs}
            selection={selection}
            seekRequest={seekRequest}
            commentPins={commentPins}
            onTimeChange={setCurrentTimeMs}
            onSelectionChange={setSelection}
            onSeek={requestSeek}
            onCommentSelection={(draft) => {
              setCommentDraft(draft)
              setActivePane('comments')
            }}
            onCommentActivate={activateComment}
          />
        </section>
        <div role="separator" aria-label="Resize playback and comments panes" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={layout.playbackWidth} tabIndex={0} className="hidden w-2 shrink-0 cursor-col-resize border-x border-border bg-surface focus-visible:bg-surface-2 focus-visible:outline-none md:block" onPointerDown={startResize} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resizeWithKeyboard(event.key) } }} />
        <section id="call-review-comments" role="tabpanel" aria-labelledby="call-review-comments-tab" className={cn('min-h-0 flex-1 flex-col overflow-y-auto md:flex', activePane === 'comments' ? 'flex' : 'hidden')}>
          <CallCommentsRail
            orgId={orgId}
            callId={call.id}
            currentUserId={userId}
            timeZone={timeZone}
            currentTimeMs={currentTimeMs}
            draft={commentDraft}
            activeCommentId={activeCommentId}
            nearestCommentId={nearestCommentId}
            onDraftChange={setCommentDraft}
            onActivate={activateComment}
          />
        </section>
      </div>
    </div>
  )
}

function PlaybackPane({
  call,
  timeZone,
  currentTimeMs,
  selection,
  seekRequest,
  commentPins,
  onTimeChange,
  onSelectionChange,
  onSeek,
  onCommentSelection,
  onCommentActivate,
}: {
  call: CallDetail
  timeZone: string | null | undefined
  currentTimeMs: number
  selection: TimedTranscriptSelection | null
  seekRequest: { atMs: number; sequence: number } | null
  commentPins: Array<{ id: string; time: number }>
  onTimeChange: (atMs: number) => void
  onSelectionChange: (selection: TimedTranscriptSelection | null) => void
  onSeek: (atMs: number) => void
  onCommentSelection: (draft: CallCommentDraftAnchor) => void
  onCommentActivate: (commentId: string, atMs: number) => void
}) {
  const [searchTicks, setSearchTicks] = useState<Array<{ id: string; time: number }>>([])
  const review = call.review
  const source = review?.recording.source?.kind === 'audio'
    ? review.recording.source as AudioMediaSource
    : call.recordingUrl ? { kind: 'audio' as const, url: call.recordingUrl, expiresAt: '' } : null
  const transcript = review?.transcript.pass?.plainText ?? (call.transcriptStatus === 'done' ? call.transcript : null)
  const segments = review?.transcript.pass?.segments ?? []
  const speakerKeys = [...new Set([...(review?.speakers ?? []).map((speaker) => speaker.speakerKey), ...segments.map((segment) => segment.speakerKey)])]
  let unknownSpeakerNumber = 1
  const speakerLabels = new Map<string, string>()
  for (const speakerKey of speakerKeys) {
    const speaker = review?.speakers.find((candidate) => candidate.speakerKey === speakerKey)
    const label = getSpeakerLabel(speakerKey, speaker, unknownSpeakerNumber)
    if (label.startsWith('Person ')) unknownSpeakerNumber += 1
    speakerLabels.set(speakerKey, label)
  }
  const ribbonSpeakers: SpeakerRibbonSpeaker[] = speakerKeys.map((speakerKey) => ({ speakerKey, label: speakerLabels.get(speakerKey) ?? speakerKey }))
  const handleTimeChange = useCallback((time: number) => onTimeChange(Math.round(time * 1_000)), [onTimeChange])
  const speakerLabelRecord = Object.fromEntries(speakerLabels)
  const selectionRange = selection ? { start: selection.startMs / 1_000, end: selection.endMs / 1_000 } : null
  return <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Playback</h2></div>
    <section aria-labelledby="recording-title" className="border border-border bg-surface p-3"><h3 id="recording-title" className="text-sm font-semibold">Recording</h3>{source ? <div className="mt-3 flex flex-col gap-3"><AudioPlayer source={source} recordingState={review?.recording.state ?? 'ready'} callLabel={call.toE164} segments={segments} speakers={ribbonSpeakers} selectionRange={selectionRange} searchTicks={searchTicks} commentPins={commentPins} seekRequest={seekRequest} onCommentActivate={onCommentActivate} onTimeChange={handleTimeChange} /><div><Button asChild variant="secondary" size="sm"><a href={source.url} download><Download size={16} aria-hidden />Download</a></Button></div></div> : <p className="mt-3 text-sm text-text-muted">{recordingMessage(call)}</p>}</section>
    <CallFacts call={call} timeZone={timeZone} />
    <section aria-labelledby="transcript-title" className="flex min-h-64 flex-1 flex-col border border-border p-3">
      <div className="flex items-center justify-between gap-2"><h3 id="transcript-title" className="text-sm font-semibold">Transcript</h3>{transcript?.trim() && <CopyTranscriptButton text={transcript} />}</div>
      {selection && review?.transcript.pass?.id && (
        <div className="mt-2 flex items-center justify-between gap-2 border border-primary bg-surface p-2">
          <p className="truncate text-xs text-text-muted">“{selection.quote}”</p>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => onCommentSelection({
              kind: 'selection',
              atMs: selection.atMs,
              anchorEndMs: selection.endMs,
              anchorQuote: selection.quote,
              selectionStartChar: selection.startChar,
              selectionEndChar: selection.endChar,
              transcriptId: review.transcript.pass!.id,
            })}
          >
            <MessageSquarePlus size={16} aria-hidden />
            Comment on selection
          </Button>
        </div>
      )}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{segments.length > 0 ? <TimedTranscript segments={segments} speakerLabels={speakerLabelRecord} currentTimeMs={currentTimeMs} scrollRequest={seekRequest} onSeek={source ? onSeek : undefined} onSearchTicksChange={setSearchTicks} onSelectionChange={onSelectionChange} /> : transcript?.trim() ? <p className="text-sm whitespace-pre-wrap">{transcript}</p> : <p className="text-sm text-text-muted">{transcriptMessage(call)}</p>}</div>
    </section>
  </div>
}

function CallFacts({ call, timeZone }: { call: CallDetail; timeZone: string | null | undefined }) {
  const facts: { label: string; value: string; numeric?: boolean }[] = [
    { label: 'From', value: call.fromE164, numeric: true }, { label: 'To', value: call.toE164, numeric: true }, { label: 'Direction', value: getCallDirectionLabel(call.direction) }, { label: 'Outcome', value: getCallStatusLabel(call.status) }, { label: 'Duration', value: call.durationS === null ? '—' : formatElapsed(call.durationS), numeric: true }, { label: 'Started', value: call.startedAt ? formatDateTime(call.startedAt, timeZone) : '—' }, { label: 'Ended', value: call.endedAt ? formatDateTime(call.endedAt, timeZone) : '—' },
  ]
  return <section aria-label="Call details" className="border border-border bg-surface p-3"><dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{facts.map((fact) => <div key={fact.label} className="flex flex-col gap-1"><dt className="text-xs text-text-muted">{fact.label}</dt><dd className={fact.numeric ? 'text-sm tabular-nums' : 'text-sm'}>{fact.value}</dd></div>)}</dl></section>
}

function CopyTranscriptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy(): Promise<void> { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { toast.error('Could not copy the transcript. Copy it by hand.') } }
  return <Button variant="secondary" size="sm" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}Copy transcript</Button>
}

function transcriptMessage(call: CallDetail): string {
  if (call.review?.transcript.state === 'processing' || call.transcriptStatus === 'pending') return 'Transcribing…'
  if (call.review?.transcript.state === 'failed' || call.transcriptStatus === 'failed') return 'The transcript could not be generated.'
  if (call.review?.transcript.state === 'unavailable-by-consent' || call.transcriptStatus === 'skipped-not-recorded') return 'This call was not recorded, so there is no transcript.'
  return 'No speech was transcribed.'
}

function recordingMessage(call: CallDetail): string {
  switch (call.review?.recording.state) {
    case 'queued': return 'Recording is queued.'
    case 'processing': return 'Recording is processing.'
    case 'failed':
    case 'missing': return 'Recording could not be prepared. Refresh the call and try again.'
    case 'unavailable-by-consent': return 'Recording was unavailable because consent was not granted.'
  }
  switch (call.recordingReason) {
    case 'recording-disabled': return 'Recording was disabled for the organization.'
    case 'state-blocked': return 'Recording was off because the destination is blocked by the organization policy.'
    case 'two-party-consent-state': return 'Recording was off because the destination appeared to be in a two-party-consent state.'
    case 'state-not-allowed': return 'Recording was off because the destination was not in the organization’s allowed states.'
    case 'unknown-destination-state': return 'Recording was off because the destination state could not be determined.'
    default: return 'This call has no recording.'
  }
}
