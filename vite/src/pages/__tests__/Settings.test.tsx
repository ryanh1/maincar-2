import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/pages/Settings_ProfileTab', () => ({
  Settings_ProfileTab: () => <div>profile tab content</div>,
}))
vi.mock('@/pages/Settings_OrganizationTab', () => ({
  Settings_OrganizationTab: () => <div>organization tab content</div>,
}))
vi.mock('@/pages/Settings_MembersTab', () => ({
  Settings_MembersTab: () => <div>members tab content</div>,
}))

import { Settings } from '@/pages/Settings'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function mockAuth(overrides: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true, ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
})

describe('Settings', () => {
  it('shows Profile, Organization, and Members to an admin, defaulting to Profile', () => {
    renderWithProviders(<Settings />)

    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Organization' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByText('profile tab content')).toBeInTheDocument()
  })

  it('renders Devices last without reordering the other settings tabs', () => {
    renderWithProviders(<Settings />)

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Profile',
      'Organization',
      'Members',
      'Phone numbers',
      'Email templates',
      'Integrations',
      'Devices',
    ])
  })

  it('switches tabs on click and updates the URL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings />)

    await user.click(screen.getByRole('button', { name: 'Organization' }))

    expect(screen.getByText('organization tab content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organization' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens directly on the tab named in the URL', () => {
    renderWithProviders(<Settings />, { initialEntries: ['/settings?tab=members'] })

    expect(screen.getByText('members tab content')).toBeInTheDocument()
  })

  it('hides Members from a non-admin of the active org', () => {
    mockAuth({ isAdmin: false })

    renderWithProviders(<Settings />)

    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organization' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument()
  })

  it('falls back to Profile when the URL names a tab hidden from this user', () => {
    mockAuth({ isAdmin: false })

    renderWithProviders(<Settings />, { initialEntries: ['/settings?tab=members'] })

    expect(screen.getByText('profile tab content')).toBeInTheDocument()
  })

  it('hides Organization and Members for a user with no active org', () => {
    mockAuth({ org: null })

    renderWithProviders(<Settings />)

    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Organization' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument()
  })
})
