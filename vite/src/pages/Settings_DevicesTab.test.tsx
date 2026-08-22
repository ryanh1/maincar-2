import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { useGetDevicesMock } = vi.hoisted(() => ({ useGetDevicesMock: vi.fn() }))
vi.mock('@/hooks/devices', () => ({
  useGetDevices: useGetDevicesMock,
  useNetworkStatus: () => ({ online: true }),
}))

import { Settings_DevicesTab } from './Settings_DevicesTab'

describe('Settings_DevicesTab', () => {
  it('renders the same device check the greenroom uses, on demand', () => {
    useGetDevicesMock.mockReturnValue({
      microphones: [],
      speakers: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<Settings_DevicesTab />)

    expect(screen.getByRole('heading', { name: 'Devices' })).toBeInTheDocument()
    // DeviceCheck itself, not a stand-in for it — same as the greenroom shows.
    expect(screen.getByRole('heading', { name: 'Check your audio' })).toBeInTheDocument()
  })
})
