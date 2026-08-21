import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, updateProfileMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  updateProfileMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/profile', () => ({
  useUpdateProfile: () => ({ mutateAsync: updateProfileMock, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_ProfileTab } from '@/pages/Settings_ProfileTab'

const USER = {
  id: 'user-a',
  email: 'al@acme.com',
  firstName: 'Al',
  lastName: 'Pha',
  title: 'Dispatcher',
  imageUrl: null,
  roles: ['basic'],
  enabled: true,
  currentOrgId: 'org-a',
  timeZone: null,
  createdAt: '',
  updatedAt: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: USER })
})

describe('Settings_ProfileTab', () => {
  it('fills the form from the signed-in user', () => {
    renderWithProviders(<Settings_ProfileTab />)

    expect(screen.getByLabelText(/First name/)).toHaveValue('Al')
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Pha')
    expect(screen.getByLabelText('Job title')).toHaveValue('Dispatcher')
  })

  // The address is the Firebase identity: editing it here would put the row and
  // the auth account out of step.
  it('shows the email read-only', () => {
    renderWithProviders(<Settings_ProfileTab />)

    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(screen.getByLabelText('Email')).toHaveValue('al@acme.com')
  })

  it('saves the profile', async () => {
    const user = userEvent.setup()
    updateProfileMock.mockResolvedValue({ user: USER })
    renderWithProviders(<Settings_ProfileTab />)

    const title = screen.getByLabelText('Job title')
    await user.clear(title)
    await user.type(title, 'Head of Dispatch')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateProfileMock).toHaveBeenCalledWith({
        firstName: 'Al',
        lastName: 'Pha',
        title: 'Head of Dispatch',
      }),
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Your profile is saved.')
  })

  it('clears the title when it is emptied', async () => {
    const user = userEvent.setup()
    updateProfileMock.mockResolvedValue({ user: USER })
    renderWithProviders(<Settings_ProfileTab />)

    await user.clear(screen.getByLabelText('Job title'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateProfileMock).toHaveBeenCalledWith(expect.objectContaining({ title: null })),
    )
  })

  it('surfaces an error when the save fails', async () => {
    const user = userEvent.setup()
    updateProfileMock.mockRejectedValue(new Error('boom'))
    renderWithProviders(<Settings_ProfileTab />)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
  })
})
