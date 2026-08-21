import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useListRecords } from '../useListRecords'
import type { UseListRecordsParams } from '../useListRecords'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderListRecords(
  orgId: string | null | undefined,
  objectId: string | null | undefined,
  params: UseListRecordsParams = {},
) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useListRecords(orgId, objectId, params), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useListRecords', () => {
  it('asks for the first window with a null cursor', async () => {
    jsonFetch.mockResolvedValue({ rows: [{ id: 'r1' }], nextCursor: null, totalCount: 1 })

    const { result } = renderListRecords('org-1', 'obj-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-1/list', {
      method: 'POST',
      body: JSON.stringify({ cursor: null }),
    })
  })

  it('sends the sort spec when one is given', async () => {
    jsonFetch.mockResolvedValue({ rows: [], nextCursor: null, totalCount: 0 })

    const sort = { field: 'lastName', direction: 'asc' as const }
    renderListRecords('org-1', 'obj-1', { sort })

    await waitFor(() =>
      expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-1/list', {
        method: 'POST',
        body: JSON.stringify({ cursor: null, sort }),
      }),
    )
  })

  it('fetches the next window using the cursor the server returned', async () => {
    jsonFetch
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }], nextCursor: 'cursor-1', totalCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: 'r2' }], nextCursor: null, totalCount: 2 })

    const { result } = renderListRecords('org-1', 'obj-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(true)

    await result.current.fetchNextPage()

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(jsonFetch).toHaveBeenLastCalledWith('/api/orgs/org-1/objects/obj-1/list', {
      method: 'POST',
      body: JSON.stringify({ cursor: 'cursor-1' }),
    })
    expect(result.current.hasNextPage).toBe(false)
  })

  it('does not fire without an org and an object id', async () => {
    const { result } = renderListRecords('org-1', null)

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })
})
