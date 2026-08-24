import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import {
  useDeleteVoicemailDrop,
  useGetVoicemailDrops,
  useRenameVoicemailDrop,
  useSetDefaultVoicemailDrop,
  useUploadVoicemailDrop,
} from '..'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => withProviders(children, { client })
}

describe('voicemail drop hooks', () => {
  beforeEach(() => jsonFetch.mockReset())

  it('lists drops under the active organization cache key', async () => {
    jsonFetch.mockResolvedValue({ drops: [], total: 0 })
    const client = makeTestQueryClient()
    const { result } = renderHook(() => useGetVoicemailDrops('org-1'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/voicemail-drops')
    expect(client.getQueryData(queryKeys.voicemailDrops.list('org-1'))).toEqual({ drops: [], total: 0 })
  })

  it('does not list drops before an organization is selected', async () => {
    const { result } = renderHook(() => useGetVoicemailDrops(undefined), {
      wrapper: wrapper(makeTestQueryClient()),
    })

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('uploads a named WebM file and refreshes the organization library', async () => {
    jsonFetch.mockResolvedValue({ drop: { id: 'drop-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const file = new File(['audio'], 'drop.webm', { type: 'audio/webm' })
    const { result } = renderHook(() => useUploadVoicemailDrop(), { wrapper: wrapper(client) })

    result.current.mutate({ orgId: 'org-1', name: 'Sales follow-up', file })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/voicemail-drops', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData),
    }))
    const body = jsonFetch.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('name')).toBe('Sales follow-up')
    expect(body.get('audio')).toBe(file)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.voicemailDrops.all('org-1') })
  })

  it('renames, moves the default, and deletes only the selected drop', async () => {
    jsonFetch.mockResolvedValue({ drop: { id: 'drop-1' } })
    const client = makeTestQueryClient()
    const { result: rename } = renderHook(() => useRenameVoicemailDrop(), { wrapper: wrapper(client) })
    const { result: setDefault } = renderHook(() => useSetDefaultVoicemailDrop(), { wrapper: wrapper(client) })
    const { result: remove } = renderHook(() => useDeleteVoicemailDrop(), { wrapper: wrapper(client) })

    rename.current.mutate({ orgId: 'org-1', dropId: 'drop-1', name: 'Updated drop' })
    await waitFor(() => expect(rename.current.isSuccess).toBe(true))
    setDefault.current.mutate({ orgId: 'org-1', dropId: 'drop-1' })
    await waitFor(() => expect(setDefault.current.isSuccess).toBe(true))
    remove.current.mutate({ orgId: 'org-1', dropId: 'drop-1' })
    await waitFor(() => expect(remove.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenNthCalledWith(1, '/api/orgs/org-1/voicemail-drops/drop-1', {
      method: 'PATCH', body: JSON.stringify({ name: 'Updated drop' }),
    })
    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/orgs/org-1/voicemail-drops/drop-1', {
      method: 'PATCH', body: JSON.stringify({ isDefault: true }),
    })
    expect(jsonFetch).toHaveBeenNthCalledWith(3, '/api/orgs/org-1/voicemail-drops/drop-1', {
      method: 'DELETE',
    })
  })
})
