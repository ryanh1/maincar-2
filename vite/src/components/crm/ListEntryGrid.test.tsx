import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import type { AttributeDef, CrmListEntry } from '@/lib/crmTypes'

const { dataEditorProps } = vi.hoisted(() => ({ dataEditorProps: { current: null as Record<string, unknown> | null } }))

vi.mock('@glideapps/glide-data-grid', async (importActual) => {
  const actual = await importActual<typeof import('@glideapps/glide-data-grid')>()
  return {
    ...actual,
    DataEditor: (props: Record<string, unknown>) => {
      dataEditorProps.current = props
      return <div role="grid" aria-label="List entries" />
    },
  }
})

vi.mock('@/providers/useAuth', () => ({ useAuth: () => ({ user: { timeZone: 'America/New_York' } }) }))

import { ListEntryGrid } from './ListEntryGrid'

function attribute(overrides: Partial<AttributeDef>): AttributeDef {
  return {
    id: 'attribute-1', objectId: 'object-1', slug: 'name', name: 'Name', description: null, icon: null,
    type: 'text', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null,
    isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
    isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0, isArchived: false,
    createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
    ...overrides,
  }
}

const entry: CrmListEntry = {
  id: 'entry-1', listId: 'list-1', objectSlug: 'person', targetId: 'person-1', values: { priority: 'High' }, position: 0,
  addedByUserId: 'user-1', createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
  target: { id: 'person-1', createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z', name: 'Ada Lovelace' },
}

describe('ListEntryGrid', () => {
  it('shows list-only values and opens removal for the clicked membership', () => {
    const onRemoveEntry = vi.fn()
    render(
      <ListEntryGrid
        attributes={[attribute({ slug: 'name', name: 'Name' }), attribute({ id: 'priority', slug: 'priority', name: 'Priority', storage: 'list', sortOrder: 1 })]}
        entries={[entry]}
        totalCount={1}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        onRemoveEntry={onRemoveEntry}
      />,
    )

    const props = dataEditorProps.current as {
      columns: Array<{ title: string }>
      getCellContent: (cell: readonly [number, number]) => { displayData?: string }
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
    }
    expect(props.columns.map((column) => column.title)).toEqual(['Name', 'Priority', 'Remove'])
    expect(props.getCellContent([1, 0]).displayData).toBe('High')

    props.onCellClicked([2, 0], {})
    expect(onRemoveEntry).toHaveBeenCalledWith(entry)
  })

  it('keeps the no-fields state when the list object has no attributes', () => {
    render(
      <ListEntryGrid
        attributes={[]}
        entries={[entry]}
        totalCount={1}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        onRemoveEntry={vi.fn()}
      />,
    )

    expect(document.body).toHaveTextContent('This list’s object has no fields yet.')
  })

  it('writes a list field through the membership callback without changing the target record', () => {
    const onUpdateEntry = vi.fn()
    render(
      <ListEntryGrid
        orgId="org-1"
        attributes={[attribute({ slug: 'name', name: 'Name' }), attribute({ id: 'priority', slug: 'priority', name: 'Priority', storage: 'list', sortOrder: 1 })]}
        entries={[entry]}
        totalCount={1}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn()}
        onRemoveEntry={vi.fn()}
        onUpdateEntry={onUpdateEntry}
      />,
    )

    const props = dataEditorProps.current as { onCellEdited: (cell: readonly [number, number], value: { kind: string; data: string }) => void }
    props.onCellEdited([1, 0], { kind: 'text', data: 'Urgent' })

    expect(onUpdateEntry).toHaveBeenCalledWith(entry, { priority: 'Urgent' })
  })
})
