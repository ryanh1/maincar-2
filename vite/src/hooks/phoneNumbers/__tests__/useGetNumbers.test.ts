import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { GetPhoneNumbersParams, PhoneNumber } from '@/lib/phoneNumberTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetNumbers } from '../useGetNumbers'

// Only the transport is mocked. The hook's job is the URL it builds, the key it
// caches under, and the enabled gate.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function number(id: string, active: boolean): PhoneNumber {
  return {
    id,
    e164: '+12025550123',
    twilioSid: active ? 'PN123' : null,
    status: active ? 'active' : 'searching',
    isActiveForOutbound: active,
    createdAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderGetNumbers(
  orgId: string | null | undefined,
  params?: GetPhoneNumbersParams,
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetNumbers(orgId, params), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetNumbers', () => {
  it('reads the org-scoped path and returns the numbers with the totals', async () => {
    jsonFetch.mockResolvedValue({
      numbers: [number('pn-1', true), number('pn-2', false)],
      total: 2,
      activeCount: 1,
    })

    const { result } = renderGetNumbers('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/phone-numbers')
    expect(result.current.data?.total).toBe(2)
    expect(result.current.data?.activeCount).toBe(1)
    expect(result.current.data?.numbers[0].id).toBe('pn-1')
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetNumbers(null)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized key, so an invalidation reaches it', async () => {
    jsonFetch.mockResolvedValue({ numbers: [], total: 0, activeCount: 0 })

    const { client, result } = renderGetNumbers('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.phoneNumbers.list('org-1'))).toBeDefined()
  })

  it('uses the server table query for a filtered page', async () => {
    jsonFetch.mockResolvedValue({ numbers: [], total: 30, activeCount: 1, readyCount: 4, page: 2, limit: 25 })

    const { result } = renderGetNumbers('org-1', {
      page: 2,
      limit: 25,
      sort: 'e164',
      dir: 'asc',
      q: '202',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/orgs/org-1/phone-numbers?page=2&limit=25&sort=e164&dir=asc&q=202',
    )
  })

  it('surfaces the server own message when the read fails', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetNumbers('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
