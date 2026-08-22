import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { withProviders } from '@/test/utils'
import type { ObjectDef } from '@/lib/crmTypes'
import { useCreateRecord } from '../useCreateRecord'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ jsonFetch }))

const wrapper = ({ children }: { children: ReactNode }) => withProviders(children)

describe('useCreateRecord', () => {
  it('creates a company through its established route with the blank row values', async () => {
    jsonFetch.mockResolvedValue({ company: { id: 'company-1', name: 'Acme' } })
    const object = { id: 'company', slug: 'company', storage: 'table' } as ObjectDef
    const { result } = renderHook(() => useCreateRecord(), { wrapper })

    await result.current.mutateAsync({ orgId: 'org-1', object, values: { name: 'Acme' } })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/companies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme' }),
    })
  })

  it('creates a record-backed object through the generic records route', async () => {
    jsonFetch.mockResolvedValue({ record: { id: 'project-1', name: 'Migration' } })
    const object = { id: 'project', slug: 'project', storage: 'record' } as ObjectDef
    const { result } = renderHook(() => useCreateRecord(), { wrapper })

    await result.current.mutateAsync({ orgId: 'org-1', object, values: { name: 'Migration' } })

    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org-1/records', {
      method: 'POST',
      body: JSON.stringify({ objectId: 'project', values: { name: 'Migration' } }),
    })
  })
})
