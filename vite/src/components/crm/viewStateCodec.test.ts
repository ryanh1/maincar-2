import { describe, expect, it } from 'vitest'

import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig } from './viewConfig'
import { decodeViewState, encodeViewState } from './viewStateCodec'

const attributes = [
  { id: 'first-name', slug: 'firstName', name: 'First name', storage: 'scalar', sortOrder: 0 },
  { id: 'status', slug: 'status', name: 'Status', storage: 'scalar', sortOrder: 1 },
  { id: 'archived', slug: 'archived', name: 'Archived', storage: 'scalar', sortOrder: 2, isArchived: true },
] as AttributeDef[]

const config: ViewConfig = {
  columns: [
    { attributeId: 'status', visible: true, order: 0 },
    { attributeId: 'first-name', visible: false, order: 1 },
  ],
  sorts: [{ attributeId: 'first-name', direction: 'asc' }],
  filterTree: {
    type: 'group',
    op: 'and',
    children: [{ type: 'condition', attributeId: 'status', operator: 'contains', value: 'ada@example.com' }],
  },
  groupBy: [{ attributeId: 'status', direction: 'desc' }],
  rowHeight: 'comfortable',
  gridLines: false,
  frozenRows: 2,
  frozenCols: 1,
  zoom: 125,
  columnWidths: { status: 240 },
  columnStyles: [],
  changeHighlight: { mode: 'off', days: 7, onlyChangedRows: false },
}

describe('viewStateCodec', () => {
  it('round-trips the allow-listed live view overlay without filter literals', () => {
    const encoded = encodeViewState(config)

    expect(atob(encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (encoded.length % 4)) % 4))).not.toContain('ada@example.com')
    expect(decodeViewState(encoded, attributes)).toEqual({
      columns: [{ attributeId: 'status', visible: true, order: 0 }],
      sorts: [{ attributeId: 'first-name', direction: 'asc' }],
      filterTree: { type: 'group', op: 'and', children: [{ type: 'condition', attributeId: 'status', operator: 'contains' }] },
      groupBy: [{ attributeId: 'status', direction: 'desc' }],
      rowHeight: 'comfortable',
      gridLines: false,
      frozenRows: 2,
      frozenCols: 1,
      zoom: 125,
    })
  })

  it('silently discards stale identifiers and unsupported operators', () => {
    const encoded = btoa(JSON.stringify({
      version: 1,
      columns: [{ attributeId: 'status', order: 0 }, { attributeId: 'archived', order: 1 }, { attributeId: 'gone', order: 2 }],
      sorts: [{ attributeId: 'gone', direction: 'asc' }, { attributeId: 'first-name', direction: 'desc' }],
      filterTree: {
        type: 'group',
        op: 'or',
        children: [
          { type: 'condition', attributeId: 'gone', operator: 'eq' },
          { type: 'condition', attributeId: 'status', operator: 'unsupported' },
          { type: 'condition', attributeId: 'status', operator: 'is_empty', value: '+15551234567' },
        ],
      },
      groupBy: [{ attributeId: 'archived', direction: 'asc' }],
    })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

    expect(decodeViewState(encoded, attributes)).toEqual({
      columns: [{ attributeId: 'status', visible: true, order: 0 }],
      sorts: [{ attributeId: 'first-name', direction: 'desc' }],
      filterTree: { type: 'group', op: 'or', children: [{ type: 'condition', attributeId: 'status', operator: 'is_empty' }] },
      groupBy: [],
    })
  })

  it('drops malformed and unknown-version fragments', () => {
    expect(decodeViewState('not-base64', attributes)).toEqual({})
    expect(decodeViewState(btoa(JSON.stringify({ version: 2, sorts: [] })), attributes)).toEqual({})
  })
})
