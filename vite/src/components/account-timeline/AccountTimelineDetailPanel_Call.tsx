import { useMemo, useState } from 'react'

import { AudioPlayer } from '@/components/call-review/AudioPlayer'
import { TimedTranscript } from '@/components/call-review/TimedTranscript'
import type { SpeakerRibbonSearchTick } from '@/components/call-review/SpeakerRibbon'
import { Button } from '@/components/ui/button'
import { useGetCallDetail } from '@/hooks/dialer'
import type { AccountTimelineCallDetail } from '@/lib/accountTimelineTypes'

function assetMessage(state: string | undefined, noun: 'recording' | 'transcript'): string {
  if (state === 'queued') return `${noun === 'recording' ? 'Recording' : 'Transcript'} is queued.`
  if (state === 'processing') return `${noun === 'recording' ? 'Recording' : 'Transcript'} is processing.`
  if (state === 'failed' || state === 'missing') return `${noun === 'recording' ? 'Recording' : 'Transcript'} is unavailable.`
  if (state === 'unavailable-by-consent') return `${noun === 'recording' ? 'Recording' : 'Transcript'} is unavailable because consent was not granted.`
  return `${noun === 'recording' ? 'Recording' : 'Transcript'} is not available.`
}

export function AccountTimelineDetailPanel_Call({ detail, orgId }: { detail: AccountTimelineCallDetail; orgId?: string | null }) {
  const query = useGetCallDetail(orgId, detail.id)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [searchTicks, setSearchTicks] = useState<SpeakerRibbonSearchTick[]>([])
  const [seekRequest, setSeekRequest] = useState<{ atMs: number; sequence: number } | null>(null)
  const call = query.data?.call
  const review = call?.review
  const source = review?.recording.source
  const transcript = review?.transcript.pass
  const segments = transcript?.segments ?? []
  const speakers = useMemo(
    () => (review?.speakers ?? []).map((speaker) => ({
      speakerKey: speaker.speakerKey,
      label: speaker.displayName || speaker.person?.preferredFirstName || speaker.person?.firstName || speaker.speakerKey,
    })),
    [review?.speakers],
  )
  const speakerLabels = useMemo(
    () => Object.fromEntries(speakers.map((speaker) => [speaker.speakerKey, speaker.label])),
    [speakers],
  )
  const fallbackCallPath = `/calls/${encodeURIComponent(detail.id)}`
  const openFullCallPath = detail.openFullCallPath?.startsWith('/calls/') ? detail.openFullCallPath : fallbackCallPath

  function requestSeek(atMs: number): void {
    setSeekRequest((current) => ({ atMs, sequence: (current?.sequence ?? 0) + 1 }))
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 text-sm">
      {query.isPending && <p className="text-text-muted">Loading call review…</p>}
      {query.isError && <p className="text-danger">Could not load the call review. Try again.</p>}
      {call && (
        <>
          <section aria-labelledby="timeline-call-recording" className="flex flex-col gap-3 border border-border bg-surface p-3">
            <h3 id="timeline-call-recording" className="text-sm font-semibold">Recording</h3>
            {source?.kind === 'audio' ? (
              <AudioPlayer
                source={{ ...source, kind: 'audio' }}
                recordingState={review?.recording.state ?? 'ready'}
                callLabel={call.toE164}
                segments={segments}
                speakers={speakers}
                searchTicks={searchTicks}
                seekRequest={seekRequest}
                onTimeChange={(seconds) => setCurrentTimeMs(seconds * 1_000)}
              />
            ) : <p className="text-sm text-text-muted">{assetMessage(review?.recording.state, 'recording')}</p>}
          </section>

          <section aria-labelledby="timeline-call-transcript" className="flex min-h-64 flex-col gap-3 border border-border p-3">
            <h3 id="timeline-call-transcript" className="text-sm font-semibold">Transcript</h3>
            {segments.length > 0 ? (
              <TimedTranscript
                segments={segments}
                speakerLabels={speakerLabels}
                currentTimeMs={currentTimeMs}
                onSeek={source?.kind === 'audio' ? requestSeek : undefined}
                onSearchTicksChange={setSearchTicks}
                onSelectionChange={() => undefined}
              />
            ) : transcript?.plainText || call.transcript || detail.transcript ? (
              <p className="whitespace-pre-wrap text-text">{transcript?.plainText || call.transcript || detail.transcript}</p>
            ) : <p className="text-text-muted">{assetMessage(review?.transcript.state, 'transcript')}</p>}
          </section>
        </>
      )}
      {!call && detail.transcript && (
        <section aria-labelledby="timeline-call-fallback-transcript" className="flex flex-col gap-2 border border-border p-3">
          <h3 id="timeline-call-fallback-transcript" className="text-sm font-semibold">Transcript</h3>
          <p className="whitespace-pre-wrap text-text">{detail.transcript}</p>
        </section>
      )}
      <div><Button asChild type="button" size="sm" variant="secondary"><a href={openFullCallPath}>Open full call</a></Button></div>
    </div>
  )
}
