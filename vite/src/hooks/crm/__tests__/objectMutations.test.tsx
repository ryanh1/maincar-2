import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useCreateObject } from '../useCreateObject'
import { useDeleteObject } from '../useDeleteObject'
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
  beforeEach(() => vi.clearAllMocks())

  it('creates a custom object and refreshes editor and navbar object queries', async () => {
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
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.all })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.crm.objects('org-1') })
    })
  })

  it('patches only the submitted object fields and refreshes editor and navbar object queries', async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ object: { id: 'obj-project' } } as never)
    const { result, invalidate } = setup(() => useUpdateObject())

    await result.current.mutateAsync({
      orgId: 'org-1',
      objectId: 'obj-project',
      icon: 'rocket',
      isHidden: true,
    })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-project', {
      method: 'PATCH',
      body: JSON.stringify({ icon: 'rocket', isHidden: true }),
    })
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.all })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.crm.objects('org-1') })
    })
  })

  it('deletes a custom object and refreshes editor and navbar object queries', async () => {
    vi.mocked(jsonFetch).mockResolvedValue(undefined as never)
    const { result, invalidate } = setup(() => useDeleteObject())

    await result.current.mutateAsync({ orgId: 'org-1', objectId: 'obj-project' })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/objects/obj-project', { method: 'DELETE' })
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.objects.all })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.crm.objects('org-1') })
    })
  })
})
