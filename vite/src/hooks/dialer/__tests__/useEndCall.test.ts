import { createElement, type ReactNode } from 'react'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CallDetail } from '@/lib/callTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { DialerProvider } from '@/components/dialer/DialerProvider'
import { useDialer } from '@/components/dialer/dialerContext'
import { useEndCall } from '../useEndCall'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function canceledCall(id: string): CallDetail {
  return {
    id,
    direction: 'outbound',
    status: 'canceled',
    fromE164: '+12025550100',
    toE164: '+12025550123',
    recordingConsent: 'granted',
    twilioCallSid: 'CA123',
    durationS: null,
    startedAt: null,
    endedAt: '2026-08-20T12:00:10.000Z',
    createdAt: '2026-08-20T12:00:00.000Z',
    recordingEnabled: null,
    recordingUrl: null,
    transcriptStatus: 'skipped-not-recorded',
    transcript: null,
  }
}

function renderEndCall(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    withProviders(createElement(DialerProvider, null, children), { client })
  return {
    client,
    ...renderHook(() => ({ end: useEndCall(), dialer: useDialer() }), { wrapper }),
  }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useEndCall', () => {
  it('DELETEs the call from the org-and-id scoped path', async () => {
    jsonFetch.mockResolvedValue({ call: canceledCall('call-1') })

    const { result } = renderEndCall()
    result.current.end.mutate({ orgId: 'org-1', callId: 'call-1' })

    await waitFor(() => expect(result.current.end.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/calls/call-1', { method: 'DELETE' })
  })

  it('completes the dialer and stops it dialing on success', async () => {
    jsonFetch.mockResolvedValue({ call: canceledCall('call-1') })

    const { result } = renderEndCall()
    // Put a call up first, so ending it is a real transition.
    act(() => result.current.dialer.startCall())
    expect(result.current.dialer.dialing).toBe(true)

    result.current.end.mutate({ orgId: 'org-1', callId: 'call-1' })

    await waitFor(() => expect(result.current.dialer.phase).toBe('completed'))
    expect(result.current.dialer.dialing).toBe(false)
  })

  it('invalidates both the history and this call detail on success', async () => {
    jsonFetch.mockResolvedValue({ call: canceledCall('call-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderEndCall(client)
    result.current.end.mutate({ orgId: 'org-1', callId: 'call-1' })

    await waitFor(() => expect(result.current.end.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calls.list('org-1') })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.calls.detail('org-1', 'call-1'),
    })
  })

  it('leaves the dialer as it was when the hang-up is refused', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('This call has already ended, so there is nothing to hang up.', 400),
    )

    const { result } = renderEndCall()
    act(() => result.current.dialer.startCall())

    result.current.end.mutate({ orgId: 'org-1', callId: 'call-1' })

    await waitFor(() => expect(result.current.end.isError).toBe(true))
    // A refused hang-up must not falsely mark the call completed.
    expect(result.current.dialer.phase).toBe('ringing')
    expect(result.current.dialer.dialing).toBe(true)
  })
})
