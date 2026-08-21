import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { signInMock, navigateMock, locationState } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  navigateMock: vi.fn(),
  locationState: { value: null as unknown },
}))

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: signInMock }))
vi.mock('@/dependencies/firebase', () => ({ getFirebaseAuth: () => ({}) }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/auth/sign-in', search: '', hash: '', key: 'k', state: locationState.value }),
}))

import { ApiError } from '@/lib/api'
import { CREDENTIALS_DO_NOT_MATCH, SERVICE_UNREACHABLE } from '@/lib/firebaseErrors'
import { SignIn } from '@/pages/auth/SignIn'

async function signIn(password = 'hunter2hunter2') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/Email/), 'someone@acme.com')
  await user.type(screen.getByLabelText(/Password/), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  locationState.value = null
})

describe('SignIn', () => {
  it('has the reveal toggle on the password field', () => {
    renderWithProviders(<SignIn />)
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
  })

  it('lands on the home page on success', async () => {
    signInMock.mockResolvedValue({})
    renderWithProviders(<SignIn />)

    await signIn()

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/home', { replace: true }))
  })

  // An invite that was opened by the wrong account sends the person here with the
  // link in hand. Dropping it would strand them on the home page.
  it('returns to wherever it was sent from, with the address prefilled', async () => {
    locationState.value = { from: '/join/tok-1', email: 'invited@acme.com' }
    signInMock.mockResolvedValue({})
    renderWithProviders(<SignIn />)

    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('invited@acme.com')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Password/), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/join/tok-1', { replace: true }))
  })

  it('refuses to be an open redirect', async () => {
    locationState.value = { from: '//evil.test/steal' }
    signInMock.mockResolvedValue({})
    renderWithProviders(<SignIn />)

    await signIn()

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/home', { replace: true }))
  })

  // The one that matters: a stranger must not be able to use this form to find
  // out which addresses have accounts here.
  it('says the same thing whether the account is missing or the password is wrong', async () => {
    const said: string[] = []
    for (const code of ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential']) {
      vi.clearAllMocks()
      signInMock.mockRejectedValue({ code })
      const { unmount } = renderWithProviders(<SignIn />)
      await signIn()
      said.push((await screen.findByRole('alert')).textContent ?? '')
      unmount()
    }

    expect(new Set(said).size).toBe(1)
    expect(said[0]).toBe(CREDENTIALS_DO_NOT_MATCH)
  })

  it('reads an unreachable service as "try again", not as wrong details', async () => {
    signInMock.mockRejectedValue(new ApiError('Cannot reach the sign-in service.', 503))
    renderWithProviders(<SignIn />)

    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent(SERVICE_UNREACHABLE)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('lets the person try again after a failure', async () => {
    signInMock.mockRejectedValue({ code: 'auth/wrong-password' })
    renderWithProviders(<SignIn />)

    await signIn()
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })
})
