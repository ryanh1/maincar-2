import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { ApiError } from '@/lib/api'
import { renderWithProviders, withProviders } from '@/test/utils'
import { InCallControls } from './InCallControls'

/**
 * The controls read two seams — the shared dialer state (phase, elapsed time,
 * and the mute forward to the live Voice SDK Call) and the end-call mutation —
 * so both are mocked. That keeps each assertion about ONE thing: what the view
 * shows for a given state, or which seam a press reaches, never the network or
 * the Voice SDK underneath it.
 */
const { useDialerMock, useEndCallMock, muteCallMock, mutateMock, toastErrorMock } = vi.hoisted(() => ({
  useDialerMock: vi.fn(),
  useEndCallMock: vi.fn(),
  muteCallMock: vi.fn(),
  mutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/components/dialer/dialerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dialerContext')>()),
  useDialer: useDialerMock,
}))
vi.mock('@/hooks/dialer', () => ({ useEndCall: useEndCallMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

beforeEach(() => {
  vi.clearAllMocks()
  useDialerMock.mockReturnValue({ phase: 'in-progress', elapsedSeconds: 0, muteCall: muteCallMock })
  useEndCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
})

function renderControls(props: Partial<Parameters<typeof InCallControls>[0]> = {}) {
  return renderWithProviders(<InCallControls orgId="org-1" callId="call-1" {...props} />)
}

describe('InCallControls', () => {
  it('renders the elapsed time from context as mm:ss', () => {
    useDialerMock.mockReturnValue({ phase: 'in-progress', elapsedSeconds: 75, muteCall: muteCallMock })
    renderControls()

    expect(screen.getByLabelText('Call duration')).toHaveTextContent('01:15')
  })

  it('shows status text derived from the phase', () => {
    useDialerMock.mockReturnValue({ phase: 'ringing', elapsedSeconds: 0, muteCall: muteCallMock })
    const { rerender } = renderControls()
    expect(screen.getByText('Ringing')).toBeInTheDocument()

    useDialerMock.mockReturnValue({ phase: 'in-progress', elapsedSeconds: 0, muteCall: muteCallMock })
    rerender(withProviders(<InCallControls orgId="org-1" callId="call-1" />))
    expect(screen.getByText('Connected')).toBeInTheDocument()

    useDialerMock.mockReturnValue({ phase: 'completed', elapsedSeconds: 0, muteCall: muteCallMock })
    rerender(withProviders(<InCallControls orgId="org-1" callId="call-1" />))
    expect(screen.getByText('Call ended')).toBeInTheDocument()
  })

  it('toggles mute: flips the visible state and forwards to the live Call', () => {
    renderControls()

    // Starts unmuted — the control offers to mute.
    const muteButton = screen.getByRole('button', { name: 'Mute the call' })
    expect(muteButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(muteButton)

    // The Device heard the new state, and the button now offers to unmute.
    expect(muteCallMock).toHaveBeenCalledWith(true)
    const unmuteButton = screen.getByRole('button', { name: 'Unmute the call' })
    expect(unmuteButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(unmuteButton)
    expect(muteCallMock).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Mute the call' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('ends the call through useEndCall with the org and call ids', () => {
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'End the call' }))

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({ orgId: 'org-1', callId: 'call-1' })
  })

  it("surfaces the server's own message when the hang-up is refused", () => {
    mutateMock.mockImplementation((_vars, opts) =>
      opts.onError(new ApiError('This call has already ended, so there is nothing to hang up.', 400)),
    )
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'End the call' }))

    expect(toastErrorMock).toHaveBeenCalledWith(
      'This call has already ended, so there is nothing to hang up.',
    )
  })

  it('falls back to a generic line when the hang-up failure is not an ApiError', () => {
    mutateMock.mockImplementation((_vars, opts) => opts.onError(new Error('offline')))
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'End the call' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Could not end the call. Try again.')
  })

  it('does not fire a second hang-up while one is in flight', () => {
    useEndCallMock.mockReturnValue({ mutate: mutateMock, isPending: true })
    renderControls()

    const endButton = screen.getByRole('button', { name: 'End the call' })
    expect(endButton).toBeDisabled()
  })

  it('shows the recording dot only when the call is being recorded', () => {
    const { rerender } = renderControls({ recording: false })
    expect(screen.queryByText('Recording')).not.toBeInTheDocument()

    rerender(withProviders(<InCallControls orgId="org-1" callId="call-1" recording />))
    expect(screen.getByText('Recording')).toBeInTheDocument()
  })

  it('renders no hold control — the Voice SDK Call has no hold method to wire it to', () => {
    renderControls()

    expect(screen.queryByRole('button', { name: 'Hold the call' })).not.toBeInTheDocument()
  })

  it('gives every icon-only control a verb-and-object accessible name', () => {
    renderControls({ recording: true })

    // Each icon button owes a screen reader a name that is a verb phrase naming
    // both the action and its object — "Mute the call", never a lone "Mute".
    // The name comes from IconButton's required `tooltip`, so the visible
    // tooltip and the accessible name are the same string.
    expect(screen.getByRole('button', { name: 'Mute the call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End the call' })).toBeInTheDocument()
    expect(screen.getByLabelText('Call duration')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Call controls' })).toBeInTheDocument()
  })
})
