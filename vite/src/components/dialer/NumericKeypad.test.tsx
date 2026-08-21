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

const ENTRY_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0']
const IN_CALL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

/** A real, dialable US number, typed the way a rep types one. */
const NATIONAL = '2025550123'
const E164 = '+12025550123'

/**
 * An org with one active caller ID — the common case, so the Call button is live.
 * The number is a US one, which is also what makes ten bare digits readable.
 */
function numbersWithActive() {
  return {
    data: {
      numbers: [{ id: 'n1', e164: '+14155550100', isActiveForOutbound: true }],
      total: 1,
      activeCount: 1,
    },
  }
}

/** Type a whole number into the field, the way a paste or fast typing lands. */
function typeNumber(value: string) {
  fireEvent.change(phoneInput(), { target: { value } })
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
  it('renders an eleven-key entry grid of 1-9, +, 0', () => {
    render(<NumericKeypad />)

    const grid = screen.getByRole('group', { name: 'Keypad' })
    const buttons = within(grid).getAllByRole('button')
    expect(buttons).toHaveLength(11)
    expect(buttons.map((b) => b.textContent)).toEqual(ENTRY_KEYS)
  })

  it('swaps in * and # once a call is live, where they are real tones', () => {
    useDialerMock.mockReturnValue({ dialing: true })
    render(<NumericKeypad />)

    const grid = screen.getByRole('group', { name: 'Keypad' })
    const buttons = within(grid).getAllByRole('button')
    expect(buttons).toHaveLength(12)
    expect(buttons.map((b) => b.textContent)).toEqual(IN_CALL_KEYS)
  })

  it('formats the number as the rep presses keys', () => {
    render(<NumericKeypad />)

    '415'.split('').forEach(pressKey)
    expect(phoneInput().value).toBe('(415)')

    '5550100'.split('').forEach(pressKey)
    expect(phoneInput().value).toBe('(415) 555-0100')
  })

  it('formats what the rep types or pastes, however it is punctuated', () => {
    render(<NumericKeypad />)

    typeNumber('202-555-0123')
    expect(phoneInput().value).toBe('(202) 555-0123')
  })

  it('formats an international number in its own grouping', () => {
    render(<NumericKeypad />)

    typeNumber('+442071838750')
    expect(phoneInput().value).toBe('+44 20 7183 8750')
  })

  it('drops the last digit on Backspace, not the last separator', () => {
    render(<NumericKeypad />)

    '415'.split('').forEach(pressKey)
    expect(phoneInput().value).toBe('(415)')

    // A dumb trim would eat the ")" and look like nothing happened.
    fireEvent.keyDown(phoneInput(), { key: 'Backspace' })
    expect(phoneInput().value).toBe('41')
  })

  it('drops the last digit on Delete too', () => {
    render(<NumericKeypad />)

    pressKey('9')
    pressKey('1')
    fireEvent.keyDown(phoneInput(), { key: 'Delete' })
    expect(phoneInput().value).toBe('9')
  })

  it('normalises a nationally typed number to E.164 and calls it', () => {
    render(<NumericKeypad />)

    NATIONAL.split('').forEach(pressKey)
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: E164,
      recordingConsent: 'declined',
    })
  })

  it('sends an already-E.164 entry through unchanged', () => {
    render(<NumericKeypad />)

    typeNumber(E164)
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(mutateMock.mock.calls[0][0].toE164).toBe(E164)
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

    typeNumber(NATIONAL)
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })

    expect(toastErrorMock).toHaveBeenCalledWith(
      'You already have a call to this number in progress.',
    )
  })

  it('falls back to a generic line when the failure is not an ApiError', () => {
    mutateMock.mockImplementation((_vars, opts) => opts.onError(new Error('network down')))
    render(<NumericKeypad />)

    typeNumber(NATIONAL)
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

    NATIONAL.split('').forEach(pressKey)
    fireEvent.click(callButton())

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      orgId: 'org-1',
      toE164: E164,
      recordingConsent: 'declined',
    })
  })

  it('disables the Call button until the number is one we can call', () => {
    render(<NumericKeypad />)

    expect(callButton()).toBeDisabled()

    typeNumber('202')
    expect(callButton()).toBeDisabled()

    typeNumber(NATIONAL)
    expect(callButton()).toBeEnabled()
  })

  it('says nothing while the number is only half typed', () => {
    render(<NumericKeypad />)

    typeNumber('202')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses a number that does not exist, and says why', () => {
    render(<NumericKeypad />)

    typeNumber('9999999999')

    expect(callButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That is not a number we can call. Check the digits.',
    )
    fireEvent.keyDown(phoneInput(), { key: 'Enter' })
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('refuses a foreign number typed without its country code rather than guessing', () => {
    render(<NumericKeypad />)

    // London, typed by a rep on a US line. Guessing NANP here dials Bermuda.
    typeNumber('442071838750')

    expect(callButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('calls the same foreign number once the rep types the plus', () => {
    render(<NumericKeypad />)

    typeNumber('+442071838750')
    fireEvent.click(callButton())

    expect(mutateMock.mock.calls[0][0].toE164).toBe('+442071838750')
  })

  it('marks the field invalid so a screen reader hears the reason', () => {
    render(<NumericKeypad />)

    typeNumber('9999999999')

    const input = phoneInput()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      'That is not a number we can call. Check the digits.',
    )
  })

  it('disables the Call button while a placed call is still in flight', () => {
    useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: true })
    render(<NumericKeypad />)

    typeNumber(NATIONAL)
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

    typeNumber(NATIONAL)
    // Numbers still loading: no buy prompt yet, but the button cannot dial from a
    // caller ID we do not have.
    expect(callButton()).toBeDisabled()
  })

  it('asks for a country code when there is no active number to read digits against', () => {
    useGetNumbersMock.mockReturnValue({ data: undefined })
    render(<NumericKeypad />)

    typeNumber(NATIONAL)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Start with + and the country code, like +12025550123.',
    )
  })
})
