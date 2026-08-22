import { describe, expect, it } from 'vitest'

import { resolveSmartTimelineRange } from '../accountTimeline.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')

describe('resolveSmartTimelineRange', () => {
  it('keeps an open deal’s creation context and even a far-future commitment in frame', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2024-01-10T00:00:00.000Z'),
      activeDealCreatedAt: new Date('2026-06-01T00:00:00.000Z'),
      farthestCommitmentAt: new Date('2027-12-15T00:00:00.000Z'),
      recentEventCount: 40,
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2026-05-24T12:00:00.000Z'),
      to: new Date('2027-12-16T00:00:00.000Z'),
    })
  })

  it('shows a compact recent frame for a dense account with no open deal', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      activeDealCreatedAt: null,
      farthestCommitmentAt: null,
      recentEventCount: 12,
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2026-07-23T12:00:00.000Z'),
      to: new Date('2026-08-29T12:00:00.000Z'),
    })
  })

  it('keeps account creation visible when the history is sparse', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2022-03-04T08:00:00.000Z'),
      activeDealCreatedAt: null,
      farthestCommitmentAt: null,
      recentEventCount: 3,
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2022-03-04T08:00:00.000Z'),
      to: new Date('2026-08-29T12:00:00.000Z'),
    })
  })
})
