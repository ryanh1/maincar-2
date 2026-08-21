import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { createUserMock, navigateMock } = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  navigateMock: vi.fn(),
}))

vi.mock('firebase/auth', () => ({ createUserWithEmailAndPassword: createUserMock }))
vi.mock('@/dependencies/firebase', () => ({ getFirebaseAuth: () => ({}) }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/auth/sign-up', search: '', hash: '', key: 'k', state: null }),
}))

import { PASSWORD_MIN_LENGTH, PASSWORD_RULE } from '@/lib/passwordPolicy'
import { SignUp } from '@/pages/auth/SignUp'

async function submit(password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/Email/), 'new@acme.com')
  if (password) await user.type(screen.getByLabelText(/Password/), password)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

beforeEach(() => vi.clearAllMocks())

describe('SignUp', () => {
  it('states the password rule before anything is submitted', () => {
    renderWithProviders(<SignUp />)
    expect(screen.getByText(PASSWORD_RULE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
  })

  it('will not call Firebase with a password it already knows is too short', async () => {
    renderWithProviders(<SignUp />)

    await submit('x'.repeat(PASSWORD_MIN_LENGTH - 1))

    expect(await screen.findByRole('alert')).toHaveTextContent(`Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  // Sign-up is the one screen where naming the cause is right: the create would
  // fail anyway, so the message costs nothing and tells the reader what to do.
  it('names an address that already has an account', async () => {
    createUserMock.mockRejectedValue({ code: 'auth/email-already-in-use' })
    renderWithProviders(<SignUp />)

    await submit('hunter2hunter2')

    expect(await screen.findByRole('alert')).toHaveTextContent('That email already has an account. Sign in instead.')
  })

  it('goes to onboarding once the account exists', async () => {
    createUserMock.mockResolvedValue({})
    renderWithProviders(<SignUp />)

    await submit('hunter2hunter2')

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/welcome', { replace: true }))
  })
})
