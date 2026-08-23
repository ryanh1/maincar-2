import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { callAlertDefaults } from '@/lib/callAlertSettings'

const { useAuthMock, useGetCallAlertSettingsMock, useUpdateCallAlertSettingsMock, requestPermissionMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCallAlertSettingsMock: vi.fn(),
  useUpdateCallAlertSettingsMock: vi.fn(),
  requestPermissionMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/callAlertSettings', () => ({
  useGetCallAlertSettings: useGetCallAlertSettingsMock,
  useUpdateCallAlertSettings: useUpdateCallAlertSettingsMock,
}))

import { Settings_AlertsTab } from '@/pages/Settings_AlertsTab'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' } })
  useGetCallAlertSettingsMock.mockReturnValue({ isLoading: false, isError: false, data: { callAlertSettings: callAlertDefaults } })
  useUpdateCallAlertSettingsMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
  Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'default', requestPermission: requestPermissionMock } })
})

describe('Settings_AlertsTab', () => {
  it('shows controls for every foreground call event and names the viewer timezone', () => {
    renderWithProviders(<Settings_AlertsTab />)

    expect(screen.getByRole('switch', { name: 'Incoming call sound' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Missed call popover' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Voicemail popover' })).toBeChecked()
    expect(screen.getAllByText(/EDT/).length).toBeGreaterThan(0)
  })

  it('asks for native notification permission only after the rep explicitly enables it', async () => {
    const user = userEvent.setup()
    requestPermissionMock.mockResolvedValue('granted')
    renderWithProviders(<Settings_AlertsTab />)

    await user.click(screen.getByRole('switch', { name: 'Incoming call desktop notification' }))

    expect(requestPermissionMock).toHaveBeenCalledOnce()
  })
})
