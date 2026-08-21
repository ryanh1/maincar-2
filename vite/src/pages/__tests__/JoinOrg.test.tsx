import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

// The canonical shape for a component test here: vi.hoisted() makes the mock fns,
// vi.mock() swaps the modules, and the component is imported AFTER both so the
// mocks are in place when its module graph loads.
const {
  useAuthMock,
  useGetPublicInvitationMock,
  acceptInvitationMock,
  updateProfileMock,
  createUserMock,
  signInMock,
  signOutMock,
  navigateMock,
  refetchMock,
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
  refetchMock: vi.fn(),
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
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ token: 'tok-1' }),
  useNavigate: () => navigateMock,
}))

import { ApiError } from '@/lib/api'
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE } from '@/lib/passwordPolicy'
import { JoinOrg } from '@/pages/JoinOrg'

const INVITATION = {
  orgName: 'Acme',
  email: 'new@acme.com',
  roles: ['basic', 'admin'],
  expiresAt: '2026-09-03T16:00:00.000Z',
}

function lookupFails(error: unknown) {
  useGetPublicInvitationMock.mockReturnValue({
    data: undefined,
    error,
    isPending: false,
    isError: true,
    isFetching: false,
    refetch: refetchMock,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ firebaseUser: null, isLoading: false, signOut: signOutMock })
  useGetPublicInvitationMock.mockReturnValue({
    data: INVITATION,
    error: null,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: refetchMock,
  })
  acceptInvitationMock.mockResolvedValue({
    membership: { orgId: 'org-a', orgName: 'Acme', roles: ['admin', 'basic'] },
  })
  signOutMock.mockResolvedValue(undefined)
  // The screen reloads the app after accepting, which jsdom cannot do.
  Object.defineProperty(window, 'location', {
    value: { assign: assignMock, href: 'http://localhost/join/tok-1' },
    writable: true,
  })
})

describe('JoinOrg', () => {
  // Every dead end is the same 404 by design, so the screen says one thing and
  // names the fix (CLAUDE.md → Writing user-facing copy).
  it('shows one message for any unusable link', () => {
    lookupFails(new ApiError('Invitation unavailable', 404))

    renderWithProviders(<JoinOrg />)

    expect(screen.getByText('This invite is no longer valid')).toBeInTheDocument()
    expect(screen.getByText('Ask the admin for a new one.')).toBeInTheDocument()
  })

  // Invalid, expired, revoked and already-used are deliberately indistinguishable:
  // four separate answers would let a scanner tell a wrong token from a spent one.
  it('keeps the four dead states indistinguishable, whatever the server body said', () => {
    const bodies = ['Invitation unavailable', 'expired', 'revoked', 'already accepted']
    const rendered = bodies.map((body) => {
      lookupFails(new ApiError(body, 404))
      const { container, unmount } = renderWithProviders(<JoinOrg />)
      const text = container.textContent ?? ''
      unmount()
      return text
    })

    expect(new Set(rendered).size).toBe(1)
    for (const body of bodies.slice(1)) expect(rendered[0]).not.toContain(body)
  })

  // A server we could not reach is OUR problem. Calling it "no longer valid"
  // sends the invitee to ask for a replacement link that will fail identically.
  it('does not call a transport failure a dead link', async () => {
    const user = userEvent.setup()
    lookupFails(new TypeError('Failed to fetch'))

    renderWithProviders(<JoinOrg />)

    expect(screen.queryByText('This invite is no longer valid')).not.toBeInTheDocument()
    expect(screen.getByText('Cannot reach the server. Try again in a moment.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetchMock).toHaveBeenCalled()
  })

  it('passes a rate limit through as itself', () => {
    lookupFails(new ApiError('Too many attempts. Wait a minute and try again.', 429))

    renderWithProviders(<JoinOrg />)

    expect(screen.getByText('Too many attempts. Wait a minute and try again.')).toBeInTheDocument()
    expect(screen.queryByText('This invite is no longer valid')).not.toBeInTheDocument()
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

    it('states the password rule up front and can reveal what was typed', async () => {
      const user = userEvent.setup()
      renderWithProviders(<JoinOrg />)

      expect(screen.getByText(PASSWORD_RULE)).toBeInTheDocument()
      expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password')

      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'text')
    })

    it('refuses a password Firebase would reject, without asking Firebase', async () => {
      const user = userEvent.setup()
      renderWithProviders(<JoinOrg />)

      await user.type(screen.getByLabelText(/First name/), 'Nu')
      await user.type(screen.getByLabelText(/Last name/), 'Person')
      await user.type(screen.getByLabelText(/Password/), 'x'.repeat(PASSWORD_MIN_LENGTH - 1))
      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(`Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      expect(createUserMock).not.toHaveBeenCalled()
    })

    it('names the reason the account could not be created', async () => {
      const user = userEvent.setup()
      createUserMock.mockRejectedValue({ code: 'auth/email-already-in-use' })
      renderWithProviders(<JoinOrg />)

      await user.type(screen.getByLabelText(/First name/), 'Nu')
      await user.type(screen.getByLabelText(/Last name/), 'Person')
      await user.type(screen.getByLabelText(/Password/), 'hunter2hunter2')
      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('That email already has an account. Sign in instead.')
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

    it('stays vague about which half was wrong when signing in', async () => {
      const user = userEvent.setup()
      signInMock.mockRejectedValue({ code: 'auth/user-not-found' })
      renderWithProviders(<JoinOrg />)

      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await user.type(screen.getByLabelText(/Password/), 'hunter2hunter2')
      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('That email and password did not match.')
      expect(alert.textContent).not.toMatch(/no account|not found/i)
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

    // The server compares the invited address to the User ROW's email, which can
    // differ from the Firebase account's. When it says mismatch, the screen goes
    // to the mismatch state — not a toast over a screen that still says "Join".
    it('takes the server at its word when it calls this the wrong account', async () => {
      const user = userEvent.setup()
      acceptInvitationMock.mockRejectedValue(
        new ApiError(
          'This invite was sent to new@acme.com. Sign out and sign in as that person.',
          409,
          'email_mismatch',
        ),
      )
      renderWithProviders(<JoinOrg />)

      await user.click(screen.getByRole('button', { name: 'Join Acme' }))

      expect(await screen.findByText('Wrong account')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Sign out and sign in as new@acme.com' }),
      ).toBeInTheDocument()
    })
  })

  describe('when someone else is signed in', () => {
    beforeEach(() => {
      useAuthMock.mockReturnValue({
        firebaseUser: { email: 'someone.else@acme.com' },
        isLoading: false,
        signOut: signOutMock,
      })
    })

    // The mismatch has to name BOTH addresses. "Wrong account" alone leaves the
    // reader with no way to work out which account to use.
    it('names both addresses, and never calls the invite dead', () => {
      renderWithProviders(<JoinOrg />)

      expect(
        screen.getByText(/This invite was sent to new@acme.com\. You are signed in as someone\.else@acme\.com\./),
      ).toBeInTheDocument()
      expect(screen.queryByText('This invite is no longer valid')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Join/ })).not.toBeInTheDocument()
    })

    it('offers the way out as a real control, naming the account to use', () => {
      renderWithProviders(<JoinOrg />)

      expect(
        screen.getByRole('button', { name: 'Sign out and sign in as new@acme.com' }),
      ).toBeInTheDocument()
    })

    // Signing out and losing the invite would leave the person with nothing to
    // click, so the token travels with them to the sign-in screen.
    it('signs out and carries the invite to the sign-in screen', async () => {
      const user = userEvent.setup()
      renderWithProviders(<JoinOrg />)

      await user.click(screen.getByRole('button', { name: 'Sign out and sign in as new@acme.com' }))

      await waitFor(() => expect(signOutMock).toHaveBeenCalled())
      await waitFor(() =>
        expect(navigateMock).toHaveBeenCalledWith('/auth/sign-in', {
          replace: true,
          state: { from: '/join/tok-1', email: 'new@acme.com' },
        }),
      )
    })
  })
})
