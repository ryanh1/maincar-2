import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { DialerContextValue } from '@/components/dialer/dialerContext'
import { DialerContext } from '@/components/dialer/dialerContext'
import { DialerDock } from '@/components/dialer/DialerDock'
import { TooltipProvider } from '@/components/ui/tooltip'

const {
  useAuthMock,
  useCreateCallMock,
  useGetNumbersMock,
  useGreenRoomDecisionMock,
  useGetDevicesMock,
  mutateMock,
  recordSessionMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useCreateCallMock: vi.fn(),
  useGetNumbersMock: vi.fn(),
  useGreenRoomDecisionMock: vi.fn(),
  useGetDevicesMock: vi.fn(),
  mutateMock: vi.fn(),
  recordSessionMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/dialer', () => ({
  useCreateCall: useCreateCallMock,
  isAdoptableInFlightCallError: () => false,
}))
vi.mock('@/hooks/phoneNumbers', () => ({ useGetNumbers: useGetNumbersMock }))
vi.mock('@/hooks/devices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/devices')>()),
  useGreenRoomDecision: useGreenRoomDecisionMock,
  useGetDevices: useGetDevicesMock,
}))
vi.mock('@/components/DeviceCheck', () => ({
  DeviceCheck: ({ onSelectionChange }: { onSelectionChange: (selection: { microphoneId: string; speakerId: string }) => void }) => {
    useEffect(() => {
      onSelectionChange({ microphoneId: 'mic-1', speakerId: 'speaker-1' })
    }, [onSelectionChange])
    return <div aria-label="Audio devices" role="region" />
  },
}))

const PRE_FILLED_NUMBER = '+12025550123'

function dialerValue(overrides: Partial<DialerContextValue> = {}): DialerContextValue {
  return {
    view: 'collapsed',
    phase: 'idle',
    mode: 'keypad',
    dialing: false,
    elapsedSeconds: 0,
    activeCall: null,
    canControlAudio: false,
    expandDialer: vi.fn(),
    collapseDialer: vi.fn(),
    toggleView: vi.fn(),
    startCall: vi.fn(),
    adoptCall: vi.fn(),
    connectCall: vi.fn(),
    endCall: vi.fn(),
    cancelCall: vi.fn(),
    acceptIncomingCall: vi.fn(),
    rejectIncomingCall: vi.fn(),
    reset: vi.fn(),
    placeDeviceCall: vi.fn(),
    muteCall: vi.fn(),
    sendDigits: vi.fn(),
    ...overrides,
  }
}

function FocusHarness({ prefilledNumber }: { prefilledNumber?: string }) {
  const [view, setView] = useState<DialerContextValue['view']>('collapsed')
  const value = dialerValue({
    view,
    expandDialer: () => setView('expanded'),
    collapseDialer: () => setView('collapsed'),
    toggleView: () => setView((current) => current === 'expanded' ? 'collapsed' : 'expanded'),
  })

  return (
    <TooltipProvider>
      <DialerContext.Provider value={{ ...value, prefilledNumber } as DialerContextValue}>
        <button type="button" onClick={value.expandDialer}>Open the dialer</button>
        <DialerDock />
      </DialerContext.Provider>
    </TooltipProvider>
  )
}

function renderJourney(props: { prefilledNumber?: string } = {}) {
  useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
  useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
  useGetNumbersMock.mockReturnValue({
    data: {
      numbers: [{ id: 'number-1', e164: '+14155550100', status: 'active', isActiveForOutbound: true }],
      total: 1,
      activeCount: 1,
    },
  })
  useGreenRoomDecisionMock.mockReturnValue({
    reason: 'initial',
    shouldShow: true,
    permission: 'granted',
    recordSession: recordSessionMock,
  })
  useGetDevicesMock.mockReturnValue({ error: null, isLoading: false })

  return render(<FocusHarness {...props} />)
}

function phoneNumberInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Phone number' })
}

describe('Dialer focus journey', () => {
  it('opens the dialer on its number input', async () => {
    const user = userEvent.setup()
    renderJourney()

    await user.click(screen.getByRole('button', { name: 'Open the dialer' }))

    expect(phoneNumberInput()).toHaveFocus()
  })

  it('moves to Call only when the dialer opens with a valid prefilled number', async () => {
    const user = userEvent.setup()
    renderJourney({ prefilledNumber: PRE_FILLED_NUMBER })

    await user.click(screen.getByRole('button', { name: 'Open the dialer' }))

    expect(screen.getByRole('button', { name: 'Call' })).toHaveFocus()
  })

  it('does not steal focus from someone typing a number', async () => {
    const user = userEvent.setup()
    renderJourney()

    await user.click(screen.getByRole('button', { name: 'Open the dialer' }))
    await user.type(phoneNumberInput(), '2025550123')

    expect(phoneNumberInput()).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Call' })).toBeEnabled()
  })

  it('focuses the Green Room confirmation, then returns to Call after confirmation', async () => {
    const user = userEvent.setup()
    renderJourney({ prefilledNumber: PRE_FILLED_NUMBER })

    await user.click(screen.getByRole('button', { name: 'Open the dialer' }))
    await user.click(screen.getByRole('button', { name: 'Call' }))

    const confirm = screen.getByRole('button', { name: 'Start call' })
    expect(confirm).toHaveFocus()

    await user.click(confirm)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Call' })).toHaveFocus())
  })
})
