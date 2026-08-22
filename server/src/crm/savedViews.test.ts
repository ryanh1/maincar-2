import { describe, expect, it } from 'vitest'

import {
  applyUrlViewOverlay,
  decodeUrlViewOverlay,
  repairSavedViewConfig,
} from './savedViews.js'

const ATTRIBUTES = [
  { id: 'attr-name', sortOrder: 0, storage: 'column' },
  { id: 'attr-stage', sortOrder: 1, storage: 'custom' },
  { id: 'attr-archived', sortOrder: 2, storage: 'custom', isArchived: true },
]

describe('repairSavedViewConfig', () => {
  it('migrates legacy config and repairs deleted attributes without retaining unknown state', () => {
    const config = repairSavedViewConfig({
      columns: [
        { attributeId: 'deleted-attribute', visible: true, order: 0 },
        { attributeId: 'attr-name', visible: false, order: 1 },
      ],
      sorts: [{ attributeId: 'deleted-attribute', direction: 'asc' }],
      columnWidths: { 'attr-name': 200, 'deleted-attribute': 200 },
      ignoredByCurrentSchema: 'discard me',
    }, ATTRIBUTES)

    expect(config.version).toBe(1)
    expect(config.columns).toEqual([
      { attributeId: 'attr-name', visible: false, order: 0 },
      { attributeId: 'attr-stage', visible: true, order: 1 },
    ])
    expect(config.sorts).toEqual([])
    expect(config.columnWidths).toEqual({ 'attr-name': 200 })
  })
})

describe('decodeUrlViewOverlay', () => {
  it('overlays only allow-listed fields supplied by the URL, preserving saved fields that were not supplied', () => {
    const encoded = Buffer.from(JSON.stringify({ version: 1, sorts: [{ attributeId: 'attr-stage', direction: 'desc' }] })).toString('base64url')
    const overlay = decodeUrlViewOverlay(encoded, ATTRIBUTES)
    const persisted = repairSavedViewConfig({
      columns: [{ attributeId: 'attr-name', visible: false, order: 0 }],
      rowHeight: 'tall',
    }, ATTRIBUTES)

    const resolved = applyUrlViewOverlay(persisted, overlay)

    expect(resolved.sorts).toEqual([{ attributeId: 'attr-stage', direction: 'desc' }])
    expect(resolved.columns).toEqual(persisted.columns)
    expect(resolved.rowHeight).toBe('tall')
  })

  it('discards an overlay containing a filter literal so a URL can never carry CRM values or PII', () => {
    const encoded = Buffer.from(JSON.stringify({
      version: 1,
      filterTree: { type: 'condition', attributeId: 'attr-name', operator: 'eq', value: 'person@example.test' },
    })).toString('base64url')

    expect(decodeUrlViewOverlay(encoded, ATTRIBUTES)).toBeUndefined()
  })
})
