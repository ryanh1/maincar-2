import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountTimelineRoot } from '@/lib/accountTimelineTypes'
import {
  ACCOUNT_TIMELINE_RANGE_PREFERENCE_TTL_MS,
  useAccountTimelineRangePreference,
} from '../useAccountTimelineRangePreference'

const companyRoot: AccountTimelineRoot = { type: 'company', id: 'company-1' }
const dealRoot: AccountTimelineRoot = { type: 'deal', id: 'deal-1' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-22T12:00:00.000Z'))
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAccountTimelineRangePreference', () => {
  it('stores an override by organization and root scope', () => {
    const { result } = renderHook(() => useAccountTimelineRangePreference('org-1', companyRoot))

    act(() => {
      result.current.setRange({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' })
    })

    expect(result.current.range).toEqual({
      occurredFrom: '2026-08-01T00:00:00.000Z',
      occurredTo: '2026-09-01T00:00:00.000Z',
    })
    expect(result.current.hasOverride).toBe(true)
  })

  it('does not share an organization override with another root scope', () => {
    const company = renderHook(() => useAccountTimelineRangePreference('org-1', companyRoot))
    const deal = renderHook(() => useAccountTimelineRangePreference('org-1', dealRoot))

    act(() => {
      company.result.current.setRange({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' })
    })

    expect(company.result.current.hasOverride).toBe(true)
    expect(deal.result.current.range).toBeNull()
  })

  it('drops a malformed stored override rather than sending an invalid range to the reader', () => {
    sessionStorage.setItem(
      'account-timeline-range:org-1:company:company-1',
      JSON.stringify({ from: 'not-a-date', to: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-01T00:00:00.000Z' }),
    )

    const { result } = renderHook(() => useAccountTimelineRangePreference('org-1', companyRoot))

    expect(result.current.range).toBeNull()
    expect(sessionStorage.getItem('account-timeline-range:org-1:company:company-1')).toBeNull()
  })

  it('expires an override after 30 days and clears it so the next query uses the server default', () => {
    const { result, rerender } = renderHook(() => useAccountTimelineRangePreference('org-1', companyRoot))

    act(() => {
      result.current.setRange({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' })
      vi.advanceTimersByTime(ACCOUNT_TIMELINE_RANGE_PREFERENCE_TTL_MS + 1)
    })
    rerender()

    expect(result.current.range).toBeNull()
    expect(result.current.hasOverride).toBe(false)
  })

  it('resets the range to let the server resolve a fresh default', () => {
    const { result } = renderHook(() => useAccountTimelineRangePreference('org-1', companyRoot))

    act(() => {
      result.current.setRange({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' })
    })
    act(() => {
      result.current.reset()
    })

    expect(result.current.range).toBeNull()
    expect(result.current.hasOverride).toBe(false)
  })
})
