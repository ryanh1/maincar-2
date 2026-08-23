import { describe, expect, it } from 'vitest'

import {
  applyUrlViewOverlay,
  decodeUrlViewOverlay,
  repairSavedViewConfig,
} from './savedViews.js'

const ATTRIBUTES = [
  { id: 'attr-name', sortOrder: 0, storage: 'column' },
  { id: 'attr-stage', sortOrder: 1, storage: 'custom', type: 'status', optionsJson: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
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

  it('keeps the reusable Team scope when a saved view is reloaded', () => {
    const config = repairSavedViewConfig({
      teamScope: { teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] },
    }, ATTRIBUTES)

    expect(config.teamScope).toEqual({ teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] })
  })

  it('retains named column groups and their collapsed state in persisted view config', () => {
    const config = repairSavedViewConfig({
      columns: [
        { attributeId: 'attr-name', visible: true, order: 0, group: 'Identity', collapsed: true },
        { attributeId: 'attr-stage', visible: true, order: 1, group: 'Identity', collapsed: true },
      ],
    }, ATTRIBUTES)

    expect(config.columns).toEqual([
      { attributeId: 'attr-name', visible: true, order: 0, group: 'Identity', collapsed: true },
      { attributeId: 'attr-stage', visible: true, order: 1, group: 'Identity', collapsed: true },
    ])
  })

  it('retains the builder operators that expand into the record-list query at runtime', () => {
    const config = repairSavedViewConfig({
      filterTree: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', attributeId: 'attr-name', operator: 'between', value: ['10', '20'] },
          { type: 'condition', attributeId: 'attr-stage', operator: 'not_in', value: ['new', 'won'] },
        ],
      },
    }, ATTRIBUTES)

    expect(config.filterTree).toEqual({
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', attributeId: 'attr-name', operator: 'between', value: ['10', '20'] },
        { type: 'condition', attributeId: 'attr-stage', operator: 'not_in', value: ['new', 'won'] },
      ],
    })
  })

  it('retains a valid Kanban config and removes stale attributes and option values', () => {
    const config = repairSavedViewConfig({
      kanban: {
        groupAttributeId: 'attr-stage',
        visibleOptionValues: ['open', 'missing-option', 'closed', 'open'],
        cardAttributeIds: ['attr-name', 'missing-field', 'attr-name'],
        hiddenTerminalOptionValues: ['closed', 'missing-option', 'closed'],
      },
    }, ATTRIBUTES)

    expect(config.kanban).toEqual({
      groupAttributeId: 'attr-stage',
      visibleOptionValues: ['open', 'closed'],
      cardAttributeIds: ['attr-name'],
      hiddenTerminalOptionValues: ['closed'],
    })
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

  it('restores Team scope ids from a URL overlay without accepting CRM filter literals', () => {
    const encoded = Buffer.from(JSON.stringify({
      version: 1,
      teamScope: { teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] },
    })).toString('base64url')

    const resolved = applyUrlViewOverlay(repairSavedViewConfig({}, ATTRIBUTES), decodeUrlViewOverlay(encoded, ATTRIBUTES))

    expect(resolved.teamScope).toEqual({ teamIds: ['team-revenue'], leadUserIds: ['user-jordan'] })
  })
})
