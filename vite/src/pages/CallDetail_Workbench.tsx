import { useRef, useState, type PointerEvent } from 'react'
import { Check, Copy, Download, Phone } from 'lucide-react'
import { toast } from 'sonner'

import { AudioPlayer, type AudioMediaSource } from '@/components/call-review/AudioPlayer'
import { Button } from '@/components/ui/button'
import type { CallDetail } from '@/hooks/dialer'
import { getCallDirectionLabel, getCallStatusLabel } from '@/lib/callLabels'
import { formatDateTime } from '@/lib/datetime'
import { formatElapsed } from '@/lib/duration'
import { getStoredCallReviewLayout, saveCallReviewLayout, type CallReviewLayout, type CallReviewLayoutPreset } from '@/lib/callReviewLayout'
import { cn } from '@/lib/utils'

type Pane = 'playback' | 'comments'

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

/** The call-review frame keeps both panes mounted across responsive navigation. */
export function CallDetail_Workbench({ call, timeZone, userId }: { call: CallDetail; timeZone: string | null | undefined; userId: string | null | undefined }) {
  const [layout, setLayout] = useState<CallReviewLayout>(() => getStoredCallReviewLayout(userId))
  const [activePane, setActivePane] = useState<Pane>('playback')
  const workbenchRef = useRef<HTMLDivElement>(null)

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
        <section id="call-review-playback" role="tabpanel" aria-labelledby="call-review-playback-tab" className={cn('min-h-0 flex-col overflow-y-auto md:flex', activePane === 'playback' ? 'flex' : 'hidden')} style={{ flexBasis: `${layout.playbackWidth}%` }}><PlaybackPane call={call} timeZone={timeZone} /></section>
        <div role="separator" aria-label="Resize playback and comments panes" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={layout.playbackWidth} tabIndex={0} className="hidden w-2 shrink-0 cursor-col-resize border-x border-border bg-surface focus-visible:bg-surface-2 focus-visible:outline-none md:block" onPointerDown={startResize} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resizeWithKeyboard(event.key) } }} />
        <section id="call-review-comments" role="tabpanel" aria-labelledby="call-review-comments-tab" className={cn('min-h-0 flex-1 flex-col overflow-y-auto md:flex', activePane === 'comments' ? 'flex' : 'hidden')}><CommentsPane /></section>
      </div>
    </div>
  )
}

function PlaybackPane({ call, timeZone }: { call: CallDetail; timeZone: string | null | undefined }) {
  const review = call.review
  const source = review?.recording.source?.kind === 'audio'
    ? review.recording.source as AudioMediaSource
    : call.recordingUrl ? { kind: 'audio' as const, url: call.recordingUrl, expiresAt: '' } : null
  const transcript = review?.transcript.pass?.plainText ?? (call.transcriptStatus === 'done' ? call.transcript : null)
  const segments = review?.transcript.pass?.segments ?? []
  return <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Playback</h2></div>
    <section aria-labelledby="recording-title" className="border border-border bg-surface p-3"><h3 id="recording-title" className="text-sm font-semibold">Recording</h3>{source ? <div className="mt-3 flex flex-col gap-3"><AudioPlayer source={source} recordingState={review?.recording.state ?? 'ready'} callLabel={call.toE164} /><div><Button asChild variant="secondary" size="sm"><a href={source.url} download><Download size={16} aria-hidden />Download</a></Button></div></div> : <p className="mt-3 text-sm text-text-muted">{recordingMessage(call)}</p>}</section>
    <CallFacts call={call} timeZone={timeZone} />
    <section aria-labelledby="transcript-title" className="min-h-0 flex-1 border border-border p-3"><div className="flex items-center justify-between gap-2"><h3 id="transcript-title" className="text-sm font-semibold">Transcript</h3>{transcript?.trim() && <CopyTranscriptButton text={transcript} />}</div><div className="mt-3 flex flex-col gap-3">{segments.length > 0 ? segments.map((segment) => <p key={segment.id} className="text-sm whitespace-pre-wrap"><span className="mr-2 text-xs text-text-muted tabular-nums">{formatElapsed(segment.startMs / 1000)}</span>{segment.text}</p>) : transcript?.trim() ? <p className="text-sm whitespace-pre-wrap">{transcript}</p> : <p className="text-sm text-text-muted">{transcriptMessage(call)}</p>}</div></section>
  </div>
}

function CommentsPane() { return <div className="flex min-h-0 flex-1 flex-col gap-3 p-4"><h2 className="text-sm font-semibold">Comments</h2><div className="border border-border bg-surface p-3"><p className="text-sm text-text-muted">Comments will appear here.</p></div></div> }

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
    case 'two-party-consent-state': return 'Recording was off because the destination appeared to be in a two-party-consent state.'
    case 'state-not-allowed': return 'Recording was off because the destination was not in the organization’s allowed states.'
    case 'unknown-destination-state': return 'Recording was off because the destination state could not be determined.'
    default: return 'This call has no recording.'
  }
}
