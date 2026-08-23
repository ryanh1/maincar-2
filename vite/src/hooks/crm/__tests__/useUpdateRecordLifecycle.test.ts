import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { makeTestQueryClient, withProviders } from '@/test/utils'
import type { ObjectDef } from '@/lib/crmTypes'
import { useUpdateRecordLifecycle } from '../useUpdateRecordLifecycle'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

const object: ObjectDef = {
  id: 'obj-1', slug: 'person', name: 'Person', namePlural: 'People', icon: null, iconColor: null,
  storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: true,
  capabilities: { list: true }, isHidden: false, isArchived: false,
  createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
}

describe('useUpdateRecordLifecycle', () => {
  beforeEach(() => {
    jsonFetch.mockReset()
    jsonFetch.mockResolvedValue({ person: { id: 'person-1', isArchived: true } })
  })

  it('archives a standard record through its object route', async () => {
    const client = makeTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
    const { result } = renderHook(() => useUpdateRecordLifecycle(), { wrapper })

    await result.current.mutateAsync({ orgId: 'org-1', object, recordId: 'person-1', isArchived: true })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/people/person-1', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
