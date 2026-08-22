import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { queryKeys } from '@/lib/queryKeys'
import { useDeleteVoicemail } from '../useDeleteVoicemail'
import { useGetVoicemail } from '../useGetVoicemail'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => withProviders(children, { client })
}

beforeEach(() => jsonFetch.mockReset())

describe('voicemail detail hooks', () => {
  it('reads one voicemail using the org-and-id-scoped path and cache key', async () => {
    jsonFetch.mockResolvedValue({ voicemail: { id: 'vm-1' } })
    const client = makeTestQueryClient()
    const { result } = renderHook(() => useGetVoicemail('org-1', 'vm-1'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/voicemails/vm-1')
    expect(client.getQueryData(queryKeys.voicemails.detail('org-1', 'vm-1'))).toBeDefined()
  })

  it('does not fetch until both org and voicemail id exist', async () => {
    const { result } = renderHook(() => useGetVoicemail(null, 'vm-1'), {
      wrapper: wrapper(makeTestQueryClient()),
    })
    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('deletes through the scoped path and refreshes voicemail data', async () => {
    jsonFetch.mockResolvedValue(undefined)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteVoicemail(), { wrapper: wrapper(client) })
    result.current.mutate({ orgId: 'org-1', id: 'vm-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/voicemails/vm-1', { method: 'DELETE' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.voicemails.all })
  })
})
