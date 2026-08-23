import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { callAlertDefaults } from '@/lib/callAlertSettings'

const { useAuthMock, useGetCallAlertSettingsMock, useUpdateCallAlertSettingsMock, requestPermissionMock, enableCallWebPushMock, revokeCallWebPushMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetCallAlertSettingsMock: vi.fn(),
  useUpdateCallAlertSettingsMock: vi.fn(),
  requestPermissionMock: vi.fn(),
  enableCallWebPushMock: vi.fn(),
  revokeCallWebPushMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/callAlertSettings', () => ({
  useGetCallAlertSettings: useGetCallAlertSettingsMock,
  useUpdateCallAlertSettings: useUpdateCallAlertSettingsMock,
}))
vi.mock('@/lib/webPush', () => ({ enableCallWebPush: enableCallWebPushMock, revokeCallWebPush: revokeCallWebPushMock }))

import { Settings_AlertsTab } from '@/pages/Settings_AlertsTab'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' } })
  useGetCallAlertSettingsMock.mockReturnValue({ isLoading: false, isError: false, data: { callAlertSettings: callAlertDefaults } })
  useUpdateCallAlertSettingsMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
  enableCallWebPushMock.mockResolvedValue(undefined)
  revokeCallWebPushMock.mockResolvedValue(undefined)
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

  it('does not save a browser alert setting when subscription permission fails', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    useUpdateCallAlertSettingsMock.mockReturnValue({ isPending: false, mutateAsync })
    enableCallWebPushMock.mockRejectedValue(new Error('Browser notifications are blocked.'))
    renderWithProviders(<Settings_AlertsTab />)

    await user.click(screen.getByRole('switch', { name: 'Incoming call browser notification' }))

    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps the browser subscription while another event still uses it', async () => {
    const user = userEvent.setup()
    useGetCallAlertSettingsMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { callAlertSettings: { ...callAlertDefaults, incoming: { ...callAlertDefaults.incoming, browserNotification: true }, missed: { ...callAlertDefaults.missed, browserNotification: true } } },
    })
    renderWithProviders(<Settings_AlertsTab />)

    await user.click(screen.getByRole('switch', { name: 'Incoming call browser notification' }))

    expect(revokeCallWebPushMock).not.toHaveBeenCalled()
  })
})
