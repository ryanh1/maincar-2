import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { notificationPreferenceDefaults } from '@/lib/notificationPreferences'

const { useGetNotificationPreferencesMock, useUpdateNotificationPreferencesMock } = vi.hoisted(() => ({
  useGetNotificationPreferencesMock: vi.fn(),
  useUpdateNotificationPreferencesMock: vi.fn(),
}))

vi.mock('@/hooks/notificationPreferences', () => ({
  useGetNotificationPreferences: useGetNotificationPreferencesMock,
  useUpdateNotificationPreferences: useUpdateNotificationPreferencesMock,
}))

import { Settings_NotificationsTab } from '@/pages/Settings_NotificationsTab'

beforeEach(() => {
  vi.clearAllMocks()
  useGetNotificationPreferencesMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { notificationPreferences: notificationPreferenceDefaults },
  })
  useUpdateNotificationPreferencesMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
})

describe('Settings_NotificationsTab', () => {
  it('shows the grouped event grid with a checked, immutable inbox column', () => {
    renderWithProviders(<Settings_NotificationsTab />)

    expect(screen.getByRole('columnheader', { name: 'In-app inbox' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Push' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mentions in-app inbox' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mentions in-app inbox' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Comments and replies email' })).not.toBeChecked()
  })

  it('persists a changed delivery channel without changing the inbox', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    useUpdateNotificationPreferencesMock.mockReturnValue({ isPending: false, mutateAsync })
    renderWithProviders(<Settings_NotificationsTab />)

    await user.click(screen.getByRole('checkbox', { name: 'Comments and replies email' }))

    expect(mutateAsync).toHaveBeenCalledWith(expect.arrayContaining([
      { eventKind: 'comment', channel: 'email', enabled: true },
      { eventKind: 'comment', channel: 'in_app', enabled: true },
    ]))
  })
})
