import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetListEntries } from '../useGetListEntries'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderListEntries(orgId: string | null | undefined, listId: string | null | undefined) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { ...renderHook(() => useGetListEntries(orgId, listId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetListEntries', () => {
  it('loads entry membership, target records, and list-only values through a GET-only data path', async () => {
    jsonFetch.mockResolvedValue({
      entries: [{ id: 'entry-1', targetId: 'person-1', position: 3, values: { stage: 'contacted' }, target: { id: 'person-1', firstName: 'Ada' } }],
      total: 1,
      page: 1,
      limit: 100,
    })

    const { result } = renderListEntries('org-1', 'list-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/lists/list-1/entries?page=1&limit=100')
    expect(jsonFetch.mock.calls.every(([url]) => !String(url).includes('/objects/') && !String(url).includes('PATCH'))).toBe(true)
    expect(result.current.data?.pages[0].entries[0]).toMatchObject({
      target: { id: 'person-1', firstName: 'Ada' },
      values: { stage: 'contacted' },
      position: 3,
    })
  })

  it('requests the next membership page when one exists', async () => {
    jsonFetch
      .mockResolvedValueOnce({ entries: [], total: 101, page: 1, limit: 100 })
      .mockResolvedValueOnce({ entries: [], total: 101, page: 2, limit: 100 })

    const { result } = renderListEntries('org-1', 'list-1')

    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await result.current.fetchNextPage()

    expect(jsonFetch).toHaveBeenLastCalledWith('/api/orgs/org-1/lists/list-1/entries?page=2&limit=100')
  })
})
