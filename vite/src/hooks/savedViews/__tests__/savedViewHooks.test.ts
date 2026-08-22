import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { createViewConfig } from '@/components/crm/viewConfig'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetViews } from '../useGetViews'
import { useSaveView } from '../useSaveView'
import { useUpdateView } from '../useUpdateView'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

const attributes = [{
  id: 'name', objectId: 'company', slug: 'name', name: 'Name', description: null,
  icon: null, type: 'text', optionsJson: null, refObjectId: null, formatJson: null,
  validationJson: null, isIdentity: true, storage: 'column', isMulti: false,
  isRequired: false, isUnique: false, isReadOnly: false, isSystem: true,
  defaultJson: null, sortOrder: 0, isArchived: false,
  createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
}]
const config = createViewConfig(attributes)

function wrapper(client: QueryClient = makeTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => withProviders(children, { client })
}

beforeEach(() => jsonFetch.mockReset())

describe('saved view hooks', () => {
  it('lists one object’s Personal and Shared views under its centralized query key', async () => {
    jsonFetch.mockResolvedValue({ views: [] })
    const client = makeTestQueryClient()
    const { result } = renderHook(() => useGetViews('org-1', 'company'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/saved-views?objectId=company')
    expect(client.getQueryData(queryKeys.savedViews.list('org-1', 'company'))).toEqual({ views: [] })
  })

  it('does not read until both the organization and object are known', async () => {
    const { result } = renderHook(() => useGetViews('org-1', null), { wrapper: wrapper() })

    expect(result.current.fetchStatus).toBe('idle')
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('creates and makes a first view the default so it survives a reload', async () => {
    jsonFetch.mockResolvedValue({ view: { id: 'view-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSaveView(), { wrapper: wrapper(client) })

    result.current.mutate({ orgId: 'org-1', objectId: 'company', name: 'Default view', config })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenNthCalledWith(1, '/api/orgs/org-1/saved-views', {
      method: 'POST', body: JSON.stringify({ objectId: 'company', name: 'Default view', layout: 'grid', config }),
    })
    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/orgs/org-1/saved-views/view-1/default', { method: 'POST' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.savedViews.all('org-1') })
  })

  it('PATCHes an existing view config and refreshes its object’s views', async () => {
    jsonFetch.mockResolvedValue({ view: { id: 'view-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateView(), { wrapper: wrapper(client) })

    result.current.mutate({ orgId: 'org-1', viewId: 'view-1', config })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/saved-views/view-1', {
      method: 'PATCH', body: JSON.stringify({ config }),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.savedViews.all('org-1') })
  })
})
