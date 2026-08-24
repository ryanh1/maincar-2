import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useCreateObject } from '../useCreateObject'
import { useUpdateObject } from '../useUpdateObject'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch: vi.fn() }
})

function setup<T>(hook: () => T) {
  const client = makeTestQueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { ...renderHook(hook, { wrapper }), invalidate }
}

describe('object mutations', () => {
  it('creates a custom object with the selected icon and refreshes the object list', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ object: { id: 'obj-project' } } as never)
    const { result, invalidate } = setup(() => useCreateObject())

    await result.current.mutateAsync({
      orgId: 'org-1',
      slug: 'project',
      name: 'Project',
      namePlural: 'Projects',
      icon: 'folder-kanban',
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects', {
      method: 'POST',
      body: JSON.stringify({ slug: 'project', name: 'Project', namePlural: 'Projects', icon: 'folder-kanban' }),
    })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.list('org-1') }))
  })

  it('updates an object icon and refreshes both list and detail caches', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ object: { id: 'obj-project' } } as never)
    const { result, invalidate } = setup(() => useUpdateObject())

    await result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-project',
      name: 'Project',
      namePlural: 'Projects',
      icon: 'rocket',
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-project', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Project', namePlural: 'Projects', icon: 'rocket' }),
    })
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.list('org-1') })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.detail('org-1', 'obj-project') })
    })
  })
})
