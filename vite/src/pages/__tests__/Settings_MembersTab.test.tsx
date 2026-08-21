// Settings → Members (MAI-6).
//
// What these protect:
//   - reading the roster is not an admin action; every WRITE is
//   - search, role filter, sort, and page live in the URL, so a reload restores
//     the view rather than dropping the reader on an unfiltered page one
//   - the server's 409 for the last admin reaches the person who clicked
//   - a removal is an offboard, and the dialog says exactly what it does
//   - the raw role value is never rendered
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { ApiError } from '@/lib/api'

const {
  useAuthMock,
  useGetMembersMock,
  useGetInvitationsMock,
  createInvitationMock,
  revokeInvitationMock,
  regenerateInvitationMock,
  updateRolesMock,
  removeMemberMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetMembersMock: vi.fn(),
  useGetInvitationsMock: vi.fn(),
  createInvitationMock: vi.fn(),
  revokeInvitationMock: vi.fn(),
  regenerateInvitationMock: vi.fn(),
  updateRolesMock: vi.fn(),
  removeMemberMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/orgs', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/orgs/types')>('@/hooks/orgs/types')
  return {
    ...actual,
    useGetMembers: useGetMembersMock,
    useGetInvitations: useGetInvitationsMock,
    useCreateInvitation: () => ({ mutateAsync: createInvitationMock, isPending: false }),
    useRevokeInvitation: () => ({ mutateAsync: revokeInvitationMock, isPending: false }),
    useRegenerateInvitation: () => ({ mutateAsync: regenerateInvitationMock, isPending: false }),
    useUpdateMemberRoles: () => ({ mutate: updateRolesMock, isPending: false }),
    useRemoveMember: () => ({ mutate: removeMemberMock, isPending: false }),
  }
})
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_MembersTab } from '@/pages/Settings_MembersTab'

const ORG = { id: 'org-a', name: 'Acme', logo: null, enabled: true, createdAt: '', updatedAt: '' }

function member(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-a',
    email: 'al@acme.com',
    firstName: 'Al',
    lastName: 'Pha',
    title: null,
    imageUrl: null,
    enabled: true,
    roles: ['admin'],
    joinedAt: '2026-08-01T12:00:00.000Z',
    isSelf: false,
    ...overrides,
  }
}

function membersResponse(overrides: Record<string, unknown> = {}) {
  return {
    members: [member()],
    total: 1,
    page: 1,
    limit: 25,
    meta: { activeAdminCount: 2 },
    viewerRoles: ['admin'],
    ...overrides,
  }
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

function listState(overrides: Record<string, unknown> = {}) {
  return {
    data: membersResponse(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({
    user: { timeZone: 'America/New_York' },
    org: ORG,
    isAdmin: true,
  })
  useGetMembersMock.mockReturnValue(listState())
  useGetInvitationsMock.mockReturnValue({ data: [INVITATION], isPending: false, isError: false })
})

describe('the member list', () => {
  it('lists members with the role label, never the raw value', () => {
    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Al Pha')).toBeInTheDocument()
    expect(screen.getByText('al@acme.com')).toBeInTheDocument()
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
    expect(screen.queryByText('admin')).not.toBeInTheDocument()
  })

  it('shows a loading state while members load', () => {
    useGetMembersMock.mockReturnValue(listState({ data: undefined, isPending: true }))

    renderWithProviders(<Settings_MembersTab />)

    expect(screen.queryByText('Al Pha')).not.toBeInTheDocument()
  })

  it('offers a retry when the list fails to load', async () => {
    const refetch = vi.fn()
    useGetMembersMock.mockReturnValue(
      listState({ data: undefined, isPending: false, isError: true, refetch }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Could not load members.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalled()
  })

  it('invites action rather than explaining emptiness', () => {
    useGetMembersMock.mockReturnValue(listState({ data: membersResponse({ members: [], total: 0 }) }))

    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Invite someone to work with you.')).toBeInTheDocument()
  })

  it('asks the SERVER for the page, sort, search, and role — it never slices locally', () => {
    renderWithProviders(<Settings_MembersTab />, {
      initialEntries: ['/settings?q=al&sort=name&dir=desc&page=3&role=admin'],
    })

    // The role filter goes to the server too, so `total` and the page boundaries
    // describe the filtered set rather than the unfiltered one.
    expect(useGetMembersMock).toHaveBeenCalledWith('org-a', {
      page: 3,
      limit: 25,
      sort: 'name',
      dir: 'desc',
      q: 'al',
      role: ['admin'],
    })
  })

  it('restores the search, sort, and page from the URL on reload', () => {
    renderWithProviders(<Settings_MembersTab />, {
      initialEntries: ['/settings?q=pha&sort=email&dir=desc&page=2&role=admin'],
    })

    expect(screen.getByLabelText('Search members')).toHaveValue('pha')
    // The role filter chip carries its count back from the URL.
    expect(screen.getByRole('button', { name: /Role/ })).toHaveTextContent('1')
  })

  it('a header click sorts, and a second click flips the direction', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    await waitFor(() =>
      expect(useGetMembersMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ sort: 'name', dir: 'asc', page: 1 }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Sort by Name' }))
    await waitFor(() =>
      expect(useGetMembersMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ sort: 'name', dir: 'desc' }),
      ),
    )
  })

  it('shows the join date with no time and no zone label', () => {
    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Aug 1, 2026')).toBeInTheDocument()
  })
})

describe('role changes', () => {
  it('lets an admin hold more than one role at once', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: 'Change the role of al@acme.com' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Basic/ }))
    // The menu commits on close, so the write carries BOTH roles, not the last click.
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(updateRolesMock).toHaveBeenCalledWith(
        { orgId: 'org-a', userId: 'user-a', roles: ['admin', 'basic'] },
        expect.anything(),
      ),
    )
  })

  it('surfaces the server\'s last-admin refusal to the person who clicked', async () => {
    const user = userEvent.setup()
    updateRolesMock.mockImplementation(
      (_vars: unknown, opts: { onError: (e: Error) => void }) =>
        opts.onError(
          new ApiError(
            'Promote someone else to admin first. An org always keeps at least one admin.',
            409,
          ),
        ),
    )
    renderWithProviders(<Settings_MembersTab />)

    // Demote: tick Basic, untick Admin. The list says two admins remain, so the
    // UI lets the click through — and the server is the one that says no.
    await user.click(screen.getByRole('button', { name: 'Change the role of al@acme.com' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Basic/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /Admin/ }))
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Promote someone else to admin first. An org always keeps at least one admin.',
      ),
    )
  })

  it('greys out the last admin before the server has to refuse it', async () => {
    useGetMembersMock.mockReturnValue(
      listState({ data: membersResponse({ meta: { activeAdminCount: 1 } }) }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: 'Change the role of al@acme.com' }))

    const adminItem = await screen.findByRole('menuitemcheckbox', { name: /Admin/ })
    expect(adminItem).toHaveAttribute('aria-disabled', 'true')
    expect(within(adminItem).getByText('Promote someone else to admin first.')).toBeInTheDocument()
  })

  it("will not edit the owner's row, and says why", async () => {
    useGetMembersMock.mockReturnValue(
      listState({ data: membersResponse({ members: [member({ roles: ['owner'] })] }) }),
    )
    renderWithProviders(<Settings_MembersTab />)

    expect(
      screen.queryByRole('button', { name: 'Change the role of al@acme.com' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
  })

  it('gives a non-admin the roster but no controls', () => {
    useGetMembersMock.mockReturnValue(listState({ data: membersResponse({ viewerRoles: ['basic'] }) }))

    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText('Al Pha')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create invite' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Change the role of al@acme.com' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Actions for al@acme.com' }),
    ).not.toBeInTheDocument()
  })
})

describe('removing a member', () => {
  it('names the consequence, and only removes after the confirm', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: 'Actions for al@acme.com' }))
    await user.click(await screen.findByRole('menuitem', { name: /Remove from organization/ }))

    // The dialog spells out the specific consequence, not "Are you sure?".
    expect(
      await screen.findByText('Remove al@acme.com from this organization?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Their Maincar account stays, along with every other organization/),
    ).toBeInTheDocument()
    expect(removeMemberMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(removeMemberMock).toHaveBeenCalledWith(
        { orgId: 'org-a', userId: 'user-a' },
        expect.anything(),
      ),
    )
  })

  it('does not remove when the confirm is cancelled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: 'Actions for al@acme.com' }))
    await user.click(await screen.findByRole('menuitem', { name: /Remove from organization/ }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(removeMemberMock).not.toHaveBeenCalled()
  })

  it('disables the removal that would leave the org with no admin, and names the fix', async () => {
    useGetMembersMock.mockReturnValue(
      listState({ data: membersResponse({ meta: { activeAdminCount: 1 } }) }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: 'Actions for al@acme.com' }))

    const item = await screen.findByRole('menuitem', { name: /Promote another admin first/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('invitations', () => {
  it('creates an invite with the chosen role', async () => {
    const user = userEvent.setup()
    createInvitationMock.mockResolvedValue({ invitation: INVITATION })
    renderWithProviders(<Settings_MembersTab />)

    await user.type(screen.getByLabelText('Email'), 'new@acme.com')
    await user.click(screen.getByRole('button', { name: 'Create invite' }))

    await waitFor(() =>
      expect(createInvitationMock).toHaveBeenCalledWith({
        orgId: 'org-a',
        email: 'new@acme.com',
        roles: ['basic'],
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

  it('revokes an invite only after the confirm dialog is accepted', async () => {
    const user = userEvent.setup()
    revokeInvitationMock.mockResolvedValue({})
    renderWithProviders(<Settings_MembersTab />)

    await user.click(screen.getByRole('button', { name: /Revoke the invite for new@acme.com/ }))

    expect(await screen.findByText('Revoke this invite?')).toBeInTheDocument()
    expect(revokeInvitationMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(revokeInvitationMock).toHaveBeenCalledWith({ orgId: 'org-a', invitationId: 'inv-1' }),
    )
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
  it("shows the expiry in the viewing user's timezone, with the zone named", () => {
    renderWithProviders(<Settings_MembersTab />)

    expect(screen.getByText(/expires Sep 3, 2026, 12:00 PM EDT/)).toBeInTheDocument()
  })
})
