import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { updateAvatarMock, useAuthMock, updateOrgMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  updateAvatarMock: vi.fn(),
  useAuthMock: vi.fn(),
  updateOrgMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/orgs', () => ({
  useUpdateOrg: () => ({ mutateAsync: updateOrgMock, isPending: false }),
  useUpdateOrgAvatar: () => ({ mutateAsync: updateAvatarMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_OrganizationTab } from '@/pages/Settings_OrganizationTab'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function mockAuth(overrides: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true, ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
})

describe('Settings_OrganizationTab', () => {
  it('shows the active org name', () => {
    renderWithProviders(<Settings_OrganizationTab />)

    expect(screen.getByLabelText(/Name/)).toHaveValue('Acme')
  })

  it('saves a rename', async () => {
    const user = userEvent.setup()
    updateOrgMock.mockResolvedValue({ org: ORG })
    renderWithProviders(<Settings_OrganizationTab />)

    const input = screen.getByLabelText(/Name/)
    await user.clear(input)
    await user.type(input, 'Acme Freight')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateOrgMock).toHaveBeenCalledWith({ orgId: 'org-a', name: 'Acme Freight' }),
    )
  })

  // "Admin" is per-org. A basic member of THIS org sees the name read-only rather
  // than a Save button that would only come back 403.
  it('locks the field and hides Save for a non-admin of this org', () => {
    mockAuth({ isAdmin: false })

    renderWithProviders(<Settings_OrganizationTab />)

    expect(screen.getByLabelText(/Name/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.getByText('Only an admin can rename this.')).toBeInTheDocument()
  })

  it('surfaces the server message when the save fails', async () => {
    const user = userEvent.setup()
    updateOrgMock.mockRejectedValue(new Error('boom'))
    renderWithProviders(<Settings_OrganizationTab />)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
  })

  it('renders nothing when there is no active org', () => {
    mockAuth({ org: null })

    const { container } = renderWithProviders(<Settings_OrganizationTab />)

    expect(container).toBeEmptyDOMElement()
  })
})
