import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'

import type { AttributeDef, ObjectDef, RecordRow, RelatedRecordGroup } from '@/lib/crmTypes'
import { renderWithProviders } from '@/test/utils'
import { RecordPeekDrawer } from './RecordPeekDrawer'

const useGetRelatedRecords = vi.hoisted(() => vi.fn(() => ({ isPending: false, isError: false, data: { related: [] as RelatedRecordGroup[] } })))
const useOutreachLayout = vi.hoisted(() => vi.fn())
const lifecycleMutateAsync = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@/hooks/crm', () => ({
  useGetActivity: () => ({ isPending: false, isError: false, data: undefined }),
  useGetFieldHistory: () => ({ data: { pages: [{ history: [], nextCursor: null }] }, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useGetRelatedRecords,
  useUpdateRecordLifecycle: () => ({ mutateAsync: lifecycleMutateAsync, isPending: false }),
}))
vi.mock('./RecordNoteComposer', () => ({ RecordNoteComposer: () => null }))
vi.mock('@/components/outreachLayout', () => ({ useOutreachLayout }))

beforeEach(() => {
  lifecycleMutateAsync.mockClear()
  useOutreachLayout.mockReturnValue({
    usesRail: false,
    pageRightInsetPx: 0,
    pageBottomInsetPx: 48,
    dialerRightInsetPx: 0,
  })
})

const object: ObjectDef = {
  id: 'people', slug: 'person', name: 'Person', namePlural: 'People', icon: 'user', iconColor: 'option-1',
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
  it('stops before the reserved outreach rail and expanded dialer', () => {
    useOutreachLayout.mockReturnValue({
      usesRail: true,
      pageRightInsetPx: 384,
      pageBottomInsetPx: 0,
      dialerRightInsetPx: 64,
    })

    renderWithProviders(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={[attribute({ slug: 'name', name: 'Name', isIdentity: true })]} record={{ id: 'person-1', name: 'Ada', createdAt: '', updatedAt: '' }} timeZone="America/New_York" position={null} onEdit={vi.fn()} />)

    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveStyle({ right: '384px' })
  })

  it('offers a full-page record view', () => {
    const onOpenFullPage = vi.fn()
    renderWithProviders(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={[attribute({ slug: 'name', name: 'Name', isIdentity: true })]} record={{ id: 'person-1', name: 'Ada', createdAt: '', updatedAt: '' }} timeZone="America/New_York" position={null} onEdit={vi.fn()} onOpenFullPage={onOpenFullPage} />)

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

    renderWithProviders(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={attributes} record={record} timeZone="America/New_York" position={null} onEdit={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Engineer' }))
    const input = screen.getByRole('textbox', { name: 'Role' })
    fireEvent.change(input, { target: { value: 'Manager' } })
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'role' }), 'Manager')
    expect(screen.getByRole('button', { name: 'London' })).toHaveFocus()
  })

  it('mounts field history beside each detail value', () => {
    const attributes = [
      attribute({ slug: 'name', name: 'Name', isIdentity: true }),
      attribute({ slug: 'role', name: 'Role', sortOrder: 1 }),
    ]
    const record: RecordRow = { id: 'person-1', name: 'Ada', role: 'Engineer', createdAt: '', updatedAt: '' }

    renderWithProviders(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={attributes} record={record} timeZone="America/New_York" position={null} onEdit={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Show Role history' })).toBeInTheDocument()
  })

  it('opens related records in a stack, exposes a breadcrumb, and previews on hover', async () => {
    const company: ObjectDef = {
      ...object,
      id: 'companies', slug: 'company', name: 'Company', namePlural: 'Companies',
      icon: 'building-2', iconColor: 'option-2',
      attributes: [attribute({ slug: 'name', name: 'Name', isIdentity: true })],
    }
    const deal: ObjectDef = {
      ...object,
      id: 'deals', slug: 'deal', name: 'Deal', namePlural: 'Deals',
      icon: 'circle-dollar-sign', iconColor: 'option-3',
      attributes: [attribute({ slug: 'name', name: 'Name', isIdentity: true })],
    }
    const companyGroup: RelatedRecordGroup = {
      id: 'outbound:company', label: 'Company', direction: 'outbound', object: company,
      attributeName: 'Company', count: 1,
      records: [{ id: 'company-1', name: 'Acme', createdAt: '', updatedAt: '' }],
    }
    const dealGroup: RelatedRecordGroup = {
      id: 'outbound:deal', label: 'Deal', direction: 'outbound', object: deal,
      attributeName: 'Deal', count: 1,
      records: [{ id: 'deal-1', name: 'Renewal', createdAt: '', updatedAt: '' }],
    }
    useGetRelatedRecords.mockImplementation((_orgId, objectId) => ({
      isPending: false,
      isError: false,
      data: { related: objectId === 'people' ? [companyGroup] : objectId === 'companies' ? [dealGroup] : [] },
    }))
    const person: RecordRow = { id: 'person-1', name: 'Dana', createdAt: '', updatedAt: '' }
    renderWithProviders(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={[attribute({ slug: 'name', name: 'Name', isIdentity: true })]} record={person} timeZone="America/New_York" position={null} onEdit={vi.fn()} />)

    const related = screen.getByRole('button', { name: 'Open Acme' })
    await waitFor(() => expect(screen.getByText('People').parentElement?.querySelector('[data-icon-name="user"]')).not.toBeNull())
    await waitFor(() => expect(screen.getAllByText('Company').some((label) => label.parentElement?.querySelector('[data-icon-name="building-2"]'))).toBe(true))
    fireEvent.mouseEnter(related)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Acme')
    fireEvent.click(related)

    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Record path' })).toHaveTextContent('Dana›Acme')
    fireEvent.click(screen.getByRole('button', { name: 'Open Renewal' }))
    expect(screen.getByRole('heading', { name: 'Renewal' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Renewal' }), { key: 'Escape' })
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Acme' }), { key: 'Escape' })
    expect(screen.getByRole('heading', { name: 'Dana' })).toBeInTheDocument()
  })

  it('shows archived state and can unarchive the record', async () => {
    const attributes = [attribute({ slug: 'name', name: 'Name', isIdentity: true })]
    const record: RecordRow = {
      id: 'person-1', name: 'Ada', isArchived: true,
      createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    }

    renderWithProviders(<RecordPeekDrawer open onOpenChange={vi.fn()} orgId="org-1" object={object} attributes={attributes} record={record} timeZone="America/New_York" position={null} onEdit={vi.fn()} />)

    expect(screen.getByText('Archived')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))

    await waitFor(() => expect(lifecycleMutateAsync).toHaveBeenCalledWith({
      orgId: 'org-1', object, recordId: 'person-1', isArchived: false, confirmArchive: false,
    }))
  })
})
