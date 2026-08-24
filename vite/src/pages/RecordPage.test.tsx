import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

const fixtures = vi.hoisted(() => ({
  saveLayout: vi.fn(),
  object: {
    id: 'people', slug: 'person', name: 'Person', namePlural: 'People', icon: 'user', iconColor: 'option-1',
    storage: 'table' as const, isStandard: true, isFirstClass: true, isGridCreateSupported: true,
    capabilities: { list: true }, isHidden: false, isArchived: false, createdAt: '', updatedAt: '',
  },
  relatedObject: {
    id: 'deals', slug: 'deal', name: 'Deal', namePlural: 'Deals', icon: 'circle-dollar-sign', iconColor: 'option-3',
    storage: 'table' as const, isStandard: true, isFirstClass: true, isGridCreateSupported: true,
    capabilities: { list: true }, isHidden: false, isArchived: false, createdAt: '', updatedAt: '',
  },
  attributes: [
    { id: 'name', objectId: 'people', slug: 'name', name: 'Name', description: null, icon: null, type: 'text' as const, optionsJson: null, refObjectId: null, formatJson: null, validationJson: null, isIdentity: true, storage: 'column' as const, isMulti: false, isRequired: false, isUnique: false, isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
    { id: 'title', objectId: 'people', slug: 'title', name: 'Title', description: null, icon: null, type: 'text' as const, optionsJson: null, refObjectId: null, formatJson: null, validationJson: null, isIdentity: false, storage: 'column' as const, isMulti: false, isRequired: false, isUnique: false, isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 1, isArchived: false, createdAt: '', updatedAt: '' },
  ],
  record: { id: 'person-1', name: 'Ada Lovelace', title: 'Engineer', createdAt: '', updatedAt: '' },
}))

vi.mock('react-router-dom', () => ({ useParams: () => ({ slug: 'person', recordId: 'person-1' }) }))
vi.mock('@/providers/useAuth', () => ({ useAuth: () => ({ org: { id: 'org-1' }, user: { timeZone: 'America/New_York' } }) }))
vi.mock('@/hooks/crm', () => ({
  useGetObjects: () => ({ data: { objects: [fixtures.object, fixtures.relatedObject] }, isPending: false, isError: false }),
  useGetObject: () => ({ data: { object: { ...fixtures.object, attributes: fixtures.attributes } }, isPending: false, isError: false }),
  useListRecords: () => ({ data: { pages: [{ rows: [fixtures.record] }] }, isPending: false, isError: false }),
  useGetActivity: () => ({ data: { activity: [] }, isPending: false, isError: false }),
  useUpdateRecordValue: () => ({ mutateAsync: vi.fn() }),
  useGetDetailLayout: () => ({ data: { layout: { objectId: 'people', isDefault: false, sections: [{ name: 'Details', order: 0, fields: [{ slug: 'name', width: 2 }] }], railObjects: [], feedKinds: [] } }, isPending: false, isError: false }),
  useSaveDetailLayout: () => ({ mutateAsync: fixtures.saveLayout, isPending: false }),
}))

import { RecordPage } from './RecordPage'

describe('RecordPage', () => {
  it('keeps fields locked until edit layout, then saves the layout draft', async () => {
    render(<TooltipProvider><RecordPage /></TooltipProvider>)

    expect(screen.queryByLabelText('Drag Name')).not.toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Show record actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit layout' }))
    expect(screen.getByLabelText('Drag Name')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByLabelText('Drag Name')).not.toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Show record actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit layout' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Deals' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Calls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(fixtures.saveLayout).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', objectId: 'people', sections: expect.any(Array),
      railObjects: ['deal'], feedKinds: ['call'],
    })))
  })

  it('uses the shared field editor for inline record edits', () => {
    render(<TooltipProvider><RecordPage /></TooltipProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada Lovelace')
  })

  it('uses configured object icons in the record header and layout object selector', async () => {
    render(<TooltipProvider><RecordPage /></TooltipProvider>)

    const heading = screen.getByRole('heading', { name: 'Ada Lovelace' })
    await waitFor(() => expect(heading.parentElement?.querySelector('[data-icon-name="user"]')).not.toBeNull())

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Show record actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit layout' }))
    const deals = screen.getByRole('checkbox', { name: 'Deals' }).closest('label')
    await waitFor(() => expect(deals?.querySelector('[data-icon-name="circle-dollar-sign"]')).not.toBeNull())
  })
})
