import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { withProviders } from '@/test/utils'
import type { AttributeDef, ObjectDef } from '@/lib/crmTypes'
import { useUpdateRecordValue } from '../useUpdateRecordValue'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ jsonFetch }))

const wrapper = ({ children }: { children: ReactNode }) => withProviders(children)
const object = { id: 'object', slug: 'person', storage: 'table' } as unknown as ObjectDef
const attribute = { slug: 'callbackDate', type: 'date' } as unknown as AttributeDef

describe('useUpdateRecordValue', () => {
  it('writes a table-backed date through its established route', async () => {
    jsonFetch.mockResolvedValue({ person: { id: 'record' } })
    const { result } = renderHook(() => useUpdateRecordValue(), { wrapper })
    await result.current.mutateAsync({ orgId: 'org', object, attribute, recordId: 'record', value: '2026-08-25' })
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org/people/record', {
      method: 'PATCH',
      body: JSON.stringify({ callbackDate: '2026-08-25T12:00:00.000Z' }),
    })
  })

  it('merge-patches one custom field without sending a replacement customJson bag', async () => {
    jsonFetch.mockResolvedValue({ person: { id: 'record' } })
    const { result } = renderHook(() => useUpdateRecordValue(), { wrapper })
    await result.current.mutateAsync({
      orgId: 'org', object, attribute: { ...attribute, slug: 'website', type: 'url', storage: 'custom' },
      recordId: 'record', value: 'https://maincar.com',
    })
    expect(jsonFetch).toHaveBeenCalledWith('/api/orgs/org/people/record', {
      method: 'PATCH', body: JSON.stringify({ customValues: { website: 'https://maincar.com' } }),
    })
  })
})
