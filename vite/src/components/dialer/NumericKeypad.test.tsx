import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

import { ApiError } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { NumericKeypad } from './NumericKeypad'

/**
 * The keypad reads five seams — the active org, whether a call is live, the
 * create-call mutation, the org's numbers, and the greenroom decision — so the
 * tests mock all five. That keeps each assertion about ONE thing: which seam a
 * press reaches, or which state the caller-ID and Call button show, not the
 * network underneath it, and not `GreenRoom`'s own internals — those belong to
 * `GreenRoom.test.tsx` and `GreenRoom.integration.test.tsx`. Here `GreenRoom` is
 * mocked down to its prop contract (open, onOpenChange, onConfirm, confirmLabel),
 * so what these tests pin is the WIRING: when the keypad opens it, what happens
 * on confirm and on cancel.
 *
 * `renderWithProviders` supplies the Router the buy prompt's link needs and the
 * `TooltipProvider` the headphones `IconButton` needs; the Call button itself
 * needs no provider, but the no-active-number branch renders `BuyNumberBanner`.
 */
const {
  useAuthMock,
  useDialerMock,
  useCreateCallMock,
  useGetNumbersMock,
  useGreenRoomDecisionMock,
  clearGreenRoomCheckInStoreMock,
  sendDigitsMock,
  mutateMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useDialerMock: vi.fn(),
  useCreateCallMock: vi.fn(),
  useGetNumbersMock: vi.fn(),
  useGreenRoomDecisionMock: vi.fn(),
  clearGreenRoomCheckInStoreMock: vi.fn(),
  sendDigitsMock: vi.fn(),
  mutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/components/dialer/dialerContext', () => ({ useDialer: useDialerMock }))
vi.mock('@/hooks/dialer', () => ({ useCreateCall: useCreateCallMock }))
vi.mock('@/hooks/phoneNumbers', () => ({ useGetNumbers: useGetNumbersMock }))
vi.mock('@/hooks/devices', () => ({
  useGreenRoomDecision: useGreenRoomDecisionMock,
  clearGreenRoomCheckInStore: clearGreenRoomCheckInStoreMock,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

/**
 * Stands in for the real `GreenRoom` (MAI-24), reduced to its prop contract. The
 * confirm button's label echoes `confirmLabel` so a test can tell a call-gating
 * open from an on-demand one without reaching into the keypad's own state.
 */
vi.mock('@/components/GreenRoom', () => ({
  GreenRoom: (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: (selection: { microphoneId: string | null; speakerId: string | null }) => void
    confirmLabel?: string
  }) =>
    props.open ? (
      <div role="dialog" aria-label="Check your devices">
        <button
          type="button"
          onClick={() => props.onConfirm({ microphoneId: 'mic-1', speakerId: 'spk-1' })}
        >
          {props.confirmLabel ?? 'Start call'}
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          Cancel
        </button>
      </div>
    ) : null,
}))

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

/** An org with one active caller ID — the common case, so the Call button is live. */
function numbersWithActive() {
  return {
    data: {
      numbers: [{ id: 'n1', e164: '+14155550100', isActiveForOutbound: true }],
      total: 1,
      activeCount: 1,
    },
  }
}

function phoneInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Phone number' })
}

function pressKey(key: string) {
  fireEvent.click(screen.getByRole('button', { name: key }))
}

function callButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Call' })
}

function headphonesButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Check your microphone and speaker' })
}

function consentBox(): HTMLElement {
  return screen.getByRole('checkbox', { name: 'Record this call' })
}

function render(ui: Parameters<typeof renderWithProviders>[0]) {
  return renderWithProviders(ui)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
  useDialerMock.mockReturnValue({ dialing: false, sendDigits: sendDigitsMock })
  useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
  useGetNumbersMock.mockReturnValue(numbersWithActive())
  // The common case: the rep already passed a check this session, so the Call
  // button dials straight through. Tests for the gate itself flip this.
  useGreenRoomDecisionMock.mockReturnValue({ shouldShow: false })
})

describe('NumericKeypad', () => {
  it('renders a twelve-button grid of 1-9, *, 0, #', () => {
    render(<NumericKeypad />)

    const grid = screen.getByRole('group', { name: 'Keypad' })
    const buttons = within(grid).getAllByRole('button')
    expect(buttons).toHaveLength(12)
    expect(buttons.map((b) => b.textContent)).toEqual(KEYS)
  })

  it('appends a clicked digit to the number field', () => {
    render(<NumericKeypad />)

    pressKey('4')
    pressKey('1')
    pressKey('5')
    expect(phoneInput().value).toBe('415')
  })

  it('lets the rep type into the field directly', () => {
    render(<NumericKeypad />)

    fireEvent.change(phoneInput(), { target: { value: '5551234' } })
    expect(phoneInput().value).toBe('5551234')
  })

  it('drops the last character on Backspace', () => {
    render(<NumericKeypad />)

    pressKey('9')
    pressKey('1')
    pressKey('1')
    expect(phoneInput().value).toBe('911')

    fireEvent.keyDown(phoneInput(), { key: 'Backspace' })
    expect(phoneInput().value).toBe('91')
  })

  it('drops the last character on Delete too', () => {
    render(<NumericKeypad />)

    pressKey('9')
    pressKey('1')
    fireEvent.keyDown(phoneInput(), { key: 'Delete' })
    expect(phoneInput().value).toBe('9')
  })

  it('places the call on Enter when no call is live', () => {
    render(<NumericKeypad />)

    '5551234'.split('').forEach(pressKey)
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5551234',
      recordingConsent: 'declined',
    })
  })

  it('does not dial a blank number', () => {
    render(<NumericKeypad />)

    fireEvent.keyDown(phoneInput(), { key: 'Enter' })
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('does not dial on Enter while a call is already live', () => {
    useDialerMock.mockReturnValue({ dialing: true, sendDigits: sendDigitsMock })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('does not dial again while a placed call is still in flight', () => {
    useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: true })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('tells the rep to pick an organization instead of placing a call with none', () => {
    useAuthMock.mockReturnValue({ org: null })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(mutateMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith('Select an organization to call from.')
  })

  it("surfaces the server's own message when the call is refused", () => {
    mutateMock.mockImplementation((_vars, opts) =>
      opts.onError(new ApiError('You already have a call to this number in progress.', 409)),
    )
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(toastErrorMock).toHaveBeenCalledWith(
      'You already have a call to this number in progress.',
    )
  })

  it('falls back to a generic line when the failure is not an ApiError', () => {
    mutateMock.mockImplementation((_vars, opts) => opts.onError(new Error('network down')))
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(toastErrorMock).toHaveBeenCalledWith('Could not place the call. Try again.')
  })

  it('sends a real DTMF tone through the Device when a call is live, and still shows the press', () => {
    useDialerMock.mockReturnValue({ dialing: true, sendDigits: sendDigitsMock })
    render(<NumericKeypad />)

    pressKey('7')

    expect(sendDigitsMock).toHaveBeenCalledTimes(1)
    expect(sendDigitsMock).toHaveBeenCalledWith('7')
    expect(phoneInput().value).toBe('7')
  })

  it('does not send DTMF when there is no live call', () => {
    render(<NumericKeypad />)

    pressKey('7')
    expect(sendDigitsMock).not.toHaveBeenCalled()
  })

  it('places the call when the Call button is clicked', () => {
    render(<NumericKeypad />)

    '5551234'.split('').forEach(pressKey)
    fireEvent.click(callButton())

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5551234',
      recordingConsent: 'declined',
    })
  })

  it('disables the Call button while the number is blank', () => {
    render(<NumericKeypad />)

    expect(callButton()).toBeDisabled()

    pressKey('5')
    expect(callButton()).toBeEnabled()
  })

  it('disables the Call button while a placed call is still in flight', () => {
    useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: true })
    render(<NumericKeypad />)

    pressKey('5')
    expect(callButton()).toBeDisabled()
  })

  it('shows which number the call goes out from', () => {
    render(<NumericKeypad />)

    expect(screen.getByText('From +14155550100')).toBeInTheDocument()
  })

  it('prompts the rep to buy a number instead of a Call button when there is none', () => {
    useGetNumbersMock.mockReturnValue({ data: { numbers: [], total: 0, activeCount: 0 } })
    render(<NumericKeypad />)

    // No live-looking Call button when there is nothing to call from.
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument()
    // The buy prompt takes its place, linked to the phone number settings.
    expect(screen.getByText('You need a number to call out.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Buy a number' })).toHaveAttribute(
      'href',
      '/settings?tab=numbers',
    )
  })

  it('keeps the Call button out of reach until an active number is known', () => {
    useGetNumbersMock.mockReturnValue({ data: undefined })
    render(<NumericKeypad />)

    pressKey('5')
    // Numbers still loading: no buy prompt yet, but the button cannot dial from a
    // caller ID we do not have.
    expect(callButton()).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Recording consent (MAI-192)
// ---------------------------------------------------------------------------
// The rule the whole feature rests on is that `granted` only ever comes from a
// rep ticking the box — so these cover the untouched default, the grant, and
// the un-grant, each all the way to what the mutation is actually called with
// rather than to the checkbox's own state.

describe('recording consent', () => {
  it('offers the choice unticked, so no call records by default', () => {
    render(<NumericKeypad />)

    expect(consentBox()).not.toBeChecked()
  })

  it('sends declined when the rep never touches the box', () => {
    render(<NumericKeypad />)

    '5551234'.split('').forEach(pressKey)
    fireEvent.click(callButton())

    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5551234',
      recordingConsent: 'declined',
    })
  })

  it('sends granted once the rep ticks the box', () => {
    render(<NumericKeypad />)

    '5551234'.split('').forEach(pressKey)
    fireEvent.click(consentBox())
    expect(consentBox()).toBeChecked()

    fireEvent.click(callButton())

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5551234',
      recordingConsent: 'granted',
    })
  })

  it('goes back to declined when the rep unticks the box', () => {
    render(<NumericKeypad />)

    '5551234'.split('').forEach(pressKey)
    fireEvent.click(consentBox())
    fireEvent.click(consentBox())
    expect(consentBox()).not.toBeChecked()

    fireEvent.click(callButton())

    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5551234',
      recordingConsent: 'declined',
    })
  })

  it('carries the granted value through an Enter-key dial too', () => {
    render(<NumericKeypad />)

    '5551234'.split('').forEach(pressKey)
    fireEvent.click(consentBox())
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5551234',
      recordingConsent: 'granted',
    })
  })

  it('carries the granted value through the greenroom gate too', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: true })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.click(consentBox())
    fireEvent.click(callButton())
    fireEvent.click(screen.getByRole('button', { name: 'Start call' }))

    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5',
      recordingConsent: 'granted',
    })
  })

  it('locks the choice while a placed call is still in flight', () => {
    useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: true })
    render(<NumericKeypad />)

    expect(consentBox()).toBeDisabled()
  })

  it('locks the choice while a call is live', () => {
    useDialerMock.mockReturnValue({ dialing: true, sendDigits: sendDigitsMock })
    render(<NumericKeypad />)

    expect(consentBox()).toBeDisabled()
  })

  it('offers no recording choice when there is no number to call from', () => {
    useGetNumbersMock.mockReturnValue({ data: { numbers: [], total: 0, activeCount: 0 } })
    render(<NumericKeypad />)

    expect(screen.queryByRole('checkbox', { name: 'Record this call' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The greenroom gate (MAI-193)
// ---------------------------------------------------------------------------

describe('the greenroom gate', () => {
  it('opens the greenroom instead of dialing when a check is needed', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: true })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.click(callButton())

    // The dialer cannot place a first call that bypasses the check: the dialog
    // is up, and nothing has been dialed yet.
    expect(screen.getByRole('dialog', { name: 'Check your devices' })).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('places the queued call once the greenroom is confirmed', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: true })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.click(callButton())
    fireEvent.click(screen.getByRole('button', { name: 'Start call' }))

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: '5',
      recordingConsent: 'declined',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('places no call when the greenroom is cancelled', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: true })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.click(callButton())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mutateMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gates Enter the same way it gates the Call button', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: true })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('dials straight through without opening the greenroom on a retry', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: false })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.click(callButton())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mutateMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// The on-demand device check (MAI-193)
// ---------------------------------------------------------------------------

describe('the on-demand device check', () => {
  it('opens the greenroom from the headphones button, clearing the recorded check first', () => {
    // A pass is already on record — `shouldShow` alone would never open the
    // dialog for it, so the on-demand path must force it open regardless. That
    // forcing is `clearGreenRoomCheckInStore`: without it the real `GreenRoom`
    // reads its own decision as 'retry' and renders nothing, by design.
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: false })
    render(<NumericKeypad />)

    fireEvent.click(headphonesButton())

    expect(clearGreenRoomCheckInStoreMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Check your devices' })).toBeInTheDocument()
    // Not gating a call: the confirm button carries the on-demand label.
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('places no call when an on-demand check is confirmed', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: false })
    render(<NumericKeypad />)

    pressKey('5')
    fireEvent.click(headphonesButton())
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(mutateMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is reachable even while a check already passed this session', () => {
    useGreenRoomDecisionMock.mockReturnValue({ shouldShow: false })
    render(<NumericKeypad />)

    expect(headphonesButton()).toBeEnabled()
  })
})
