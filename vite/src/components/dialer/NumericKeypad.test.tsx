import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { ApiError } from '@/lib/api'
import { NumericKeypad } from './NumericKeypad'

/**
 * The keypad reads three seams — the active org, whether a call is live, and the
 * create-call mutation — so the tests mock all three. That keeps each assertion
 * about ONE thing: which seam a press reaches, not the network underneath it.
 */
const { useAuthMock, useDialerMock, useCreateCallMock, mutateMock, toastErrorMock } = vi.hoisted(
  () => ({
    useAuthMock: vi.fn(),
    useDialerMock: vi.fn(),
    useCreateCallMock: vi.fn(),
    mutateMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
)

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/components/dialer/dialerContext', () => ({ useDialer: useDialerMock }))
vi.mock('@/hooks/dialer', () => ({ useCreateCall: useCreateCallMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

function phoneInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Phone number' })
}

function pressKey(key: string) {
  fireEvent.click(screen.getByRole('button', { name: key }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
  useDialerMock.mockReturnValue({ dialing: false })
  useCreateCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
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
})
