import { act, renderHook } from '@testing-library/react'

import type { AccountTimelineRoot } from '@/lib/accountTimelineTypes'
import { useAccountTimelineFilterPreference } from '../useAccountTimelineFilterPreference'

const companyRoot: AccountTimelineRoot = { type: 'company', id: 'company-1' }
const otherCompanyRoot: AccountTimelineRoot = { type: 'company', id: 'company-2' }
const dealRoot: AccountTimelineRoot = { type: 'deal', id: 'deal-1' }

beforeEach(() => {
  sessionStorage.clear()
})

describe('useAccountTimelineFilterPreference', () => {
  it('remembers filters for only the selected account', () => {
    const company = renderHook(() => useAccountTimelineFilterPreference('org-1', companyRoot))
    act(() => company.result.current.setFilters({ sourceType: 'call', personId: 'person-1', dealId: 'deal-1', mine: true }))

    expect(company.result.current.filters).toEqual({ sourceType: 'call', personId: 'person-1', dealId: 'deal-1', mine: true })

    const otherCompany = renderHook(() => useAccountTimelineFilterPreference('org-1', otherCompanyRoot))
    expect(otherCompany.result.current.filters).toEqual({})
  })

  it('never restores company-only filters on a deal timeline', () => {
    sessionStorage.setItem(
      'account-timeline-filters:org-1:deal:deal-1',
      JSON.stringify({ sourceType: 'email', personId: 'person-1', dealId: 'deal-2', mine: true }),
    )

    const { result } = renderHook(() => useAccountTimelineFilterPreference('org-1', dealRoot))
    expect(result.current.filters).toEqual({ sourceType: 'email', mine: true })
  })

  it('drops malformed preferences and removes storage when every filter is cleared', () => {
    const key = 'account-timeline-filters:org-1:company:company-1'
    sessionStorage.setItem(key, '{not json')
    const { result } = renderHook(() => useAccountTimelineFilterPreference('org-1', companyRoot))
    expect(result.current.filters).toEqual({})
    expect(sessionStorage.getItem(key)).toBeNull()

    act(() => result.current.setFilters({ sourceType: 'task' }))
    expect(sessionStorage.getItem(key)).toContain('task')
    act(() => result.current.setFilters({}))
    expect(sessionStorage.getItem(key)).toBeNull()
  })
})
