import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

import { ApiError } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { NumericKeypad } from './NumericKeypad'

/**
 * The keypad reads four seams — the active org, whether a call is live, the
 * create-call mutation, and the org's numbers — so the tests mock all four. That
 * keeps each assertion about ONE thing: which seam a press reaches, or which state
 * the caller-ID and Call button show, not the network underneath it.
 *
 * `renderWithProviders` supplies the Router the buy prompt's link needs; the Call
 * button itself needs no provider, but the no-active-number branch renders
 * `BuyNumberBanner`, which does.
 */
const { useAuthMock, useDialerMock, useCreateCallMock, useGetNumbersMock, mutateMock, toastErrorMock } =
  vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    useDialerMock: vi.fn(),
    useCreateCallMock: vi.fn(),
    useGetNumbersMock: vi.fn(),
    mutateMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/components/dialer/dialerContext', () => ({ useDialer: useDialerMock }))
vi.mock('@/hooks/dialer', () => ({ useCreateCall: useCreateCallMock }))
vi.mock('@/hooks/phoneNumbers', () => ({ useGetNumbers: useGetNumbersMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

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

function render(ui: Parameters<typeof renderWithProviders>[0]) {
  return renderWithProviders(ui)
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
  useDialerMock.mockReturnValue({ dialing: false })
  useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
  useGetNumbersMock.mockReturnValue(numbersWithActive())
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
    useDialerMock.mockReturnValue({ dialing: true })
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

  it('sends a DTMF tone through the seam when a call is live, and still shows the press', () => {
    useDialerMock.mockReturnValue({ dialing: true })
    const sendDigit = vi.fn()
    render(<NumericKeypad sendDigit={sendDigit} />)

    pressKey('7')

    expect(sendDigit).toHaveBeenCalledTimes(1)
    expect(sendDigit).toHaveBeenCalledWith('7')
    // The press is visible even though no real tone ships yet.
    expect(phoneInput().value).toBe('7')
  })

  it('does not send DTMF when there is no live call', () => {
    const sendDigit = vi.fn()
    render(<NumericKeypad sendDigit={sendDigit} />)

    pressKey('7')
    expect(sendDigit).not.toHaveBeenCalled()
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
