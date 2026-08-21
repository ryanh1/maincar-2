import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const {
  useAuthMock,
  useGetPublicInvitationMock,
  acceptInvitationMock,
  updateProfileMock,
  createUserMock,
  signInMock,
  signOutMock,
  navigateMock,
  assignMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetPublicInvitationMock: vi.fn(),
  acceptInvitationMock: vi.fn(),
  updateProfileMock: vi.fn(),
  createUserMock: vi.fn(),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  navigateMock: vi.fn(),
  assignMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/orgs', () => ({
  useGetPublicInvitation: useGetPublicInvitationMock,
  useAcceptInvitation: () => ({ mutateAsync: acceptInvitationMock, isPending: false }),
}))
vi.mock('@/hooks/profile', () => ({
  useUpdateProfile: () => ({ mutateAsync: updateProfileMock, isPending: false }),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: createUserMock,
  signInWithEmailAndPassword: signInMock,
}))
vi.mock('@/dependencies/firebase', () => ({ getFirebaseAuth: () => ({}) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ token: 'tok-1' }),
  useNavigate: () => navigateMock,
}))

import { JoinOrg } from '@/pages/JoinOrg'

const INVITATION = {
  orgName: 'Acme',
  email: 'new@acme.com',
  roles: ['basic', 'admin'],
  expiresAt: '2026-09-03T16:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ firebaseUser: null, isLoading: false, signOut: signOutMock })
  useGetPublicInvitationMock.mockReturnValue({
    data: INVITATION,
    isPending: false,
    isError: false,
  })
  acceptInvitationMock.mockResolvedValue({
    membership: { orgId: 'org-a', orgName: 'Acme', roles: ['admin', 'basic'] },
  })
  // The screen reloads the app after accepting, which jsdom cannot do.
  Object.defineProperty(window, 'location', {
    value: { assign: assignMock, href: 'http://localhost/join/tok-1' },
    writable: true,
  })
})

describe('JoinOrg', () => {
  // Every failure mode is the same 404 by design, so the screen says one thing
  // and names the fix (CLAUDE.md → Writing user-facing copy).
  it('shows one message for any unusable link', () => {
    useGetPublicInvitationMock.mockReturnValue({ data: undefined, isPending: false, isError: true })

    renderWithProviders(<JoinOrg />)

    expect(screen.getByText('This invite is no longer valid')).toBeInTheDocument()
    expect(screen.getByText('Ask the admin for a new one.')).toBeInTheDocument()
  })

  describe('when nobody is signed in', () => {
    it('pre-fills the invited address and will not let it be changed', () => {
      renderWithProviders(<JoinOrg />)

      const email = screen.getByLabelText('Email') as HTMLInputElement
      expect(email.value).toBe('new@acme.com')
      // The invite is bound to this address on the server, so editing it here
      // could only ever produce a 409.
      expect(email).toBeDisabled()
    })

    it('creates the account, saves the name, then accepts', async () => {
      const user = userEvent.setup()
      createUserMock.mockResolvedValue({})
      updateProfileMock.mockResolvedValue({})
      renderWithProviders(<JoinOrg />)

      await user.type(screen.getByLabelText(/First name/), 'Nu')
      await user.type(screen.getByLabelText(/Last name/), 'Person')
      await user.type(screen.getByLabelText(/Password/), 'hunter2hunter2')
      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      await waitFor(() => expect(acceptInvitationMock).toHaveBeenCalledWith('tok-1'))
      expect(createUserMock).toHaveBeenCalledWith({}, 'new@acme.com', 'hunter2hunter2')
      expect(updateProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Nu', lastName: 'Person' }),
      )
    })

    it('signs in instead when the person already has an account', async () => {
      const user = userEvent.setup()
      signInMock.mockResolvedValue({})
      renderWithProviders(<JoinOrg />)

      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await user.type(screen.getByLabelText(/Password/), 'hunter2hunter2')
      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      await waitFor(() => expect(acceptInvitationMock).toHaveBeenCalledWith('tok-1'))
      expect(signInMock).toHaveBeenCalledWith({}, 'new@acme.com', 'hunter2hunter2')
      expect(createUserMock).not.toHaveBeenCalled()
    })
  })

  describe('when the invited person is signed in', () => {
    beforeEach(() => {
      useAuthMock.mockReturnValue({
        firebaseUser: { email: 'new@acme.com' },
        isLoading: false,
        signOut: signOutMock,
      })
    })

    it('offers one button, and names the roles on offer', () => {
      renderWithProviders(<JoinOrg />)

      expect(screen.getByRole('button', { name: 'Join Acme' })).toBeInTheDocument()
      // The raw role value is never shown (CLAUDE.md → Role Display Labels).
      expect(screen.getByText('Admin')).toBeInTheDocument()
      expect(screen.getByText('Basic')).toBeInTheDocument()
      expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument()
    })

    it('accepts on press', async () => {
      const user = userEvent.setup()
      renderWithProviders(<JoinOrg />)

      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      await waitFor(() => expect(acceptInvitationMock).toHaveBeenCalledWith('tok-1'))
    })
  })

  // The mismatch has to name BOTH addresses. "Wrong account" alone leaves the
  // reader with no way to work out which account to use.
  it('names both addresses when someone else is signed in', () => {
    useAuthMock.mockReturnValue({
      firebaseUser: { email: 'someone.else@acme.com' },
      isLoading: false,
      signOut: signOutMock,
    })

    renderWithProviders(<JoinOrg />)

    expect(
      screen.getByText(/This invite was sent to new@acme.com\. You are signed in as someone\.else@acme\.com\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Join/ })).not.toBeInTheDocument()
  })

  it('signs out on press so the right person can sign in', async () => {
    const user = userEvent.setup()
    signOutMock.mockResolvedValue(undefined)
    useAuthMock.mockReturnValue({
      firebaseUser: { email: 'someone.else@acme.com' },
      isLoading: false,
      signOut: signOutMock,
    })

    renderWithProviders(<JoinOrg />)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
  })
})
