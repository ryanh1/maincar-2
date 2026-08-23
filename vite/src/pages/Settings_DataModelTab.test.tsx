import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetObjectsMock,
  useGetObjectMock,
  useUpdateAttributeMock,
  useCreateObjectMock,
  useUpdateObjectMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetObjectsMock: vi.fn(),
  useGetObjectMock: vi.fn(),
  useUpdateAttributeMock: vi.fn(),
  useCreateObjectMock: vi.fn(),
  useUpdateObjectMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/crm', () => ({
  useGetObjects: useGetObjectsMock,
  useGetObject: useGetObjectMock,
  useUpdateAttribute: useUpdateAttributeMock,
  useCreateObject: useCreateObjectMock,
  useUpdateObject: useUpdateObjectMock,
}))
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }))

import { Settings_DataModelTab } from './Settings_DataModelTab'

const ORG = { id: 'org-a', name: 'Acme' }

const objects = [
  { id: 'obj-company', slug: 'company', name: 'Company', namePlural: 'Companies', icon: 'building-2', iconColor: 'option-2', storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: true, capabilities: { list: true }, isHidden: false, isArchived: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
  { id: 'obj-person', slug: 'person', name: 'Person', namePlural: 'People', icon: 'user', iconColor: 'option-1', storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: true, capabilities: { list: true }, isHidden: false, isArchived: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
]

const attributes = [
  { id: 'attr-count', objectId: 'obj-company', slug: 'sizeEmployees', name: 'Employees', description: null, icon: null, type: 'number', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null, isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false, isReadOnly: false, isSystem: true, defaultJson: null, sortOrder: 0, isArchived: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true })
  useGetObjectsMock.mockReturnValue({ isPending: false, isError: false, data: { objects }, refetch: vi.fn() })
  useGetObjectMock.mockReturnValue({ isPending: false, isError: false, data: { object: { ...objects[0], attributes } }, refetch: vi.fn() })
  useUpdateAttributeMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ attribute: attributes[0] }) })
  useCreateObjectMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ object: objects[0] }) })
  useUpdateObjectMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({ object: objects[0] }) })
})

describe('Settings_DataModelTab', () => {
  it('lists fields for the selected object and opens the format editor', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_DataModelTab />)

    await user.click(screen.getByRole('combobox', { name: 'Object' }))
    await user.click(screen.getByRole('option', { name: 'Companies' }))

    expect(screen.getByText('Employees')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Format' }))
    expect(screen.getByText('Format & validation')).toBeInTheDocument()
  })

  it('saves a number format and range through the attribute route', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ attribute: attributes[0] })
    useUpdateAttributeMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_DataModelTab />)

    await user.click(screen.getByRole('combobox', { name: 'Object' }))
    await user.click(screen.getByRole('option', { name: 'Companies' }))
    await user.click(screen.getByRole('button', { name: 'Format' }))

    await user.type(screen.getByLabelText('Minimum'), '1')
    await user.type(screen.getByLabelText('Maximum'), '100')
    await user.click(screen.getByRole('button', { name: 'Save format' }))

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a',
      attributeId: 'attr-count',
      objectId: 'obj-company',
      validationJson: expect.objectContaining({ min: 1, max: 100 }),
    }))
  })

  it('shows each configured object icon in the object selector', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_DataModelTab />)

    await user.click(screen.getByRole('combobox', { name: 'Object' }))

    expect((await screen.findByRole('option', { name: 'Companies' })).querySelector('[data-icon-name="building-2"]')).not.toBeNull()
    expect((await screen.findByRole('option', { name: 'People' })).querySelector('[data-icon-name="user"]')).not.toBeNull()
  })

  it('creates a custom object with a searched icon and shows assigned icons', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ object: { ...objects[0], id: 'obj-project', slug: 'project' } })
    useCreateObjectMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_DataModelTab />)

    await user.click(screen.getByRole('button', { name: 'New object' }))
    await user.type(screen.getByLabelText('Name'), 'Project')
    await user.type(screen.getByLabelText('Plural name'), 'Projects')
    await user.type(screen.getByLabelText('Slug'), 'project')
    await user.click(screen.getByRole('combobox', { name: 'Icon' }))
    expect(screen.getByRole('option', { name: /Building 2, used by Companies/i })).toBeInTheDocument()
    await user.type(screen.getByRole('combobox', { name: 'Search icons' }), 'folder kanban')
    await user.click(await screen.findByRole('option', { name: 'Folder Kanban' }))
    await user.click(screen.getByRole('button', { name: 'Create object' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      orgId: 'org-a', slug: 'project', name: 'Project', namePlural: 'Projects', icon: 'folder-kanban',
    })
  })

  it('edits an object with the icon picker and persists the selection', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ object: objects[0] })
    useUpdateObjectMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_DataModelTab />)

    await user.click(screen.getByRole('combobox', { name: 'Object' }))
    await user.click(screen.getByRole('option', { name: 'Companies' }))
    await user.click(screen.getByRole('button', { name: 'Edit object' }))
    await user.click(screen.getByRole('combobox', { name: 'Icon' }))
    expect(screen.getByRole('option', { name: /Building 2, selected/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /User, used by People/i })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /User, used by People/i }))
    await user.click(screen.getByRole('button', { name: 'Save object' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      orgId: 'org-a', objectId: 'obj-company', name: 'Company', namePlural: 'Companies', icon: 'user',
    })
  })
})
