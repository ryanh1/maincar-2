import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { notificationPreferenceDefaults } from '@/lib/notificationPreferences'

const deliverySettings = {
  channels: {
    in_app: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    email: { timing: 'digest', digestFrequency: 'daily', digestTime: '17:00' },
    push: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    slack: { timing: 'off', digestFrequency: 'hourly', digestTime: '09:00' },
  },
  quietHours: { enabled: true, startTime: '18:00', endTime: '08:00' },
} as const

const { useAuthMock, useGetNotificationPreferencesMock, useUpdateNotificationPreferencesMock, useGetNotificationDeliverySettingsMock, useUpdateNotificationDeliverySettingsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetNotificationPreferencesMock: vi.fn(),
  useUpdateNotificationPreferencesMock: vi.fn(),
  useGetNotificationDeliverySettingsMock: vi.fn(),
  useUpdateNotificationDeliverySettingsMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/notificationPreferences', () => ({
  useGetNotificationPreferences: useGetNotificationPreferencesMock,
  useUpdateNotificationPreferences: useUpdateNotificationPreferencesMock,
}))
vi.mock('@/hooks/notificationDeliverySettings', () => ({
  useGetNotificationDeliverySettings: useGetNotificationDeliverySettingsMock,
  useUpdateNotificationDeliverySettings: useUpdateNotificationDeliverySettingsMock,
}))

import { Settings_NotificationsTab } from '@/pages/Settings_NotificationsTab'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' } })
  useGetNotificationPreferencesMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { notificationPreferences: notificationPreferenceDefaults },
  })
  useUpdateNotificationPreferencesMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
  useGetNotificationDeliverySettingsMock.mockReturnValue({ isLoading: false, isError: false, data: { notificationDeliverySettings: deliverySettings } })
  useUpdateNotificationDeliverySettingsMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
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

  it('shows per-channel timing and quiet hours in the viewer timezone', () => {
    renderWithProviders(<Settings_NotificationsTab />)

    expect(screen.getByRole('combobox', { name: 'Email timing' })).toHaveTextContent('Digest')
    expect(screen.getByRole('combobox', { name: 'Email digest frequency' })).toHaveTextContent('Daily')
    expect(screen.getByLabelText(/Daily digest time/)).toHaveValue('17:00')
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeChecked()
    expect(screen.getByLabelText(/Quiet hours start/)).toHaveValue('18:00')
    expect(screen.getAllByText(/EDT/).length).toBeGreaterThan(0)
  })
})
