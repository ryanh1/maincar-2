import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { InCallControls } from './InCallControls'

/**
 * The controls read two seams — the shared dialer state (phase + elapsed time)
 * and the end-call mutation — so both are mocked. That keeps each assertion about
 * ONE thing: what the view shows for a given state, or which seam a press reaches,
 * never the network underneath it.
 */
const { useDialerMock, useEndCallMock, mutateMock, toastErrorMock } = vi.hoisted(() => ({
  useDialerMock: vi.fn(),
  useEndCallMock: vi.fn(),
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
  useDialerMock.mockReturnValue({ phase: 'in-progress', elapsedSeconds: 0 })
  useEndCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
})

function renderControls(props: Partial<Parameters<typeof InCallControls>[0]> = {}) {
  return render(<InCallControls orgId="org-1" callId="call-1" {...props} />)
}

describe('InCallControls', () => {
  it('renders the elapsed time from context as mm:ss', () => {
    useDialerMock.mockReturnValue({ phase: 'in-progress', elapsedSeconds: 75 })
    renderControls()

    expect(screen.getByLabelText('Call duration')).toHaveTextContent('01:15')
  })

  it('shows status text derived from the phase', () => {
    useDialerMock.mockReturnValue({ phase: 'ringing', elapsedSeconds: 0 })
    const { rerender } = renderControls()
    expect(screen.getByText('Ringing')).toBeInTheDocument()

    useDialerMock.mockReturnValue({ phase: 'in-progress', elapsedSeconds: 0 })
    rerender(<InCallControls orgId="org-1" callId="call-1" />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('toggles mute: flips the visible state and calls the seam', () => {
    const onToggleMute = vi.fn()
    renderControls({ onToggleMute })

    // Starts unmuted — the control offers to mute.
    const muteButton = screen.getByRole('button', { name: 'Mute' })
    expect(muteButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(muteButton)

    // The seam heard the new state, and the button now offers to unmute.
    expect(onToggleMute).toHaveBeenCalledWith(true)
    const unmuteButton = screen.getByRole('button', { name: 'Unmute' })
    expect(unmuteButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(unmuteButton)
    expect(onToggleMute).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles hold: flips the visible state and calls the seam', () => {
    const onToggleHold = vi.fn()
    renderControls({ onToggleHold })

    const holdButton = screen.getByRole('button', { name: 'Hold' })
    expect(holdButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(holdButton)

    expect(onToggleHold).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ends the call through useEndCall with the org and call ids', () => {
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'End call' }))

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({ orgId: 'org-1', callId: 'call-1' })
  })

  it('does not fire a second hang-up while one is in flight', () => {
    useEndCallMock.mockReturnValue({ mutate: mutateMock, isPending: true })
    renderControls()

    const endButton = screen.getByRole('button', { name: 'End call' })
    expect(endButton).toBeDisabled()
  })

  it('shows the recording dot only when the call is being recorded', () => {
    const { rerender } = renderControls({ recording: false })
    expect(screen.queryByText('Recording')).not.toBeInTheDocument()

    rerender(<InCallControls orgId="org-1" callId="call-1" recording />)
    expect(screen.getByText('Recording')).toBeInTheDocument()
  })

  it('gives every control an accessible label', () => {
    renderControls({ recording: true })

    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hold' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End call' })).toBeInTheDocument()
    expect(screen.getByLabelText('Call duration')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Call controls' })).toBeInTheDocument()
  })
})
