import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetCellStyles } from '../useGetCellStyles'
import { useSetCellStyle } from '../useSetCellStyle'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function wrapper(client: QueryClient = makeTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => withProviders(children, { client })
}

beforeEach(() => jsonFetch.mockReset())

describe('cell style hooks', () => {
  it('lists one view’s painted cells under its centralized query key', async () => {
    jsonFetch.mockResolvedValue({ cellStyles: [] })
    const client = makeTestQueryClient()
    const { result } = renderHook(() => useGetCellStyles('org-1', 'view-1'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/cell-styles?viewId=view-1')
    expect(client.getQueryData(queryKeys.cellStyles.list('org-1', 'view-1'))).toEqual({ cellStyles: [] })
  })

  it('does not read until both the organization and view are known', async () => {
    const { result } = renderHook(() => useGetCellStyles('org-1', null), { wrapper: wrapper() })

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('paints a cell and refreshes the view’s cell styles', async () => {
    jsonFetch.mockResolvedValue({ cellStyle: { id: 'style-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSetCellStyle(), { wrapper: wrapper(client) })

    await result.current.mutateAsync({ orgId: 'org-1', viewId: 'view-1', recordId: 'record-1', fieldId: 'field-1', backgroundToken: 'option-1', textToken: null })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/cell-styles', {
      method: 'PUT',
      body: JSON.stringify({ viewId: 'view-1', recordId: 'record-1', fieldId: 'field-1', backgroundToken: 'option-1', textToken: null }),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.cellStyles.all('org-1') })
  })
})
