import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TimedTranscript_Segment } from '@/components/call-review/TimedTranscript_Segment'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import type { SpeakerRibbonSearchTick } from '@/components/call-review/SpeakerRibbon'
import type { TimedTranscriptSegment } from '@/lib/callTypes'
import {
  buildTimedTranscriptModel,
  findTimedTranscriptMatches,
  selectionToTimedRange,
  type TimedTranscriptSelection,
} from '@/lib/timedTranscript'

export type { TimedTranscriptSelection } from '@/lib/timedTranscript'

export interface TimedTranscriptProps {
  segments: readonly TimedTranscriptSegment[]
  speakerLabels: Readonly<Record<string, string>>
  currentTimeMs: number
  onSeek: (atMs: number) => void
  onSearchTicksChange: (ticks: SpeakerRibbonSearchTick[]) => void
  onSelectionChange: (selection: TimedTranscriptSelection | null) => void
}

const MANUAL_SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])

/** Searchable, selectable transcript synchronized to one durable millisecond timeline. */
export function TimedTranscript({ segments, speakerLabels, currentTimeMs, onSeek, onSearchTicksChange, onSelectionChange }: TimedTranscriptProps) {
  const [query, setQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const [following, setFollowing] = useState(true)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const model = useMemo(() => buildTimedTranscriptModel(segments), [segments])
  const matches = useMemo(() => findTimedTranscriptMatches(model, query), [model, query])
  const activeMatch = matches[activeMatchIndex] ?? null
  const speakerKeys = useMemo(() => [...new Set(segments.map((segment) => segment.speakerKey))], [segments])
  const activeSegmentId = segments.find((segment) => currentTimeMs >= segment.startMs && currentTimeMs < segment.endMs)?.id ?? null

  const scrollToCurrent = useCallback(() => {
    if (!activeSegmentId) return
    contentRef.current?.querySelector<HTMLElement>(`[data-testid="transcript-segment-${activeSegmentId}"]`)?.scrollIntoView({ block: 'center' })
  }, [activeSegmentId])

  useEffect(() => {
    if (following) scrollToCurrent()
  }, [following, scrollToCurrent])

  useEffect(() => {
    onSearchTicksChange(matches.map((match) => ({ id: match.id, time: match.startMs / 1_000 })))
  }, [matches, onSearchTicksChange])

  function navigateMatches(direction: -1 | 1): void {
    if (matches.length === 0) return
    const nextIndex = (activeMatchIndex + direction + matches.length) % matches.length
    const match = matches[nextIndex]
    if (!match) return
    setActiveMatchIndex(nextIndex)
    onSeek(match.startMs)
    const target = [...(contentRef.current?.querySelectorAll<HTMLElement>('[data-search-match-id]') ?? [])]
      .find((element) => element.dataset.searchMatchId === match.id)
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  }

  function emitSelection(): void {
    const content = contentRef.current
    if (!content) return
    onSelectionChange(selectionToTimedRange(model, content, window.getSelection()))
  }

  function pauseFollow(): void {
    setFollowing(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="search" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search transcript"
          placeholder="Search transcript"
          value={query}
          className="h-8 min-w-48 flex-1 text-sm"
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveMatchIndex(0)
          }}
        />
        <IconButton tooltip="Previous transcript match" size="sm" onClick={() => navigateMatches(-1)} disabled={matches.length === 0}>
          <ChevronUp size={16} aria-hidden />
        </IconButton>
        <IconButton tooltip="Next transcript match" size="sm" onClick={() => navigateMatches(1)} disabled={matches.length === 0}>
          <ChevronDown size={16} aria-hidden />
        </IconButton>
        <span aria-live="polite" className="min-w-12 text-xs tabular-nums text-text-muted">
          {matches.length > 0 ? `${activeMatchIndex + 1} of ${matches.length}` : query.trim() ? 'No matches' : ''}
        </span>
        {!following && <Button variant="secondary" size="sm" onClick={() => setFollowing(true)}>Jump to current</Button>}
      </div>
      <div
        ref={scrollRootRef}
        role="region"
        aria-label="Timed transcript"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto border border-border bg-bg outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
        onWheel={pauseFollow}
        onTouchMove={pauseFollow}
        onPointerDown={(event) => { if (event.target === event.currentTarget) pauseFollow() }}
        onKeyDown={(event) => { if (event.target === event.currentTarget && MANUAL_SCROLL_KEYS.has(event.key)) pauseFollow() }}
      >
        <div ref={contentRef} data-testid="timed-transcript-content" className="p-2" onMouseUp={emitSelection} onKeyUp={emitSelection}>
          {model.segments.map((segment) => (
            <TimedTranscript_Segment
              key={segment.source.id}
              segment={segment}
              speakerLabel={speakerLabels[segment.source.speakerKey] ?? segment.source.speakerKey}
              speakerKeys={speakerKeys}
              currentTimeMs={currentTimeMs}
              matches={matches}
              activeMatchId={activeMatch?.id ?? null}
              onSeek={onSeek}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
