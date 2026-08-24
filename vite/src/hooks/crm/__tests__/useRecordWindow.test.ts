import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useRecordWindow } from '../useRecordWindow'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderRecordWindow(orgId: string | null | undefined, objectId: string | null | undefined) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useRecordWindow(orgId, objectId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useRecordWindow', () => {
  it('flattens one page of rows and reports the total', async () => {
    jsonFetch.mockResolvedValue({
      rows: [{ id: 'r1' }, { id: 'r2' }],
      nextCursor: null,
      totalCount: 2,
      totalCountBeforeSearch: 8,
    })

    const { result } = renderRecordWindow('org-1', 'obj-1')

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.rows).toEqual([{ id: 'r1' }, { id: 'r2' }])
    expect(result.current.totalCount).toBe(2)
    expect(result.current.totalCountBeforeSearch).toBe(8)
    expect(result.current.hasNextPage).toBe(false)
  })

  it('concatenates rows across pages in order, and keeps the latest totalCount', async () => {
    jsonFetch
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }], nextCursor: 'c1', totalCount: 3 })
      .mockResolvedValueOnce({ rows: [{ id: 'r2' }, { id: 'r3' }], nextCursor: null, totalCount: 3 })

    const { result } = renderRecordWindow('org-1', 'obj-1')

    await waitFor(() => expect(result.current.isPending).toBe(false))
    await result.current.fetchNextPage()

    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    expect(result.current.rows).toEqual([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }])
    expect(result.current.totalCount).toBe(3)
  })

  it('reports an empty window before anything has loaded', () => {
    const { result } = renderRecordWindow(null, null)

    expect(result.current.rows).toEqual([])
    expect(result.current.totalCount).toBe(0)
  })
})
