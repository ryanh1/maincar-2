import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetMembersMock,
  useGetInvitationsMock,
  createInvitationMock,
  revokeInvitationMock,
  regenerateInvitationMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetMembersMock: vi.fn(),
  useGetInvitationsMock: vi.fn(),
  createInvitationMock: vi.fn(),
  revokeInvitationMock: vi.fn(),
  regenerateInvitationMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/orgs', () => ({
  useGetMembers: useGetMembersMock,
  useGetInvitations: useGetInvitationsMock,
  useCreateInvitation: () => ({ mutateAsync: createInvitationMock, isPending: false }),
  useRevokeInvitation: () => ({ mutateAsync: revokeInvitationMock, isPending: false }),
  useRegenerateInvitation: () => ({ mutateAsync: regenerateInvitationMock, isPending: false }),
  memberDisplayName: (m: { firstName?: string; lastName?: string; email: string }) =>
    [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_MembersTab } from '@/pages/Settings_MembersTab'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

const MEMBERS = {
  members: [
    {
      id: 'user-a',
      email: 'al@acme.com',
      firstName: 'Al',
      lastName: 'Pha',
      title: null,
      imageUrl: null,
      enabled: true,
      roles: ['admin'],
      joinedAt: '',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
}

const INVITATION = {
  id: 'inv-1',
  email: 'new@acme.com',
  roles: ['basic'],
  status: 'PENDING',
  expiresAt: '2026-09-03T16:00:00.000Z',
  inviteUrl: 'http://localhost:5183/join/tok-1',
  createdAt: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({
    user: { timeZone: 'America/New_York' },
    org: ORG,
    isAdmin: true,
  })
  useGetMembersMock.mockReturnValue({ data: MEMBERS, isPending: false, isError: false })
  useGetInvitationsMock.mockReturnValue({ data: [INVITATION], isPending: false, isError: false })
})

describe('Settings_MembersTab', () => {
  it('lists the members with their role in this org', () => {
    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Al Pha')).toBeInTheDocument()
    // The raw role value is never shown (CLAUDE.md → Role Display Labels).
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByText('admin')).not.toBeInTheDocument()
  })

  it('shows a loading state while members load', () => {
    useGetMembersMock.mockReturnValue({ data: undefined, isPending: true, isError: false })

    renderWithProviders(<Settings_MembersTab />)

    expect(screen.queryByText('Al Pha')).not.toBeInTheDocument()
  })

  it('shows an actionable error when members fail to load', () => {
    useGetMembersMock.mockReturnValue({ data: undefined, isPending: false, isError: true })

    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Could not load members. Refresh to retry.')).toBeInTheDocument()
  })

  it('creates an invite', async () => {
    const user = userEvent.setup()
    createInvitationMock.mockResolvedValue({ invitation: INVITATION })
    renderWithProviders(<Settings_MembersTab />)

    await user.type(screen.getByLabelText('Email'), 'new@acme.com')
    await user.click(screen.getByRole('button', { name: 'Create invite' }))

    await waitFor(() =>
      expect(createInvitationMock).toHaveBeenCalledWith({
        orgId: 'org-a',
        email: 'new@acme.com',
      }),
    )
  })

  // No mail is sent yet, so the UI must not claim one was.
  it('says the admin has to send the link, rather than claiming an email went out', () => {
    renderWithProviders(<Settings_MembersTab />)

    expect(
      screen.getByText('Maincar does not send the email yet. Copy the link and send it yourself.'),
    ).toBeInTheDocument()
  })

  it('hides the invite form from a non-admin of this org', () => {
    useAuthMock.mockReturnValue({ org: ORG, isAdmin: false })

    renderWithProviders(<Settings_MembersTab />)

    expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument()
    // Members are still visible — reading the roster is not an admin action.
    expect(screen.getByText('Al Pha')).toBeInTheDocument()
  })

  it('revokes an invite only after the confirm dialog is accepted', async () => {
    const user = userEvent.setup()
    revokeInvitationMock.mockResolvedValue({})
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: /Revoke the invite for new@acme.com/ }))

    // The dialog is up, and nothing has been revoked yet.
    expect(await screen.findByText('Revoke this invite?')).toBeInTheDocument()
    expect(revokeInvitationMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(revokeInvitationMock).toHaveBeenCalledWith({ orgId: 'org-a', invitationId: 'inv-1' }),
    )
  })

  it('does not revoke when the confirm dialog is cancelled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: /Revoke the invite for new@acme.com/ }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(revokeInvitationMock).not.toHaveBeenCalled()
  })

  // Regenerate has no confirm dialog on purpose: the admin presses it BECAUSE the
  // old link is a problem, so killing it immediately is the point, not a risk.
  it('regenerates the link on one press', async () => {
    const user = userEvent.setup()
    regenerateInvitationMock.mockResolvedValue({ invitation: INVITATION })
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: /Create a new link for new@acme.com/ }))

    await waitFor(() =>
      expect(regenerateInvitationMock).toHaveBeenCalledWith({
        orgId: 'org-a',
        invitationId: 'inv-1',
      }),
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('New link created. The old link no longer works.')
  })

  // Every time-of-day carries its zone label (CLAUDE.md → Dates & Times), and the
  // zone is the VIEWING user's, not the browser's.
  it('shows the expiry in the viewing user\'s timezone, with the zone named', () => {
    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText(/expires Sep 3, 2026, 12:00 PM EDT/)).toBeInTheDocument()
  })
})
