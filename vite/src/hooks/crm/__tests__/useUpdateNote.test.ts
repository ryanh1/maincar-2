import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useUpdateNote } from '../useUpdateNote'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ jsonFetch }))

describe('useUpdateNote', () => {
  it('PATCHes the structured body and refreshes activity and timeline readers', async () => {
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    jsonFetch.mockResolvedValue({ note: { id: 'note-1' } })
    const { result } = renderHook(() => useUpdateNote(), { wrapper })
    const bodyJson = { type: 'doc', content: [{ type: 'paragraph' }] }

    await result.current.mutateAsync({ orgId: 'org-1', noteId: 'note-1', bodyJson })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/notes/note-1', {
      method: 'PATCH', body: JSON.stringify({ bodyJson }),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.activity.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.accountTimeline.all('org-1') })
  })
})
