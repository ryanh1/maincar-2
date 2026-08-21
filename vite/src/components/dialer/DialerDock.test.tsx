import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { DialerContextValue } from './dialerContext'
import { DialerDock } from './DialerDock'

/**
 * The dock reads the whole dialer state through `useDialer` and draws either the
 * keypad or the in-call controls beneath its title bar. Mocking all three keeps
 * every assertion about the dock's own job — the corner, the toggle, the hotkeys,
 * and which child it shows — and never about a keypad's network or a call's
 * hang-up.
 */
const { useDialerMock } = vi.hoisted(() => ({ useDialerMock: vi.fn() }))
vi.mock('@/components/dialer/dialerContext', () => ({ useDialer: useDialerMock }))
vi.mock('@/components/dialer/NumericKeypad', () => ({
  NumericKeypad: () => <div data-testid="keypad" />,
}))
vi.mock('@/components/dialer/InCallControls', () => ({
  InCallControls: (props: { orgId: string; callId: string; recording?: boolean }) => (
    <div
      data-testid="in-call"
      data-org={props.orgId}
      data-call={props.callId}
      data-recording={String(props.recording)}
    />
  ),
}))

function setDialer(overrides: Partial<DialerContextValue> = {}): DialerContextValue {
  const value: DialerContextValue = {
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
    reset: vi.fn(),
    ...overrides,
  }
  useDialerMock.mockReturnValue(value)
  return value
}

function titleBar(): HTMLElement {
  return screen.getByRole('button', { name: /dialer/i })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DialerDock', () => {
  it('renders a region docked bottom-right, at z-100, with rounded top corners', () => {
    setDialer()
    render(<DialerDock />)

    const region = screen.getByRole('region', { name: 'Dialer' })
    expect(region.className).toContain('fixed')
    expect(region.className).toContain('bottom-0')
    expect(region.className).toContain('right-6')
    expect(region.className).toContain('z-[100]')
    expect(region.className).toContain('rounded-t-md')
  })

  it('collapsed shows only the title bar, no body', () => {
    setDialer({ view: 'collapsed' })
    render(<DialerDock />)

    expect(titleBar()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('keypad')).not.toBeInTheDocument()
    expect(screen.queryByTestId('in-call')).not.toBeInTheDocument()
  })

  it('clicking the title bar toggles the view', () => {
    const dialer = setDialer({ view: 'collapsed' })
    render(<DialerDock />)

    fireEvent.click(titleBar())
    expect(dialer.toggleView).toHaveBeenCalledTimes(1)
  })

  it('⌘⇧D toggles the view from anywhere', () => {
    const dialer = setDialer()
    render(<DialerDock />)

    fireEvent.keyDown(window, { code: 'KeyD', key: 'D', shiftKey: true, metaKey: true })
    expect(dialer.toggleView).toHaveBeenCalledTimes(1)

    // Ctrl+Shift+D works too, for the non-Mac rep.
    fireEvent.keyDown(window, { code: 'KeyD', key: 'D', shiftKey: true, ctrlKey: true })
    expect(dialer.toggleView).toHaveBeenCalledTimes(2)
  })

  it('Escape collapses when idle', () => {
    const dialer = setDialer({ view: 'expanded', mode: 'keypad' })
    render(<DialerDock />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialer.collapseDialer).toHaveBeenCalledTimes(1)
  })

  it('Escape does NOT collapse while a call is live', () => {
    const dialer = setDialer({
      view: 'expanded',
      mode: 'call',
      phase: 'in-progress',
      activeCall: { orgId: 'org-1', callId: 'call-1', recording: false },
    })
    render(<DialerDock />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialer.collapseDialer).not.toHaveBeenCalled()
  })

  it('shows the keypad when expanded and idle', () => {
    setDialer({ view: 'expanded', mode: 'keypad' })
    render(<DialerDock />)

    expect(screen.getByTestId('keypad')).toBeInTheDocument()
    expect(screen.queryByTestId('in-call')).not.toBeInTheDocument()
  })

  it('shows the in-call controls when expanded and a call is live, wired to the active call', () => {
    setDialer({
      view: 'expanded',
      mode: 'call',
      phase: 'in-progress',
      activeCall: { orgId: 'org-9', callId: 'call-9', recording: true },
    })
    render(<DialerDock />)

    const controls = screen.getByTestId('in-call')
    expect(controls).toBeInTheDocument()
    expect(controls).toHaveAttribute('data-org', 'org-9')
    expect(controls).toHaveAttribute('data-call', 'call-9')
    expect(controls).toHaveAttribute('data-recording', 'true')
    expect(screen.queryByTestId('keypad')).not.toBeInTheDocument()
  })

  it('shows the running duration in the title bar during a call, even collapsed', () => {
    setDialer({ view: 'collapsed', phase: 'in-progress', elapsedSeconds: 65 })
    render(<DialerDock />)

    expect(screen.getByLabelText('Call duration')).toHaveTextContent('01:05')
    // Still collapsed — the duration rides in the title bar, no body.
    expect(screen.queryByTestId('keypad')).not.toBeInTheDocument()
  })

  it('shows no duration when idle', () => {
    setDialer({ phase: 'idle' })
    render(<DialerDock />)

    expect(screen.queryByLabelText('Call duration')).not.toBeInTheDocument()
  })
})
