import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, updateProfileMock, navigateMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  updateProfileMock: vi.fn(),
  navigateMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/profile', () => ({
  useUpdateProfile: () => ({ mutateAsync: updateProfileMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}))

import { Welcome } from '@/pages/Welcome'

function meWith(memberships: unknown[]) {
  return {
    user: { firstName: 'Nia', lastName: 'Ahmed', title: null, timeZone: 'America/New_York' },
    org: memberships.length ? { id: 'org-a', name: 'Acme' } : null,
    memberships,
  }
}

async function fillAndSave() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/First name/), 'Nia')
  await user.type(screen.getByLabelText(/Last name/), 'Ahmed')
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: null })
})

describe('Welcome', () => {
  it('asks for the name only, never the org', () => {
    renderWithProviders(<Welcome />)

    expect(screen.getByLabelText(/First name/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Last name/)).toBeInTheDocument()
    // Naming the org is its own step now, on its own screen.
    expect(screen.queryByLabelText(/Organization name/)).not.toBeInTheDocument()
  })

  it('sends the browser timezone, so every time this user sees has a zone', async () => {
    updateProfileMock.mockResolvedValue(meWith([{ orgId: 'org-a' }]))
    renderWithProviders(<Welcome />)

    await fillAndSave()

    await waitFor(() =>
      expect(updateProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({ timeZone: expect.any(String) }),
      ),
    )
  })

  // The destination is decided HERE, from the response, rather than by navigating
  // to /home and letting ProtectedLayout bounce on. Two navigations in one tick
  // leave the router rendering a <Navigate> whose effect never runs, and the
  // screen goes blank until the user reloads.
  it('goes straight to /create-org when the response shows no membership', async () => {
    updateProfileMock.mockResolvedValue(meWith([]))
    renderWithProviders(<Welcome />)

    await fillAndSave()

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/create-org', { replace: true }))
  })

  it('goes to /home when the user already belongs to an org', async () => {
    updateProfileMock.mockResolvedValue(meWith([{ orgId: 'org-a' }]))
    renderWithProviders(<Welcome />)

    await fillAndSave()

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/home', { replace: true }))
  })
})
