import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import type { AttributeDef } from '@/lib/crmTypes'
import { clampZoom, createViewConfig, relationSourceHue, reorderColumnGroup, resolveHeaderColor, setColumnHeaderColor, stepZoom, toRecordListQuery, useViewConfig } from './viewConfig'
import { encodeViewState } from './viewStateCodec'

const attributes = [
  { id: 'first-name', slug: 'firstName', name: 'First name' },
  { id: 'status', slug: 'status', name: 'Status' },
] as AttributeDef[]

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/records/person']}>{children}</MemoryRouter>
}

describe('viewConfig', () => {
  it('defaults new views to grid lines off', () => {
    expect(createViewConfig(attributes).gridLines).toBe(false)
  })

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
      sort: [{ field: 'firstName', direction: 'asc' }],
      filter: {
        type: 'condition',
        field: 'status',
        operator: 'in',
        value: ['open', 'qualified'],
      },
    })
  })

  it('expands between and none-of builder operators into the server filter contract', () => {
    const query = toRecordListQuery(
      {
        sorts: [],
        filterTree: {
          type: 'group',
          op: 'and',
          children: [
            { type: 'condition', attributeId: 'first-name', operator: 'between', value: ['10', '20'] },
            { type: 'condition', attributeId: 'status', operator: 'not_in', value: ['open', 'qualified'] },
          ],
        },
      },
      attributes,
    )

    expect(query.filter).toEqual({
      type: 'group',
      op: 'and',
      children: [
        {
          type: 'group',
          op: 'and',
          children: [
            { type: 'condition', field: 'firstName', operator: 'gte', value: '10' },
            { type: 'condition', field: 'firstName', operator: 'lte', value: '20' },
          ],
        },
        {
          type: 'group',
          op: 'and',
          children: [
            { type: 'condition', field: 'status', operator: 'neq', value: 'open' },
            { type: 'condition', field: 'status', operator: 'neq', value: 'qualified' },
          ],
        },
      ],
    })
  })

  it('does not send an incomplete condition to the record-list API', () => {
    const query = toRecordListQuery(
      {
        sorts: [],
        filterTree: { type: 'condition', attributeId: 'first-name', operator: 'contains', value: '' },
      },
      attributes,
    )

    expect(query.filter).toBeUndefined()
  })

  it('keeps the reusable Team scope intact for the list API', () => {
    const query = toRecordListQuery(
      {
        sorts: [],
        teamScope: { teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] },
      },
      attributes,
    )

    expect(query).toEqual({
      teamScope: { teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] },
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

  it('applies a valid URL overlay after the saved-view baseline', () => {
    const encoded = encodeViewState({
      ...createViewConfig(attributes),
      sorts: [{ attributeId: 'first-name', direction: 'asc' }],
    })
    const overlayWrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/records/person?v=${encoded}`]}>{children}</MemoryRouter>
    )

    const { result } = renderHook(
      () => useViewConfig(attributes, {
        ...createViewConfig(attributes),
        sorts: [{ attributeId: 'status', direction: 'desc' }],
        teamScope: { teamIds: ['team-revenue'] },
      }),
      { wrapper: overlayWrapper },
    )

    expect(result.current[0].sorts).toEqual([{ attributeId: 'first-name', direction: 'asc' }])
    expect(result.current[0].teamScope).toEqual({ teamIds: ['team-revenue'] })
  })

  it('keeps change-highlight settings local instead of serializing them', () => {
    const { result } = renderHook(
      () => {
        const [config, updateConfig] = useViewConfig(attributes)
        return { config, updateConfig, search: useLocation().search }
      },
      { wrapper },
    )

    expect(createViewConfig(attributes).changeHighlight).toEqual({ mode: 'off', days: 7, onlyChangedRows: false })

    act(() => {
      result.current.updateConfig((current) => ({
        ...current,
        changeHighlight: { mode: 'on', days: 30, onlyChangedRows: true },
      }))
    })

    expect(result.current.config.changeHighlight).toEqual({ mode: 'on', days: 30, onlyChangedRows: true })
    expect(result.current.search).toContain('v=')
    expect(result.current.search).not.toContain('changeHighlight')
  })

  it('keeps display-only grid controls live in the route config', () => {
    const { result } = renderHook(() => useViewConfig(attributes), { wrapper })

    act(() => {
      result.current[1]((current) => ({
        ...current,
        columns: [
          { attributeId: 'status', visible: true, order: 0 },
          { attributeId: 'first-name', visible: false, order: 1 },
        ],
        groupBy: [{ attributeId: 'status', direction: 'asc' }],
        frozenRows: 2,
        frozenCols: 2,
        gridLines: false,
        columnWidths: { status: 240 },
      }))
    })

    const config = result.current[0]
    expect(config.columns).toEqual([
      { attributeId: 'status', visible: true, order: 0 },
      { attributeId: 'first-name', visible: false, order: 1 },
    ])
    expect(config.groupBy).toEqual([{ attributeId: 'status', direction: 'asc' }])
    expect(config.frozenRows).toBe(2)
    expect(config.frozenCols).toBe(2)
    expect(config.gridLines).toBe(false)
    expect(config.columnWidths).toEqual({ status: 240 })
  })

  it('moves a named column group as one contiguous unit', () => {
    const columns = [
      { attributeId: 'first-name', visible: true, order: 0, group: 'Name', collapsed: false },
      { attributeId: 'status', visible: true, order: 1 },
      { attributeId: 'owner', visible: true, order: 2, group: 'Assignment', collapsed: false },
      { attributeId: 'title', visible: true, order: 3, group: 'Name', collapsed: false },
    ]

    expect(reorderColumnGroup(columns, 'Assignment', 'Name')).toEqual([
      { attributeId: 'owner', visible: true, order: 0, group: 'Assignment', collapsed: false },
      { attributeId: 'first-name', visible: true, order: 1, group: 'Name', collapsed: false },
      { attributeId: 'title', visible: true, order: 2, group: 'Name', collapsed: false },
      { attributeId: 'status', visible: true, order: 3 },
    ])
    expect(reorderColumnGroup(columns, 'Name', 'Assignment')).toEqual([
      { attributeId: 'status', visible: true, order: 0 },
      { attributeId: 'owner', visible: true, order: 1, group: 'Assignment', collapsed: false },
      { attributeId: 'first-name', visible: true, order: 2, group: 'Name', collapsed: false },
      { attributeId: 'title', visible: true, order: 3, group: 'Name', collapsed: false },
    ])
  })

  it('clamps and steps zoom within the Sheets-style preset range', () => {
    expect(clampZoom(100)).toBe(100)
    expect(clampZoom(80)).toBe(80)
    expect(clampZoom(10)).toBe(50)
    expect(clampZoom(500)).toBe(200)
    expect(clampZoom(Number.NaN)).toBe(100)

    expect(stepZoom(100, 1)).toBe(125)
    expect(stepZoom(100, -1)).toBe(90)
    expect(stepZoom(80, 1)).toBe(90)
    expect(stepZoom(80, -1)).toBe(75)
    expect(stepZoom(200, 1)).toBe(200)
    expect(stepZoom(50, -1)).toBe(50)
  })

  it('derives a stable automatic hue from a relation source object id', () => {
    const first = relationSourceHue('company')
    const second = relationSourceHue('company')
    expect(first).toBe(second)
    expect(first).toMatch(/^option-[1-8]$/)
    expect(relationSourceHue(null)).toBeUndefined()
  })

  it('resolves a header colour as manual token, then relation hue, then neutral', () => {
    const relation = { id: 'owner', type: 'user_reference', refObjectId: 'user' } as AttributeDef
    const plain = { id: 'name', type: 'text', refObjectId: null } as AttributeDef

    expect(resolveHeaderColor(relation, [])).toBe(relationSourceHue('user'))
    expect(resolveHeaderColor(plain, [])).toBeUndefined()
    expect(resolveHeaderColor(relation, [{ attributeId: 'owner', headerColor: 'option-3' }])).toBe('option-3')
    expect(resolveHeaderColor(plain, [{ attributeId: 'name', headerColor: 'option-5' }])).toBe('option-5')
  })

  it('sets and clears a manual header colour without touching other columns', () => {
    const styles = [{ attributeId: 'owner', headerColor: 'option-1' }]
    expect(setColumnHeaderColor(styles, 'name', 'option-2')).toEqual([
      { attributeId: 'owner', headerColor: 'option-1' },
      { attributeId: 'name', headerColor: 'option-2' },
    ])
    expect(setColumnHeaderColor(styles, 'owner', 'option-4')).toEqual([{ attributeId: 'owner', headerColor: 'option-4' }])
    expect(setColumnHeaderColor(styles, 'owner', undefined)).toEqual([])
    expect(setColumnHeaderColor([], 'name', undefined)).toEqual([])
  })
})
