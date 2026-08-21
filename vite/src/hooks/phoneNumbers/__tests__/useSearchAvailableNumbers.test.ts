import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useSearchAvailableNumbers } from '../useSearchAvailableNumbers'

// Only the transport is mocked. The hook's job is the URL, the method, the body,
// and returning the results untouched.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderSearch(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useSearchAvailableNumbers(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useSearchAvailableNumbers', () => {
  it('POSTs the criteria to the org-scoped search path, orgId in the path only', async () => {
    jsonFetch.mockResolvedValue({
      numbers: [{ e164: '+14155550123', friendly: '(415) 555-0123', priceMonthly: '1.15' }],
      total: 1,
      priceUnit: 'USD',
    })

    const { result } = renderSearch()
    result.current.mutate({ orgId: 'org-1', country: 'US', areaCode: '415', limit: 20 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/phone-numbers/search', {
      method: 'POST',
      body: JSON.stringify({ country: 'US', areaCode: '415', limit: 20 }),
    })
  })

  it('returns the numbers and the currency the prices are in', async () => {
    jsonFetch.mockResolvedValue({
      numbers: [{ e164: '+14155550123', friendly: '(415) 555-0123', priceMonthly: '1.15' }],
      total: 1,
      priceUnit: 'USD',
    })

    const { result } = renderSearch()
    result.current.mutate({ orgId: 'org-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.priceUnit).toBe('USD')
    expect(result.current.data?.numbers[0].priceMonthly).toBe('1.15')
  })

  it('surfaces the server own message when the search is refused', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('Twilio does not sell phone numbers in ZZ.', 400),
    )

    const { result } = renderSearch()
    result.current.mutate({ orgId: 'org-1', country: 'ZZ' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'Twilio does not sell phone numbers in ZZ.',
    )
    expect((result.current.error as ApiError).status).toBe(400)
  })
})
