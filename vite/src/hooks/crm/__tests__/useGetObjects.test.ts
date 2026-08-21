import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetObjects } from '../useGetObjects'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderGetObjects(orgId: string | null | undefined) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetObjects(orgId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetObjects', () => {
  it('reads the org-scoped path', async () => {
    jsonFetch.mockResolvedValue({ objects: [{ id: 'obj-1', slug: 'person' }] })

    const { result } = renderGetObjects('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects')
    expect(result.current.data?.objects[0].slug).toBe('person')
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetObjects(null)

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized key', async () => {
    jsonFetch.mockResolvedValue({ objects: [] })

    const { client, result } = renderGetObjects('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.objects.list('org-1'))).toBeDefined()
  })

  it('surfaces the server own message when the read fails', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetObjects('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
  })
})
