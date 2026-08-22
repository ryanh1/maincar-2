// The admin-only org-wide phone number inventory (MAI-197).
//
// What these protect:
//   - loading, error, and empty states each show something actionable
//   - a colleague's number shows their name AND email, not a blank cell
//   - a number nobody holds reads "Unassigned", not blank and not crashed
//   - the unassigned count only shows when it is above zero
import { beforeEach, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

const { useGetOrgNumbersMock, useSetActiveNumberMock, useAuthMock } = vi.hoisted(() => ({
  useGetOrgNumbersMock: vi.fn(),
  useSetActiveNumberMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/phoneNumbers', () => ({
  useGetOrgNumbers: useGetOrgNumbersMock,
  useSetActiveNumber: useSetActiveNumberMock,
  useAssignNumber: () => ({ mutate: vi.fn(), isPending: false }),
}))

import { Settings_PhoneNumbers_OrgTable } from './Settings_PhoneNumbers_OrgTable'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-a', name: 'Acme' }, user: { timeZone: 'America/New_York' } })
  useSetActiveNumberMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

function render() {
  renderWithProviders(<Settings_PhoneNumbers_OrgTable orgId="org-a" />)
}

it('shows a loading skeleton while the inventory is pending', () => {
  useGetOrgNumbersMock.mockReturnValue({ isPending: true, isError: false, data: undefined })

  render()

  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('shows a retry when the inventory fails to load', () => {
  useGetOrgNumbersMock.mockReturnValue({
    isPending: false,
    isError: true,
    data: undefined,
    refetch: vi.fn(),
  })

  render()

  expect(screen.getByText("Could not load the organization's numbers.")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

it('invites action when the org has bought nothing yet', () => {
  useGetOrgNumbersMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { numbers: [], total: 0, unassignedCount: 0 },
  })

  render()

  expect(screen.getByText('Nobody has bought a number yet.')).toBeInTheDocument()
})

it("shows a colleague's name and email on their number, not the caller's own", () => {
  useGetOrgNumbersMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      numbers: [
        {
          id: 'num-1',
          e164: '+12025550123',
          twilioSid: 'PN1',
          status: 'active',
          isActiveForOutbound: false,
          createdAt: '2026-03-01T00:00:00.000Z',
          assignedUser: { id: 'user-b', firstName: 'Bee', lastName: 'Ta', email: 'b@acme.com' },
        },
      ],
      total: 1,
      unassignedCount: 0,
    },
  })

  render()

  expect(screen.getByText('Bee Ta')).toBeInTheDocument()
  expect(screen.getByText('b@acme.com')).toBeInTheDocument()
})

it('reads "Unassigned" for a number nobody holds, and counts it in the header', () => {
  useGetOrgNumbersMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      numbers: [
        {
          id: 'num-2',
          e164: '+12025550124',
          twilioSid: null,
          status: 'active',
          isActiveForOutbound: false,
          createdAt: '2026-03-01T00:00:00.000Z',
          assignedUser: null,
        },
      ],
      total: 1,
      unassignedCount: 1,
    },
  })

  render()

  expect(screen.getByText('Unassigned')).toBeInTheDocument()
  expect(screen.getByText('1 total, 1 unassigned')).toBeInTheDocument()
})

it('omits the unassigned callout once every number has a holder', () => {
  useGetOrgNumbersMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      numbers: [
        {
          id: 'num-3',
          e164: '+12025550125',
          twilioSid: 'PN3',
          status: 'active',
          isActiveForOutbound: true,
          createdAt: '2026-03-01T00:00:00.000Z',
          assignedUser: { id: 'user-a', firstName: 'Al', lastName: 'Pha', email: 'a@acme.com' },
        },
      ],
      total: 1,
      unassignedCount: 0,
    },
  })

  render()

  expect(screen.getByText('1 total')).toBeInTheDocument()
  expect(screen.queryByText(/unassigned/)).not.toBeInTheDocument()
})

it('labels the primary column and does not offer to change a colleague\'s caller ID', () => {
  useGetOrgNumbersMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      numbers: [
        {
          id: 'num-4',
          e164: '+12025550126',
          twilioSid: 'PN4',
          status: 'active',
          isActiveForOutbound: false,
          createdAt: '2026-03-01T00:00:00.000Z',
          assignedUser: { id: 'user-b', firstName: 'Bee', lastName: 'Ta', email: 'b@acme.com' },
        },
      ],
      total: 1,
      unassignedCount: 0,
    },
  })
  useAuthMock.mockReturnValue({
    org: { id: 'org-a', name: 'Acme' },
    user: { id: 'user-a', timeZone: 'America/New_York' },
  })

  render()

  expect(screen.getByRole('columnheader', { name: 'Primary' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Make primary' })).not.toBeInTheDocument()
})
