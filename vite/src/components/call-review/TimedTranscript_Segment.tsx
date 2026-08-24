import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { formatElapsed } from '@/lib/duration'
import { getSpeakerColorToken } from '@/lib/speakerRibbon'
import type { TimedTranscriptMatch, TimedTranscriptModelSegment, TimedTranscriptPiece } from '@/lib/timedTranscript'
import { resolveOptionColor } from '@/lib/optionPalette'
import { cn } from '@/lib/utils'

interface Props {
  segment: TimedTranscriptModelSegment
  speakerLabel: string
  speakerKeys: readonly string[]
  currentTimeMs: number
  matches: readonly TimedTranscriptMatch[]
  activeMatchId: string | null
  onSeek?: (atMs: number) => void
}

function matchingRanges(piece: TimedTranscriptPiece, matches: readonly TimedTranscriptMatch[]) {
  return matches
    .filter((match) => match.endChar > piece.charStart && match.startChar < piece.charEnd)
    .map((match) => ({
      match,
      start: Math.max(piece.charStart, match.startChar) - piece.charStart,
      end: Math.min(piece.charEnd, match.endChar) - piece.charStart,
    }))
}

function PieceText({ piece, matches, activeMatchId }: { piece: TimedTranscriptPiece; matches: readonly TimedTranscriptMatch[]; activeMatchId: string | null }) {
  const ranges = matchingRanges(piece, matches)
  if (ranges.length === 0) return <>{piece.text}</>
  const content = []
  let cursor = 0
  for (const { match, start, end } of ranges) {
    if (start > cursor) content.push(piece.text.slice(cursor, start))
    content.push(
      <mark
        key={`${match.id}-${start}`}
        data-search-match-id={match.id}
        tabIndex={-1}
        className={cn('bg-primary/10 text-text', activeMatchId === match.id && 'bg-primary/20')}
      >
        {piece.text.slice(start, end)}
      </mark>,
    )
    cursor = end
  }
  if (cursor < piece.text.length) content.push(piece.text.slice(cursor))
  return <>{content}</>
}

export function TimedTranscript_Segment({ segment, speakerLabel, speakerKeys, currentTimeMs, matches, activeMatchId, onSeek }: Props) {
  const [visibleWordTime, setVisibleWordTime] = useState<string | null>(null)
  const isCurrent = currentTimeMs >= segment.source.startMs && currentTimeMs < segment.source.endMs
  return (
    <article
      data-testid={`transcript-segment-${segment.source.id}`}
      data-current={isCurrent ? 'true' : undefined}
      className={cn('border-l-2 border-transparent py-2 pl-3', isCurrent && 'border-primary bg-surface')}
    >
      <header className="mb-1 flex items-center gap-2 select-none">
        <Button variant="ghost" size="sm" className="px-1 text-xs tabular-nums text-text-muted" disabled={!onSeek} onClick={() => onSeek?.(segment.source.startMs)}>
          {formatElapsed(segment.source.startMs / 1_000)}
        </Button>
        <span className="text-xs font-medium" style={{ color: resolveOptionColor(getSpeakerColorToken(segment.source.speakerKey, speakerKeys)) }}>
          {speakerLabel}
        </span>
      </header>
      <p className="flex flex-wrap items-baseline text-sm">
        {segment.pieces.map((piece) => {
          const data = {
            'data-transcript-piece': true,
            'data-char-start': piece.charStart,
            'data-char-end': piece.charEnd,
          }
          if (!piece.word) return <span key={piece.id} {...data}>{piece.text}</span>
          const timeLabel = formatElapsed(piece.word.startMs / 1_000)
          const currentWord = currentTimeMs >= piece.word.startMs && currentTimeMs < piece.word.endMs
          return (
            <Button
              key={piece.id}
              variant="ghost"
              size="sm"
              aria-label={`${piece.word.word}, ${timeLabel}`}
              aria-current={currentWord ? 'true' : undefined}
              disabled={!onSeek}
              className={cn('relative h-8 px-1 text-sm font-normal', currentWord && 'border-primary bg-primary/10')}
              onClick={() => onSeek?.(piece.word?.startMs ?? 0)}
              onPointerEnter={() => setVisibleWordTime(piece.id)}
              onPointerLeave={() => setVisibleWordTime((current) => current === piece.id ? null : current)}
              onFocus={() => setVisibleWordTime(piece.id)}
              onBlur={() => setVisibleWordTime((current) => current === piece.id ? null : current)}
            >
              <span {...data}><PieceText piece={piece} matches={matches} activeMatchId={activeMatchId} /></span>
              {visibleWordTime === piece.id && <span data-word-time className="absolute bottom-full left-0 z-20 mb-1 border border-border bg-surface px-1 text-xs tabular-nums text-text">{timeLabel}</span>}
            </Button>
          )
        })}
      </p>
    </article>
  )
}
