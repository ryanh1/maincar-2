import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import { queryKeys } from '@/lib/queryKeys'
import { useRemoveListEntry } from '../useRemoveListEntry'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

describe('useRemoveListEntry', () => {
  it('unlinks the membership without touching the target record, then refreshes the list entries', async () => {
    jsonFetch.mockResolvedValue(undefined)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    const { result } = renderHook(() => useRemoveListEntry(), { wrapper })

    await result.current.mutateAsync({ orgId: 'org-1', listId: 'list-1', entryId: 'entry-1' })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/lists/list-1/entries/entry-1', { method: 'DELETE' })
    expect(jsonFetch.mock.calls.every(([url]) => !String(url).includes('/records/'))).toBe(true)
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.crm.listEntries('org-1', 'list-1') }))
  })
})
