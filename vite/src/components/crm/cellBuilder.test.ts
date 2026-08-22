import { GridCellKind } from '@glideapps/glide-data-grid'
import { describe, expect, it } from 'vitest'

import type { AttributeDef } from '@/lib/crmTypes'
import { buildGridCell, coerceForType, parseOptions } from './cellBuilder'

function attribute(overrides: Partial<AttributeDef>): AttributeDef {
  return {
    id: overrides.slug ?? 'attr',
    objectId: 'obj-1',
    slug: 'field',
    name: 'Field',
    description: null,
    icon: null,
    type: 'text',
    optionsJson: null,
    refObjectId: null,
    formatJson: null,
    validationJson: null,
    isIdentity: false,
    storage: 'column',
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isReadOnly: false,
    isSystem: false,
    defaultJson: null,
    sortOrder: 0,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('parseOptions', () => {
  it('keeps only well-shaped option entries', () => {
    const options = parseOptions([{ value: 'open', label: 'Open' }, { bogus: true }, null])
    expect(options).toEqual([{ value: 'open', label: 'Open' }])
  })

  it('returns an empty array for a non-array optionsJson', () => {
    expect(parseOptions(null)).toEqual([])
  })
})

describe('buildGridCell', () => {
  it('renders text as an editable Text cell', () => {
    const cell = buildGridCell(attribute({ type: 'text' }), 'Ada', { timeZone: null })
    expect(cell).toMatchObject({ kind: GridCellKind.Text, data: 'Ada', allowOverlay: true, readonly: false })
  })

  it('renders a read-only attribute as a read-only Text cell', () => {
    const cell = buildGridCell(attribute({ type: 'text', isReadOnly: true }), 'Ada', { timeZone: null })
    expect(cell).toMatchObject({ allowOverlay: false, readonly: true })
  })

  it('renders checkbox as a Boolean cell', () => {
    const cell = buildGridCell(attribute({ type: 'checkbox' }), true, { timeZone: null })
    expect(cell).toMatchObject({ kind: GridCellKind.Boolean, data: true })
  })

  it('renders currency as a Number cell formatted to two decimals', () => {
    const cell = buildGridCell(attribute({ type: 'currency' }), 42.5, { timeZone: null })
    expect(cell).toMatchObject({ kind: GridCellKind.Number, data: 42.5, displayData: '42.50' })
  })

  it('renders select as a chip Custom cell carrying the option list', () => {
    const attr = attribute({
      type: 'status',
      optionsJson: [{ value: 'open', label: 'Open', color: '#eee' }],
    })
    const cell = buildGridCell(attr, 'open', { timeZone: null })
    expect(cell.kind).toBe(GridCellKind.Custom)
    if (cell.kind !== GridCellKind.Custom) throw new Error('expected a custom cell')
    expect(cell.data).toMatchObject({ kind: 'chip-cell', selectedValues: ['open'], isMulti: false })
  })

  it('renders a multiselect with every selected value', () => {
    const attr = attribute({
      type: 'multiselect',
      isMulti: true,
      optionsJson: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    })
    const cell = buildGridCell(attr, ['a', 'b'], { timeZone: null })
    if (cell.kind !== GridCellKind.Custom) throw new Error('expected a custom cell')
    expect(cell.data.selectedValues).toEqual(['a', 'b'])
  })

  it('renders a record reference as read-only', () => {
    const cell = buildGridCell(attribute({ type: 'record_reference' }), 'rec_1', { timeZone: null })
    expect(cell).toMatchObject({ readonly: true, allowOverlay: false })
  })

  it('marks a flagged cell with a red-tinted theme override', () => {
    const cell = buildGridCell(attribute({ type: 'phone' }), 'not a phone', { timeZone: null, flagged: true })
    expect(cell).toMatchObject({ data: 'not a phone', themeOverride: { textDark: '#dc2626' } })
  })
})

describe('coerceForType', () => {
  it('coerces a phone using the existing value as the default country', () => {
    const attr = attribute({ type: 'phone' })
    const result = coerceForType(attr, '(202) 555-0123', '+12025550100')
    expect(result).toMatchObject({ ok: true, value: '+12025550123' })
  })

  it('coerces a date', () => {
    const attr = attribute({ type: 'date' })
    expect(coerceForType(attr, '2026-06-24', null)).toMatchObject({ ok: true, value: '2026-06-24' })
  })

  it('flags but keeps an unparseable date', () => {
    const attr = attribute({ type: 'date' })
    const result = coerceForType(attr, 'nope', null)
    expect(result.ok).toBe(false)
    expect(result.value).toBe('nope')
  })

  it('passes plain text straight through', () => {
    const attr = attribute({ type: 'text' })
    expect(coerceForType(attr, 'Ada', null)).toMatchObject({ ok: true, value: 'Ada' })
  })
})
