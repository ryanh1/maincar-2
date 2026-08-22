import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { queryKeys } from '@/lib/queryKeys'
import {
  useActivateVoicemailGreeting,
  useDeleteVoicemailGreeting,
  useGetVoicemailGreeting,
  useUploadVoicemailGreeting,
} from '..'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => withProviders(children, { client })
}

describe('voicemail greeting hooks', () => {
  beforeEach(() => jsonFetch.mockReset())

  it('reads the greeting lifecycle under the active organization cache key', async () => {
    jsonFetch.mockResolvedValue({ greeting: { active: null, candidates: [] } })
    const client = makeTestQueryClient()
    const { result } = renderHook(() => useGetVoicemailGreeting('org-1'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/voicemail-greeting')
    expect(client.getQueryData(queryKeys.voicemailGreeting.detail('org-1'))).toBeDefined()
  })

  it('does not request a greeting before an organization is selected', async () => {
    const { result } = renderHook(() => useGetVoicemailGreeting(undefined), {
      wrapper: wrapper(makeTestQueryClient()),
    })

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('uploads a candidate with an idempotency key and refreshes its lifecycle', async () => {
    jsonFetch.mockResolvedValue({ greeting: { id: 'candidate-1', status: 'transcoding' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const file = new File(['audio'], 'greeting.webm', { type: 'audio/webm' })
    const { result } = renderHook(() => useUploadVoicemailGreeting(), { wrapper: wrapper(client) })

    result.current.mutate({ orgId: 'org-1', file, idempotencyKey: 'upload-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith(
      '/api/orgs/org-1/voicemail-greeting',
      expect.objectContaining({ method: 'POST', headers: { 'Idempotency-Key': 'upload-1' } }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.voicemailGreeting.all })
  })

  it('activates and deletes only the selected organization greeting', async () => {
    jsonFetch.mockResolvedValue(undefined)
    const client = makeTestQueryClient()
    const { result: activate } = renderHook(() => useActivateVoicemailGreeting(), { wrapper: wrapper(client) })
    const { result: remove } = renderHook(() => useDeleteVoicemailGreeting(), { wrapper: wrapper(client) })

    activate.current.mutate({ orgId: 'org-1', greetingId: 'candidate-1' })
    await waitFor(() => expect(activate.current.isSuccess).toBe(true))
    remove.current.mutate({ orgId: 'org-1', greetingId: 'candidate-1' })
    await waitFor(() => expect(remove.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenNthCalledWith(1, '/api/orgs/org-1/voicemail-greeting/candidate-1/activate', { method: 'POST' })
    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/orgs/org-1/voicemail-greeting/candidate-1', { method: 'DELETE' })
  })
})
