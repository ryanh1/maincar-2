import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetAccountTimeline } from '../useGetAccountTimeline'
import type { AccountTimelineParams, AccountTimelineRoot } from '../useGetAccountTimeline'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

const companyRoot: AccountTimelineRoot = { type: 'company', id: 'company-1' }

function renderGetAccountTimeline(
  orgId: string | null | undefined,
  root: AccountTimelineRoot | null,
  params: AccountTimelineParams = {},
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetAccountTimeline(orgId, root, params), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetAccountTimeline', () => {
  it('reads the first account-timeline page with its required root scope', async () => {
    jsonFetch.mockResolvedValue({
      events: [{ id: 'event-1' }],
      nextCursor: null,
      range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z', isDefault: true },
    })

    const { result } = renderGetAccountTimeline('org-1', companyRoot)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/orgs/org-1/account-timeline?rootType=company&rootId=company-1',
    )
    expect(result.current.data?.pages[0].events).toEqual([{ id: 'event-1' }])
  })

  it('sends an explicit range and filters with the account scope', async () => {
    jsonFetch.mockResolvedValue({ events: [], nextCursor: null, range: { from: 'x', to: 'y', isDefault: false } })

    const params: AccountTimelineParams = {
      occurredFrom: '2026-08-01T00:00:00.000Z',
      occurredTo: '2026-09-01T00:00:00.000Z',
      sourceType: 'call',
      direction: 'outbound',
      personId: 'person-1',
      dealId: 'deal-1',
      mine: true,
      limit: 25,
    }
    const { result } = renderGetAccountTimeline('org-1', companyRoot, params)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/orgs/org-1/account-timeline?rootType=company&rootId=company-1&occurredFrom=2026-08-01T00%3A00%3A00.000Z&occurredTo=2026-09-01T00%3A00%3A00.000Z&limit=25&sourceType=call&direction=outbound&personId=person-1&dealId=deal-1&mine=true',
    )
  })

  it('uses the server cursor for the next page without losing the owner filter', async () => {
    jsonFetch
      .mockResolvedValueOnce({ events: [{ id: 'event-1' }], nextCursor: 'cursor-1', range: { from: 'x', to: 'y', isDefault: true } })
      .mockResolvedValueOnce({ events: [{ id: 'event-2' }], nextCursor: null, range: { from: 'x', to: 'y', isDefault: true } })

    const { client, result } = renderGetAccountTimeline('org-1', companyRoot, { mine: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await result.current.fetchNextPage()

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(jsonFetch).toHaveBeenLastCalledWith(
      '/api/orgs/org-1/account-timeline?rootType=company&rootId=company-1&mine=true&cursor=cursor-1',
    )
    expect(client.getQueryData(queryKeys.accountTimeline.list('org-1', companyRoot, { mine: true }))).toBeDefined()
  })

  it('does not request a timeline before both its organization and root scope are known', async () => {
    const { result } = renderGetAccountTimeline('org-1', null)

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('reports an explicit empty state after an empty page loads', async () => {
    jsonFetch.mockResolvedValue({
      events: [],
      nextCursor: null,
      range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z', isDefault: true },
    })

    const { result } = renderGetAccountTimeline('org-1', companyRoot)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.state).toBe('empty')
    expect(result.current.events).toEqual([])
  })

  it('preserves the server error for an explicit error state', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Account not found', 404))

    const { result } = renderGetAccountTimeline('org-1', companyRoot)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe('Account not found')
    expect(result.current.state).toBe('error')
  })
})
