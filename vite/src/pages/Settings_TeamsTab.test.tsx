import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiError } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetTeamsMock,
  useGetMembersMock,
  createTeamMock,
  updateTeamMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetTeamsMock: vi.fn(),
  useGetMembersMock: vi.fn(),
  createTeamMock: vi.fn(),
  updateTeamMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/orgs', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/orgs/types')>('@/hooks/orgs/types')
  return { ...actual, useGetMembers: useGetMembersMock }
})
vi.mock('@/hooks/teams', () => ({
  useGetTeams: useGetTeamsMock,
  useCreateTeam: () => ({ mutateAsync: createTeamMock, isPending: false }),
  useUpdateTeam: () => ({ mutateAsync: updateTeamMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_TeamsTab } from '@/pages/Settings_TeamsTab'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function member(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-a',
    email: 'al@acme.com',
    firstName: 'Al',
    lastName: 'Pha',
    title: 'Rep',
    imageUrl: null,
    avatarUrl: null,
    enabled: true,
    roles: ['basic'],
    joinedAt: '2026-08-01T00:00:00.000Z',
    isSelf: false,
    ...overrides,
  }
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-a',
    orgId: 'org-a',
    name: 'Revenue',
    leadUserId: 'user-a',
    isArchived: false,
    archivedAt: null,
    memberUserIds: ['user-a', 'user-b'],
    members: [
      { userId: 'user-a', email: 'al@acme.com', firstName: 'Al', lastName: 'Pha', title: 'Rep' },
      { userId: 'user-b', email: 'bea@acme.com', firstName: 'Bea', lastName: 'Two', title: 'AE' },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function teamsState(overrides: Record<string, unknown> = {}) {
  return {
    data: { teams: [team()], total: 1, page: 1, limit: 25 },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG })
  useGetTeamsMock.mockReturnValue(teamsState())
  useGetMembersMock.mockReturnValue({
    data: { members: [member(), member({ userId: 'user-b', email: 'bea@acme.com', firstName: 'Bea', lastName: 'Two' })] },
  })
  createTeamMock.mockResolvedValue({ team: team() })
  updateTeamMock.mockResolvedValue({ team: team() })
})

describe('Settings teams', () => {
  it('shows a server-paged list with team context and opens its detail drawer', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_TeamsTab />)

    expect(screen.getByRole('columnheader', { name: 'Team' }).closest('tr')).toHaveClass('bg-surface')
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('Al Pha')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Avatar for Al Pha')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Open Revenue' }))
    expect(screen.getByRole('dialog', { name: 'Revenue' })).toBeInTheDocument()
    expect(screen.getByText('Team lead')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit team' })).toBeInTheDocument()
  })

  it('shows loading, error, and action-oriented empty states', async () => {
    useGetTeamsMock.mockReturnValue(teamsState({ data: undefined, isPending: true }))
    const first = renderWithProviders(<Settings_TeamsTab />)
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
    first.unmount()

    const refetch = vi.fn()
    useGetTeamsMock.mockReturnValue(teamsState({ data: undefined, isError: true, refetch }))
    const second = renderWithProviders(<Settings_TeamsTab />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    second.unmount()

    useGetTeamsMock.mockReturnValue(teamsState({ data: { teams: [], total: 0, page: 1, limit: 25 } }))
    renderWithProviders(<Settings_TeamsTab />)
    expect(screen.getByText('Create a team to organize your roster.')).toBeInTheDocument()
  })

  it('opens edit mode directly from the team menu', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_TeamsTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Revenue' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit team' }))

    expect(screen.getByLabelText('Team name')).toHaveValue('Revenue')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('validates create input and adds the selected lead to the roster', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_TeamsTab />)

    await user.click(screen.getByRole('button', { name: 'Create team' }))
    await user.click(screen.getByRole('button', { name: 'Create team', exact: true }))
    expect(screen.getByText('Enter a team name.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Team name'), 'Enterprise')
    await user.click(screen.getByLabelText('Team lead'))
    await user.click(await screen.findByRole('option', { name: 'Al Pha' }))
    await user.click(screen.getByRole('button', { name: 'Create team', exact: true }))

    await waitFor(() =>
      expect(createTeamMock).toHaveBeenCalledWith({
        orgId: 'org-a',
        name: 'Enterprise',
        leadUserId: 'user-a',
        memberUserIds: ['user-a'],
      }),
    )
  })

  it('explains archive consequences and recovers an archived team', async () => {
    const user = userEvent.setup()
    const active = renderWithProviders(<Settings_TeamsTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Revenue' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive team' }))
    expect(screen.getByText(/People and CRM records are kept/)).toBeInTheDocument()
    expect(screen.getByText(/filters stop matching/)).toBeInTheDocument()
    expect(screen.getByText(/recover it for 30 days/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archive team', exact: true }))
    await waitFor(() => expect(updateTeamMock).toHaveBeenCalledWith({ orgId: 'org-a', teamId: 'team-a', isArchived: true }))

    active.unmount()
    useGetTeamsMock.mockReturnValue(teamsState({ data: { teams: [team({ isArchived: true })], total: 1, page: 1, limit: 25 } }))
    renderWithProviders(<Settings_TeamsTab />, { initialEntries: ['/settings?archived=true'] })
    await user.click(screen.getByRole('button', { name: 'Show actions for Revenue' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Recover team' }))
    await waitFor(() => expect(updateTeamMock).toHaveBeenCalledWith({ orgId: 'org-a', teamId: 'team-a', isArchived: false }))
  })

  it('surfaces a failed save to the member who made the change', async () => {
    createTeamMock.mockRejectedValue(new ApiError('Could not save this team.', 422))
    const user = userEvent.setup()
    renderWithProviders(<Settings_TeamsTab />)

    await user.click(screen.getByRole('button', { name: 'Create team' }))
    await user.type(screen.getByLabelText('Team name'), 'Enterprise')
    await user.click(screen.getByLabelText('Team lead'))
    await user.click(await screen.findByRole('option', { name: 'Al Pha' }))
    await user.click(screen.getByRole('button', { name: 'Create team', exact: true }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not save this team.'))
  })
})
