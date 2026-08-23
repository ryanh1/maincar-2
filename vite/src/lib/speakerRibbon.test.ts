import { describe, expect, it } from 'vitest'

import {
  buildSpeakerRibbonGeometry,
  type SpeakerRibbonMarker,
  type SpeakerRibbonSegment,
} from '@/lib/speakerRibbon'

const SEGMENTS: SpeakerRibbonSegment[] = [
  { speakerKey: 'rep', startMs: 0, endMs: 1_000 },
  { speakerKey: 'buyer', startMs: 800, endMs: 2_000 },
  { speakerKey: 'rep', startMs: 1_900, endMs: 3_000 },
]

describe('buildSpeakerRibbonGeometry', () => {
  it('keeps stable speaker lanes and preserves overlapping speech in separate rectangles', () => {
    const geometry = buildSpeakerRibbonGeometry({
      durationMs: 4_000,
      speakerKeys: ['buyer', 'rep'],
      segments: SEGMENTS,
      currentTimeMs: 2_000,
    })

    expect(geometry.lanes.map((lane) => lane.speakerKey)).toEqual(['buyer', 'rep'])
    expect(geometry.lanes[0]?.segments).toEqual([{ left: 20, width: 30, startMs: 800, endMs: 2_000 }])
    expect(geometry.lanes[1]?.segments).toEqual([
      { left: 0, width: 25, startMs: 0, endMs: 1_000 },
      { left: 47.5, width: 27.5, startMs: 1_900, endMs: 3_000 },
    ])
    expect(geometry.playhead).toBe(50)
  })

  it('clamps long-call ranges and all marker types to the call duration', () => {
    const markers: SpeakerRibbonMarker[] = [
      { id: 'search-before', timeMs: -1, kind: 'search' },
      { id: 'search-middle', timeMs: 5_000, kind: 'search' },
      { id: 'comment-after', timeMs: 12_000, kind: 'comment' },
    ]
    const geometry = buildSpeakerRibbonGeometry({
      durationMs: 10_000,
      segments: [{ speakerKey: 'buyer', startMs: -500, endMs: 12_000 }],
      bufferedRanges: [{ startMs: -100, endMs: 8_000 }, { startMs: 8_000, endMs: 12_000 }],
      playedRanges: [{ startMs: 0, endMs: 5_000 }],
      selectionRange: { startMs: 2_000, endMs: 12_000 },
      markers,
      currentTimeMs: 20_000,
    })

    expect(geometry.lanes[0]?.segments).toEqual([{ left: 0, width: 100, startMs: 0, endMs: 10_000 }])
    expect(geometry.bufferedRanges).toEqual([
      { left: 0, width: 80, startMs: 0, endMs: 8_000 },
      { left: 80, width: 20, startMs: 8_000, endMs: 10_000 },
    ])
    expect(geometry.playedRanges).toEqual([{ left: 0, width: 50, startMs: 0, endMs: 5_000 }])
    expect(geometry.selectionRange).toEqual({ left: 20, width: 80, startMs: 2_000, endMs: 10_000 })
    expect(geometry.markers).toEqual([
      { id: 'search-before', kind: 'search', left: 0, timeMs: 0 },
      { id: 'search-middle', kind: 'search', left: 50, timeMs: 5_000 },
      { id: 'comment-after', kind: 'comment', left: 100, timeMs: 10_000 },
    ])
    expect(geometry.playhead).toBe(100)
  })

  it('returns an empty, safe geometry for silence or an unknown duration', () => {
    expect(buildSpeakerRibbonGeometry({ durationMs: 0, segments: SEGMENTS, currentTimeMs: 2_000 })).toEqual({
      durationMs: 0,
      lanes: [],
      bufferedRanges: [],
      playedRanges: [],
      selectionRange: null,
      markers: [],
      playhead: 0,
    })
    expect(buildSpeakerRibbonGeometry({ durationMs: Number.NaN, segments: SEGMENTS, currentTimeMs: 2_000 }).durationMs).toBe(0)
  })
})
