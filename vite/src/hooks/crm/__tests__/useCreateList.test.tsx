import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useCreateList } from '../useCreateList'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch: vi.fn() }
})

describe('useCreateList', () => {
  it('creates a fixed-object list and refreshes the lists navigation', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ list: { id: 'list-1', name: 'Priority people' } } as never)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    const { result } = renderHook(() => useCreateList(), { wrapper })

    await result.current.mutateAsync({ orgId: 'org-1', name: 'Priority people', objectSlug: 'person' })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'Priority people', objectSlug: 'person' }),
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.crm.lists('org-1') }))
  })
})
