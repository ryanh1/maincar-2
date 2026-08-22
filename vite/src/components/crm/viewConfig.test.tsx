import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import type { AttributeDef } from '@/lib/crmTypes'
import { toRecordListQuery, useViewConfig } from './viewConfig'

const attributes = [
  { id: 'first-name', slug: 'firstName', name: 'First name' },
  { id: 'status', slug: 'status', name: 'Status' },
] as AttributeDef[]

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/records/person']}>{children}</MemoryRouter>
}

describe('viewConfig', () => {
  it('maps durable attribute ids to the list API sort and filter fields', () => {
    const query = toRecordListQuery(
      {
        sorts: [{ attributeId: 'first-name', direction: 'asc' }],
        filterTree: {
          type: 'condition',
          attributeId: 'status',
          operator: 'in',
          value: ['open', 'qualified'],
        },
      },
      attributes,
    )

    expect(query).toEqual({
      sort: { field: 'firstName', direction: 'asc' },
      filter: {
        type: 'condition',
        field: 'status',
        operator: 'in',
        value: ['open', 'qualified'],
      },
    })
  })

  it('shares a sorted config through the URL without encoding filter values', () => {
    const { result } = renderHook(
      () => {
        const [config, updateConfig] = useViewConfig(attributes)
        return { config, updateConfig, search: useLocation().search }
      },
      { wrapper },
    )

    act(() => {
      result.current.updateConfig((current) => ({
        ...current,
        sorts: [{ attributeId: 'first-name', direction: 'asc' }],
        filterTree: {
          type: 'condition',
          attributeId: 'status',
          operator: 'in',
          value: ['open'],
        },
      }))
    })

    expect(result.current.config.sorts).toEqual([{ attributeId: 'first-name', direction: 'asc' }])
    expect(result.current.config.filterTree).toMatchObject({ attributeId: 'status', value: ['open'] })
    expect(result.current.search).toContain('v=')
    expect(result.current.search).not.toContain('open')
  })
})
