import { describe, expect, it } from 'vitest'

import { resolveSmartTimelineRange } from '../accountTimeline.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')

describe('resolveSmartTimelineRange', () => {
  it('snaps an open deal through its far-future scheduled activity to the smallest containing preset', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2026-07-01T00:00:00.000Z'),
      activeDealCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      farthestScheduledAt: new Date('2026-09-20T00:00:00.000Z'),
      recentEventOccurredAt: [],
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-09-21T00:00:00.000Z'),
    })
  })

  it('keeps an open deal visible through the two-week minimum future edge', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      activeDealCreatedAt: new Date('2026-08-10T00:00:00.000Z'),
      farthestScheduledAt: null,
      recentEventOccurredAt: [],
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2026-08-06T12:00:00.000Z'),
      to: new Date('2026-09-05T12:00:00.000Z'),
    })
  })

  it('chooses the shortest dense preset for an account with no open deal', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      activeDealCreatedAt: null,
      farthestScheduledAt: null,
      recentEventOccurredAt: Array.from({ length: 10 }, () => new Date('2026-08-21T12:00:00.000Z')),
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2026-08-15T12:00:00.000Z'),
      to: NOW,
    })
  })

  it.each([
    ['month', '2026-08-10T12:00:00.000Z', '2026-07-23T12:00:00.000Z'],
    ['quarter', '2026-06-01T12:00:00.000Z', '2026-05-24T12:00:00.000Z'],
    ['year', '2025-09-01T12:00:00.000Z', '2025-08-22T12:00:00.000Z'],
  ])('chooses the %s preset only after shorter windows are not dense', (_preset, occurredAt, from) => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      activeDealCreatedAt: null,
      farthestScheduledAt: null,
      recentEventOccurredAt: Array.from({ length: 10 }, () => new Date(occurredAt)),
      now: NOW,
    })

    expect(range).toEqual({ from: new Date(from), to: NOW })
  })

  it('extends a no-deal dense window through a scheduled activity without widening its left edge', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      activeDealCreatedAt: null,
      farthestScheduledAt: new Date('2026-08-30T09:00:00.000Z'),
      recentEventOccurredAt: Array.from({ length: 10 }, () => new Date('2026-08-21T12:00:00.000Z')),
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2026-08-15T12:00:00.000Z'),
      to: new Date('2026-08-31T09:00:00.000Z'),
    })
  })

  it('falls back to all time for a sparse account and clamps every range to account creation', () => {
    const range = resolveSmartTimelineRange({
      accountCreatedAt: new Date('2022-03-04T08:00:00.000Z'),
      activeDealCreatedAt: null,
      farthestScheduledAt: null,
      recentEventOccurredAt: [
        new Date('2026-08-21T08:00:00.000Z'),
        new Date('2026-08-20T08:00:00.000Z'),
        new Date('2026-08-19T08:00:00.000Z'),
      ],
      now: NOW,
    })

    expect(range).toEqual({
      from: new Date('2022-03-04T08:00:00.000Z'),
      to: NOW,
    })
  })
})
