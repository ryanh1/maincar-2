import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))

import { Home } from '@/pages/Home'

const ORG = { id: 'org-1', name: 'Acme' }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({
    user: { firstName: 'Ann', email: 'ann@acme.test', timeZone: 'America/New_York' },
    org: ORG,
    memberships: [{ orgId: 'org-1', org: ORG, roles: ['admin'] }],
  })
})

describe('Home', () => {
  it('opens with the page header and greets the signed-in user', () => {
    renderWithProviders(<Home />)

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByText('Welcome back, Ann')).toBeInTheDocument()
  })

  it("shows the active org, email, role, and time zone in the account card", () => {
    renderWithProviders(<Home />)

    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('ann@acme.test')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('America/New_York')).toBeInTheDocument()
  })

  it('falls back to plain placeholders when the user has no org yet', () => {
    useAuthMock.mockReturnValue({
      user: { email: 'ann@acme.test' },
      org: null,
      memberships: [],
    })

    renderWithProviders(<Home />)

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getAllByText('Not set yet')).toHaveLength(2)
    expect(screen.getByText('No org yet')).toBeInTheDocument()
  })
})
