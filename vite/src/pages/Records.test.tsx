import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { createViewConfig, type ViewConfig } from '@/components/crm/viewConfig'
import { renderWithProviders } from '@/test/utils'

const {
  useDeleteViewMock,
  useDuplicateViewMock,
  useGetObjectMock,
  useGetObjectsMock,
  useGetViewsMock,
  useReorderViewsMock,
  useRestoreViewMock,
  useSaveViewMock,
  useSetDefaultViewMock,
  useUpdateViewMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useDeleteViewMock: vi.fn(),
  useDuplicateViewMock: vi.fn(),
  useGetObjectMock: vi.fn(),
  useGetObjectsMock: vi.fn(),
  useGetViewsMock: vi.fn(),
  useReorderViewsMock: vi.fn(),
  useRestoreViewMock: vi.fn(),
  useSaveViewMock: vi.fn(),
  useSetDefaultViewMock: vi.fn(),
  useUpdateViewMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))
const recordGridMock = vi.hoisted(() => vi.fn())

vi.mock('@/providers/useAuth', () => ({
  useAuth: () => ({ org: { id: 'org-1' } }),
}))

vi.mock('@/hooks/crm', () => ({
  useGetObject: useGetObjectMock,
  useGetObjects: useGetObjectsMock,
}))

vi.mock('@/hooks/savedViews', () => ({
  useGetViews: useGetViewsMock,
  useReorderViews: useReorderViewsMock,
  useDeleteView: useDeleteViewMock,
  useDuplicateView: useDuplicateViewMock,
  useRestoreView: useRestoreViewMock,
  useSaveView: useSaveViewMock,
  useSetDefaultView: useSetDefaultViewMock,
  useUpdateView: useUpdateViewMock,
}))

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock },
}))

vi.mock('@/components/crm/RecordGrid', () => ({
  RecordGrid: (props: {
    viewConfig: ViewConfig
    onViewConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
    toolbarLeading: ReactNode
    createRequestToken?: number
    layout: 'grid' | 'kanban'
    onLayoutChange: (layout: 'grid' | 'kanban') => void
  }) => {
    recordGridMock(props)
    return (
      <>
        {props.toolbarLeading}
        <div role="grid" aria-label="People grid" data-sort={props.viewConfig.sorts.map((sort) => `${sort.attributeId}:${sort.direction}`).join(',')} />
        <button onClick={() => props.onViewConfigChange((current) => ({ ...current, sorts: [{ attributeId: 'name', direction: 'asc' }] }))}>Change sort</button>
        <button onClick={() => props.onLayoutChange('kanban')}>Show Kanban</button>
        <output>{props.layout}</output>
      </>
    )
  },
}))

import { Records } from '@/pages/Records'

function object(overrides: Record<string, unknown> = {}) {
  return {
    id: 'person',
    slug: 'person',
    namePlural: 'People',
    isHidden: false,
    isArchived: false,
    capabilities: { list: true },
    attributes: [],
    ...overrides,
  }
}

function renderRecords(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/records/:slug" element={<><Records /><LocationProbe /></>} />
    </Routes>,
    { initialEntries: [path] },
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}{location.search}</output>
}

describe('Records', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGetViewsMock.mockReturnValue({ data: { views: [] }, isPending: false, isError: false, refetch: vi.fn() })
    useSaveViewMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    useUpdateViewMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    useDuplicateViewMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    useDeleteViewMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    useRestoreViewMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    useReorderViewsMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
    useSetDefaultViewMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
  })

  it('sends the PageHeader New action to a grid that supports creation', async () => {
    const user = userEvent.setup()
    const person = object({ isGridCreateSupported: true })
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })

    renderRecords('/records/person')

    await user.click(screen.getByRole('button', { name: 'New' }))
    expect(recordGridMock).toHaveBeenLastCalledWith(expect.objectContaining({ createRequestToken: 1 }))
  })

  it('loads the supported object grid', () => {
    const person = object()
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })

    renderRecords('/records/person')

    expect(screen.getByRole('grid', { name: 'People grid' })).toBeInTheDocument()
  })

  it.each([
    ['deferred', object({ id: 'email', slug: 'email', namePlural: 'Emails', capabilities: { list: false } })],
    ['hidden', object({ isHidden: true })],
    ['archived', object({ isArchived: true })],
  ])('shows %s objects as unavailable instead of rendering a grid', (_case, unavailable) => {
    useGetObjectsMock.mockReturnValue({ data: { objects: [unavailable] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: undefined, isPending: false, isError: false, refetch: vi.fn() })

    renderRecords(`/records/${unavailable.slug}`)

    expect(screen.getByText('This object is unavailable. Choose another object.')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(useGetObjectMock).toHaveBeenCalledWith('org-1', null)
  })

  it('loads the default saved view and saves or resets edits against it', async () => {
    const user = userEvent.setup()
    const attribute = {
      id: 'name', objectId: 'person', slug: 'name', name: 'Name', description: null,
      icon: null, type: 'text', optionsJson: null, refObjectId: null, formatJson: null,
      validationJson: null, isIdentity: true, storage: 'column', isMulti: false,
      isRequired: false, isUnique: false, isReadOnly: false, isSystem: true,
      defaultJson: null, sortOrder: 0, isArchived: false,
      createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
    }
    const defaultConfig = { ...createViewConfig([attribute]), sorts: [{ attributeId: 'name', direction: 'desc' as const }] }
    const defaultView = {
      id: 'view-1', objectId: 'person', name: 'Newest people', layout: 'grid' as const,
      config: defaultConfig, ownerUserId: 'user-1', isShared: false, isDefault: true, sortOrder: 0,
      createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
    }
    const update = vi.fn().mockResolvedValue({ view: { ...defaultView, config: { ...defaultConfig, sorts: [{ attributeId: 'name', direction: 'asc' as const }] } } })
    const person = object({ attributes: [attribute] })
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })
    useGetViewsMock.mockReturnValue({ data: { views: [defaultView] }, isPending: false, isError: false, refetch: vi.fn() })
    useUpdateViewMock.mockReturnValue({ isPending: false, mutateAsync: update })

    renderRecords('/records/person')

    expect(screen.getByRole('grid', { name: 'People grid' })).toHaveAttribute('data-sort', 'name:desc')
    expect(screen.getByRole('combobox', { name: 'Saved view' })).toHaveTextContent('Newest people')

    await user.click(screen.getByRole('button', { name: 'Change sort' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'People grid' })).toHaveAttribute('data-sort', 'name:desc')

    await user.click(screen.getByRole('button', { name: 'Change sort' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ orgId: 'org-1', viewId: 'view-1', layout: 'grid', config: expect.objectContaining({ sorts: [{ attributeId: 'name', direction: 'asc' }] }) }))
  })

  it('persists a selected Kanban layout on the saved view', async () => {
    const user = userEvent.setup()
    const person = object()
    const view = { id: 'view-1', objectId: 'person', name: 'Deals', layout: 'grid' as const, config: createViewConfig([]), ownerUserId: 'user-1', isShared: false, isDefault: true, sortOrder: 0, createdAt: '', updatedAt: '' }
    const update = vi.fn().mockResolvedValue({ view: { ...view, layout: 'kanban' } })
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })
    useGetViewsMock.mockReturnValue({ data: { views: [view] }, isPending: false, isError: false, refetch: vi.fn() })
    useUpdateViewMock.mockReturnValue({ isPending: false, mutateAsync: update })

    renderRecords('/records/person')
    await user.click(screen.getByRole('button', { name: 'Show Kanban' }))

    expect(screen.getByText('kanban')).toBeInTheDocument()
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', viewId: 'view-1', layout: 'kanban' })))
  })

  it('falls back to the object default when a bookmarked view is no longer visible', async () => {
    const person = object()
    const defaultView = {
      id: 'default', objectId: 'person', name: 'Default people', layout: 'grid' as const,
      config: createViewConfig([]), ownerUserId: 'user-1', isShared: false, isDefault: true, sortOrder: 0,
      createdAt: '', updatedAt: '',
    }
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })
    useGetViewsMock.mockReturnValue({ data: { views: [defaultView] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() })

    renderRecords('/records/person?viewId=made-personal')

    expect(screen.getByRole('combobox', { name: 'Saved view' })).toHaveTextContent('Default people')
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('This saved view is no longer available. Showing the default view for this organization.'))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/records/person')
  })

  it('writes the selected saved view to the URL so it can be reopened', async () => {
    const user = userEvent.setup()
    const person = object()
    const defaultView = { id: 'default', objectId: 'person', name: 'Default people', layout: 'grid' as const, config: createViewConfig([]), ownerUserId: 'user-1', isShared: false, isDefault: true, sortOrder: 0, createdAt: '', updatedAt: '' }
    const sharedView = { ...defaultView, id: 'team', name: 'Team pipeline', isShared: true, isDefault: false }
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })
    useGetViewsMock.mockReturnValue({ data: { views: [defaultView, sharedView] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() })

    renderRecords('/records/person')

    await user.click(screen.getByRole('combobox', { name: 'Saved view' }))
    await user.click(screen.getByRole('option', { name: 'Team pipeline' }))

    expect(screen.getByLabelText('Current route')).toHaveTextContent('/records/person?viewId=team')
  })

  it('keeps a newly saved view selected until the refreshed switcher includes it', async () => {
    const user = userEvent.setup()
    const attribute = { id: 'name', objectId: 'person', slug: 'name', name: 'Name', description: null, icon: null, type: 'text', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null, isIdentity: true, storage: 'column', isMulti: false, isRequired: false, isUnique: false, isReadOnly: false, isSystem: true, defaultJson: null, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' }
    const person = object({ attributes: [attribute] })
    const savedView = { id: 'saved', objectId: 'person', name: 'My new view', layout: 'grid' as const, config: createViewConfig([attribute]), ownerUserId: 'user-1', isShared: false, isDefault: false, sortOrder: 0, createdAt: '', updatedAt: '' }
    const save = vi.fn().mockResolvedValue({ view: savedView })
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })
    useGetViewsMock.mockReturnValue({ data: { views: [] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() })
    useSaveViewMock.mockReturnValue({ isPending: false, mutateAsync: save })

    renderRecords('/records/person')

    await user.click(screen.getByRole('button', { name: 'Change sort' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('Current route')).toHaveTextContent('viewId=saved')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
