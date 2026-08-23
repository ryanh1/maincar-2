import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetObjectsMock,
  useGetObjectMock,
  useUpdateAttributeMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetObjectsMock: vi.fn(),
  useGetObjectMock: vi.fn(),
  useUpdateAttributeMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/crm', () => ({
  useGetObjects: useGetObjectsMock,
  useGetObject: useGetObjectMock,
  useUpdateAttribute: useUpdateAttributeMock,
}))
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }))

import { Settings_DataModelTab } from './Settings_DataModelTab'

const ORG = { id: 'org-a', name: 'Acme' }

const objects = [
  { id: 'obj-company', slug: 'company', name: 'Company', namePlural: 'Companies', icon: null, iconColor: null, storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: true, capabilities: { list: true }, isHidden: false, isArchived: false, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
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
})
