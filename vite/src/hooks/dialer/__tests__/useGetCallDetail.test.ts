import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallDetail } from '@/lib/callTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetCallDetail } from '../useGetCallDetail'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function detail(id: string): CallDetail {
  return {
    id,
    direction: 'outbound',
    status: 'completed',
    fromE164: '+12025550100',
    toE164: '+12025550123',
    recordingPlanned: true,
    recordingReason: 'allowed',
    destinationState: 'DC',
    twilioCallSid: 'CA123',
    durationS: 42,
    startedAt: '2026-08-20T12:00:00.000Z',
    endedAt: '2026-08-20T12:00:42.000Z',
    createdAt: '2026-08-20T12:00:00.000Z',
    recordingEnabled: true,
    recordingUrl: 'https://signed.example/recording.mp3',
    transcriptStatus: 'done',
    transcript: 'Hello there.',
  }
}

function renderGetDetail(
  orgId: string | null | undefined,
  callId: string | null | undefined,
  client: QueryClient = makeTestQueryClient(),
  options?: { refetchInterval?: number | false },
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetCallDetail(orgId, callId, options), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetCallDetail', () => {
  it('reads one call from the org-and-id scoped path', async () => {
    jsonFetch.mockResolvedValue({ call: detail('call-1') })

    const { result } = renderGetDetail('org-1', 'call-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/calls/call-1')
    expect(result.current.data?.call.transcript).toBe('Hello there.')
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetDetail(null, 'call-1')

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('does not fire without a call id', async () => {
    const { result } = renderGetDetail('org-1', null)

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized per-call key', async () => {
    jsonFetch.mockResolvedValue({ call: detail('call-1') })

    const { client, result } = renderGetDetail('org-1', 'call-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.calls.detail('org-1', 'call-1'))).toBeDefined()
  })

  it('surfaces the server 404 when the call is not this org', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Call not found', 404))

    const { result } = renderGetDetail('org-1', 'missing')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(404)
  })

  it('does not repeat the fetch on its own — refetchInterval is off by default', async () => {
    jsonFetch.mockResolvedValue({ call: detail('call-1') })

    const { result } = renderGetDetail('org-1', 'call-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await new Promise((r) => setTimeout(r, 30))
    expect(jsonFetch).toHaveBeenCalledTimes(1)
  })

  it('polls at the given interval when refetchInterval is set (MAI-190)', async () => {
    jsonFetch.mockResolvedValue({ call: detail('call-1') })

    renderGetDetail('org-1', 'call-1', undefined, { refetchInterval: 5 })

    await waitFor(() => expect(jsonFetch.mock.calls.length).toBeGreaterThan(1))
  })
})
