import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

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

function renderSettings(initialEntry = '/settings/profile') {
  return renderWithProviders(
    <Routes>
      <Route path="/settings/:section" element={<Settings />} />
    </Routes>,
    { initialEntries: [initialEntry] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth()
})

describe('Settings', () => {
  it('shows Profile, Organization, and Members to an admin, defaulting to Profile', () => {
    renderSettings()

    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Organization' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByText('profile tab content')).toBeInTheDocument()
  })

  it('adds Call recordings without reintroducing Devices as a standalone Settings destination', () => {
    renderSettings()

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Profile',
      'Organization',
      'Members',
      'Teams',
      'Phone numbers',
      'Call recordings',
      'Call dispositions',
      'Voicemail greeting',
      'Email templates',
      'Signatures',
      'Integrations',
    ])
    expect(screen.queryByRole('link', { name: 'Devices' })).not.toBeInTheDocument()
  })

  it('switches tabs on click and updates the URL', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('link', { name: 'Organization' }))

    expect(screen.getByText('organization tab content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Organization' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens directly on the tab named in the URL', () => {
    renderSettings('/settings/members')

    expect(screen.getByText('members tab content')).toBeInTheDocument()
  })

  it('hides Members from a non-admin of the active org', () => {
    mockAuth({ isAdmin: false })

    renderSettings()

    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Organization' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument()
  })

  it('falls back to Profile when the path names a section hidden from this user', () => {
    mockAuth({ isAdmin: false })

    renderSettings('/settings/members')

    expect(screen.getByText('profile tab content')).toBeInTheDocument()
  })

  it('hides Organization and Members for a user with no active org', () => {
    mockAuth({ org: null })

    renderSettings()

    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Organization' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument()
  })
})
