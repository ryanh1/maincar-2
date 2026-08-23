import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'
import { RecordPeekDrawer } from './RecordPeekDrawer'

vi.mock('@/hooks/crm', () => ({ useGetActivity: () => ({ isPending: false, isError: false, data: undefined }) }))
vi.mock('./RecordNoteComposer', () => ({ RecordNoteComposer: () => null }))

const object: ObjectDef = {
  id: 'people', slug: 'person', name: 'Person', namePlural: 'People', icon: null, iconColor: null,
  storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: true,
  capabilities: { list: true }, isHidden: false, isArchived: false,
  createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
}

function attribute(overrides: Partial<AttributeDef>): AttributeDef {
  return {
    id: overrides.slug ?? 'attr', objectId: 'people', slug: 'field', name: 'Field', description: null,
    icon: null, type: 'text', optionsJson: null, refObjectId: null, formatJson: null,
    validationJson: null, isIdentity: false, storage: 'column', isMulti: false, isRequired: false,
    isUnique: false, isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0,
    isArchived: false, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

describe('RecordPeekDrawer', () => {
  it('offers a full-page record view', () => {
    const onOpenFullPage = vi.fn()
    render(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={[attribute({ slug: 'name', name: 'Name', isIdentity: true })]} record={{ id: 'person-1', name: 'Ada', createdAt: '', updatedAt: '' }} timeZone="America/New_York" position={null} onEdit={vi.fn()} onOpenFullPage={onOpenFullPage} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand to full page' }))

    expect(onOpenFullPage).toHaveBeenCalledOnce()
  })

  it('saves a field and focuses the next editable field when Tab is pressed', () => {
    const onEdit = vi.fn()
    const attributes = [
      attribute({ slug: 'name', name: 'Name', isIdentity: true, sortOrder: 0 }),
      attribute({ slug: 'role', name: 'Role', sortOrder: 1 }),
      attribute({ slug: 'city', name: 'City', sortOrder: 2 }),
    ]
    const record: RecordRow = {
      id: 'person-1', name: 'Ada', role: 'Engineer', city: 'London',
      createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    }

    render(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={attributes} record={record} timeZone="America/New_York" position={null} onEdit={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Engineer' }))
    const input = screen.getByRole('textbox', { name: 'Role' })
    fireEvent.change(input, { target: { value: 'Manager' } })
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'role' }), 'Manager')
    expect(screen.getByRole('button', { name: 'London' })).toHaveFocus()
  })
})
