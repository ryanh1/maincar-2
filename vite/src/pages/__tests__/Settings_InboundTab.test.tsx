import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetInboundForwardingMock, useUpdateInboundForwardingMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetInboundForwardingMock: vi.fn(),
  useUpdateInboundForwardingMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/inboundForwarding', () => ({
  useGetInboundForwarding: useGetInboundForwardingMock,
  useUpdateInboundForwarding: useUpdateInboundForwardingMock,
}))

import { Settings_InboundTab } from '@/pages/Settings_InboundTab'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-a', name: 'Acme' } })
  useGetInboundForwardingMock.mockReturnValue({
    isError: false,
    isLoading: false,
    data: { inboundForwarding: { enabled: false, mobileE164: null, strategy: 'simultaneous' } },
  })
  useUpdateInboundForwardingMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) })
})

describe('Settings_InboundTab', () => {
  it('configures simultaneous mobile forwarding with an E.164 number', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    useUpdateInboundForwardingMock.mockReturnValue({ isPending: false, mutateAsync })

    renderWithProviders(<Settings_InboundTab />)

    await user.type(screen.getByLabelText('Mobile number'), '+12025550188')
    await user.click(screen.getByRole('switch', { name: 'Forward inbound calls to mobile' }))
    await user.click(screen.getByRole('button', { name: 'Save forwarding' }))

    expect(mutateAsync).toHaveBeenCalledWith({ enabled: true, mobileE164: '+12025550188', strategy: 'simultaneous' })
  })

  it('disables forwarding while keeping the saved mobile number', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    useGetInboundForwardingMock.mockReturnValue({
      isError: false,
      isLoading: false,
      data: { inboundForwarding: { enabled: true, mobileE164: '+12025550188', strategy: 'browser_fallback' } },
    })
    useUpdateInboundForwardingMock.mockReturnValue({ isPending: false, mutateAsync })

    renderWithProviders(<Settings_InboundTab />)

    await user.click(screen.getByRole('switch', { name: 'Forward inbound calls to mobile' }))
    await user.click(screen.getByRole('button', { name: 'Save forwarding' }))

    expect(mutateAsync).toHaveBeenCalledWith({ enabled: false, mobileE164: '+12025550188', strategy: 'browser_fallback' })
  })
})
