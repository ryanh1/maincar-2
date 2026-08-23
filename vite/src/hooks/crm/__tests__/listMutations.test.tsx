import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useCreateListAttribute } from '../useCreateListAttribute'
import { useReorderListEntries } from '../useReorderListEntries'
import { useUpdateListEntry } from '../useUpdateListEntry'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderMutation<T>(hook: () => T) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(hook, { wrapper }) }
}

describe('list mutations', () => {
  it('creates a list-only field and refreshes the object detail', async () => {
    jsonFetch.mockResolvedValue({ attribute: { id: 'priority', storage: 'list' } })
    const { result, client } = renderMutation(useCreateListAttribute)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await result.current.mutateAsync({ orgId: 'org-1', objectId: 'person', name: 'Priority', slug: 'priority', type: 'text' })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/attributes', {
      method: 'POST',
      body: JSON.stringify({ objectId: 'person', name: 'Priority', slug: 'priority', type: 'text', storage: 'list' }),
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['objects', 'detail', 'org-1', 'person'] }))
  })

  it('writes a value through the membership endpoint instead of the record endpoint', async () => {
    jsonFetch.mockResolvedValue({ entry: { id: 'entry-1', values: { priority: 'High' } } })
    const { result, client } = renderMutation(useUpdateListEntry)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await result.current.mutateAsync({ orgId: 'org-1', listId: 'list-1', entryId: 'entry-1', valuesJson: { priority: 'High' } })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/lists/list-1/entries/entry-1', {
      method: 'PATCH',
      body: JSON.stringify({ valuesJson: { priority: 'High' } }),
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm', 'org-1', 'lists', 'list-1', 'entries'] }))
  })

  it('persists a complete manual membership order', async () => {
    jsonFetch.mockResolvedValue(undefined)
    const { result, client } = renderMutation(useReorderListEntries)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await result.current.mutateAsync({ orgId: 'org-1', listId: 'list-1', entryIds: ['entry-2', 'entry-1'] })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/lists/list-1/entries/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ entryIds: ['entry-2', 'entry-1'] }),
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm', 'org-1', 'lists', 'list-1', 'entries'] }))
  })

  it('persists one moved membership between its neighbors', async () => {
    jsonFetch.mockResolvedValue(undefined)
    const { result, client } = renderMutation(useReorderListEntries)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await result.current.mutateAsync({
      orgId: 'org-1',
      listId: 'list-1',
      entryId: 'entry-3',
      beforeEntryId: 'entry-1',
      afterEntryId: 'entry-2',
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/lists/list-1/entries/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ entryId: 'entry-3', beforeEntryId: 'entry-1', afterEntryId: 'entry-2' }),
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm', 'org-1', 'lists', 'list-1', 'entries'] }))
  })
})
