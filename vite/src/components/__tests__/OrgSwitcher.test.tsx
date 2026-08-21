import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

// vi.hoisted() makes the mock fns, vi.mock() swaps the modules, and the component
// is imported AFTER both so the mocks are in place when its graph loads.
const { useAuthMock, switchOrgMock, createOrgMock, refreshMock, toastErrorMock } = vi.hoisted(
  () => ({
    useAuthMock: vi.fn(),
    switchOrgMock: vi.fn(),
    createOrgMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
)

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/orgs', () => ({
  useSwitchOrg: () => ({ mutateAsync: switchOrgMock, isPending: false }),
  useCreateOrg: () => ({ mutateAsync: createOrgMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

import { OrgSwitcher } from '@/components/OrgSwitcher'

const ORG_A = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }
const ORG_B = { id: 'org-b', name: 'Globex', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function mockAuth(overrides: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({
    org: ORG_A,
    memberships: [
      { orgId: 'org-a', org: ORG_A, roles: ['admin'] },
      { orgId: 'org-b', org: ORG_B, roles: ['basic'] },
    ],
    refresh: refreshMock,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
})

describe('OrgSwitcher', () => {
  it('shows the active org', () => {
    renderWithProviders(<OrgSwitcher />)

    expect(screen.getByRole('button', { name: /Acme/ })).toBeInTheDocument()
  })

  // A user with no org has nothing to switch between, so the control must not
  // render at all rather than render as a dead button.
  it('renders nothing when the user belongs to no org', () => {
    mockAuth({ org: null, memberships: [] })

    const { container } = renderWithProviders(<OrgSwitcher />)

    expect(container).toBeEmptyDOMElement()
  })

  it('lists every org the user belongs to', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrgSwitcher />)

    await user.click(screen.getByRole('button', { name: /Acme/ }))

    expect(await screen.findByRole('menuitem', { name: /Globex/ })).toBeInTheDocument()
  })

  it('switches to the org that was picked', async () => {
    const user = userEvent.setup()
    switchOrgMock.mockResolvedValue({})
    renderWithProviders(<OrgSwitcher />)

    await user.click(screen.getByRole('button', { name: /Acme/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Globex/ }))

    await waitFor(() => expect(switchOrgMock).toHaveBeenCalledWith('org-b'))
  })

  // Re-switching to the org already active would clear the cache for nothing.
  it('does not switch when the active org is picked again', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrgSwitcher />)

    await user.click(screen.getByRole('button', { name: /Acme/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Acme/ }))

    expect(switchOrgMock).not.toHaveBeenCalled()
  })

  it('surfaces an error when the switch fails', async () => {
    const user = userEvent.setup()
    switchOrgMock.mockRejectedValue(new Error('nope'))
    renderWithProviders(<OrgSwitcher />)

    await user.click(screen.getByRole('button', { name: /Acme/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Globex/ }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
  })

  it('creates an org and re-reads the profile so the new one becomes active', async () => {
    const user = userEvent.setup()
    createOrgMock.mockResolvedValue({ org: { id: 'org-c' } })
    refreshMock.mockResolvedValue(undefined)
    renderWithProviders(<OrgSwitcher />)

    await user.click(screen.getByRole('button', { name: /Acme/ }))
    await user.click(await screen.findByRole('menuitem', { name: /New organization/ }))
    await user.type(await screen.findByLabelText('Name'), 'Initech')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createOrgMock).toHaveBeenCalledWith({ name: 'Initech' }))
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })

  it('refuses to create an org with a blank name', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrgSwitcher />)

    await user.click(screen.getByRole('button', { name: /Acme/ }))
    await user.click(await screen.findByRole('menuitem', { name: /New organization/ }))
    await user.click(await screen.findByRole('button', { name: 'Create' }))

    expect(createOrgMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalled()
  })
})
