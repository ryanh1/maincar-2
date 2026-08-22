import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallHistoryItem, GetCallsParams } from '@/lib/callTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetCalls } from '../useGetCalls'

// Only the transport is mocked. The hook's job is the URL it builds from the
// params, the key it caches under, and the enabled gate.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function historyItem(id: string, toE164: string): CallHistoryItem {
  return {
    id,
    direction: 'outbound',
    status: 'completed',
    fromE164: '+12025550100',
    toE164,
    recordingPlanned: true,
    recordingReason: 'allowed',
    twilioCallSid: 'CA123',
    durationS: 42,
    startedAt: '2026-08-20T12:00:00.000Z',
    endedAt: '2026-08-20T12:00:42.000Z',
    createdAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderGetCalls(
  orgId: string | null | undefined,
  params: GetCallsParams = {},
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetCalls(orgId, params), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetCalls', () => {
  it('reads page one from the org-scoped path with no query string by default', async () => {
    jsonFetch.mockResolvedValue({ calls: [historyItem('call-1', '+12025550123')], total: 1, page: 1, limit: 25 })

    const { result } = renderGetCalls('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/calls')
    expect(result.current.data?.calls[0].id).toBe('call-1')
  })

  it('puts pagination, search, and sort in the query string', async () => {
    jsonFetch.mockResolvedValue({ calls: [], total: 0, page: 2, limit: 50 })

    const { result } = renderGetCalls('org-1', {
      page: 2,
      limit: 50,
      sort: 'durationS',
      dir: 'asc',
      q: '201',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/orgs/org-1/calls?page=2&limit=50&sort=durationS&dir=asc&q=201',
    )
  })

  it('omits page one, so the default request stays clean', async () => {
    jsonFetch.mockResolvedValue({ calls: [], total: 0, page: 1, limit: 25 })

    const { result } = renderGetCalls('org-1', { page: 1, q: '' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // page=1 is the default and an empty search is no filter, so neither reaches
    // the URL.
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/calls')
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetCalls(null)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized key, so an invalidation reaches it', async () => {
    const params = { page: 2 }
    jsonFetch.mockResolvedValue({ calls: [], total: 0, page: 2, limit: 25 })

    const { client, result } = renderGetCalls('org-1', params)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(
      client.getQueryData(queryKeys.calls.list('org-1', params as Record<string, unknown>)),
    ).toBeDefined()
  })

  it('surfaces the server own message when the read fails', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetCalls('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
