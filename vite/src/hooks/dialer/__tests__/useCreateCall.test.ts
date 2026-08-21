import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { Call } from '@/lib/callTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { DialerProvider } from '@/components/dialer/DialerProvider'
import { useDialer } from '@/components/dialer/dialerContext'
import { useCreateCall } from '../useCreateCall'

// Only the transport is mocked. The hook's job is the URL, the method, the body,
// what it does to the shared dialer state, and what it invalidates.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function queuedCall(id: string): Call {
  return {
    id,
    direction: 'outbound',
    status: 'queued',
    fromE164: '+12025550100',
    toE164: '+12025550123',
    recordingConsent: 'granted',
    twilioCallSid: null,
    createdAt: '2026-08-20T12:00:00.000Z',
  }
}

// The mutation and the dialer state it drives, read from inside ONE provider so a
// test can place a call and then assert on the context it moved.
function renderCreateCall(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    withProviders(createElement(DialerProvider, null, children), { client })
  return {
    client,
    ...renderHook(() => ({ create: useCreateCall(), dialer: useDialer() }), { wrapper }),
  }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useCreateCall', () => {
  it('POSTs the number and consent to the org-scoped path, orgId in the path only', async () => {
    jsonFetch.mockResolvedValue({ call: queuedCall('call-1') })

    const { result } = renderCreateCall()
    result.current.create.mutate({
      orgId: 'org-1',
      toE164: '+12025550123',
      recordingConsent: 'granted',
    })

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/calls', {
      method: 'POST',
      body: JSON.stringify({ toE164: '+12025550123', recordingConsent: 'granted' }),
    })
  })

  it('moves the dialer into its ringing state on success', async () => {
    jsonFetch.mockResolvedValue({ call: queuedCall('call-1') })

    const { result } = renderCreateCall()
    // Idle until the call actually starts.
    expect(result.current.dialer.phase).toBe('idle')
    expect(result.current.dialer.dialing).toBe(false)

    result.current.create.mutate({
      orgId: 'org-1',
      toE164: '+12025550123',
      recordingConsent: 'granted',
    })

    await waitFor(() => expect(result.current.dialer.phase).toBe('ringing'))
    expect(result.current.dialer.dialing).toBe(true)
    expect(result.current.dialer.view).toBe('expanded')
    expect(result.current.dialer.mode).toBe('call')
    // The queued call's identity is handed to the dialer so the in-call controls
    // can hang it up. Consent was granted, so recording is on.
    expect(result.current.dialer.activeCall).toEqual({
      orgId: 'org-1',
      callId: 'call-1',
      recording: true,
    })
  })

  it('invalidates the call history so the placed call shows up in it', async () => {
    jsonFetch.mockResolvedValue({ call: queuedCall('call-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderCreateCall(client)
    result.current.create.mutate({
      orgId: 'org-1',
      toE164: '+12025550123',
      recordingConsent: 'granted',
    })

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calls.list('org-1') })
  })

  it('leaves the dialer idle when the call is refused', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('You already have a call to this number in progress.', 409),
    )

    const { result } = renderCreateCall()
    result.current.create.mutate({
      orgId: 'org-1',
      toE164: '+12025550123',
      recordingConsent: 'granted',
    })

    await waitFor(() => expect(result.current.create.isError).toBe(true))
    // A call that never started must not leave the dialer showing "ringing".
    expect(result.current.dialer.phase).toBe('idle')
    expect(result.current.dialer.dialing).toBe(false)
    expect((result.current.create.error as ApiError).message).toBe(
      'You already have a call to this number in progress.',
    )
  })
})
