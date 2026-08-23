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
vi.mock('@/components/dialer/InCallWorkspace', () => ({
  InCallWorkspace: (props: { orgId: string; callId: string; toE164: string; recording?: boolean }) => (
    <div
      data-testid="in-call"
      data-org={props.orgId}
      data-call={props.callId}
      data-number={props.toE164}
      data-recording={String(props.recording)}
    />
  ),
}))
vi.mock('@/components/dialer/DialerDispositionBar', () => ({
  DialerDispositionBar: (props: { orgId: string; callId: string; terminalStatus?: string | null }) => (
    <div data-testid="disposition-bar" data-org={props.orgId} data-call={props.callId} data-terminal-status={props.terminalStatus ?? ''} />
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
    acceptIncomingCall: vi.fn(),
    rejectIncomingCall: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
  useDialerMock.mockReturnValue(value)
  return value
}

function titleBar(): HTMLElement {
  return screen.getByRole('button', { name: /start call|dialer/i })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DialerDock', () => {
  it('renders nothing while collapsed, leaving the command bar as the idle entry point', () => {
    setDialer({ view: 'collapsed' })
    render(<DialerDock />)

    expect(screen.queryByRole('region', { name: 'Dialer' })).not.toBeInTheDocument()
  })

  it('expanded keeps the floating card look: rounded top corners, a border, a shadow', () => {
    setDialer({ view: 'expanded' })
    render(<DialerDock />)

    const region = screen.getByRole('region', { name: 'Dialer' })
    expect(region.className).toContain('rounded-t-md')
    expect(region.className).toContain('shadow-md')
    expect(region.className).toContain('w-80')
  })

  it('expanded still shows the collapsing chevron', () => {
    setDialer({ view: 'expanded', phase: 'idle' })
    render(<DialerDock />)

    const button = screen.getByRole('button', { name: /Dialer/ })
    expect(button.querySelector('svg.lucide-chevron-down')).toBeInTheDocument()
  })

  it('clicking the title bar toggles the view', () => {
    const dialer = setDialer({ view: 'expanded' })
    render(<DialerDock />)

    fireEvent.click(titleBar())
    expect(dialer.toggleView).toHaveBeenCalledTimes(1)
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
      activeCall: { orgId: 'org-9', callId: 'call-9', toE164: '+12025550123', recording: true },
    })
    render(<DialerDock />)

    const controls = screen.getByTestId('in-call')
    expect(controls).toBeInTheDocument()
    expect(controls).toHaveAttribute('data-org', 'org-9')
    expect(controls).toHaveAttribute('data-call', 'call-9')
    expect(controls).toHaveAttribute('data-number', '+12025550123')
    expect(controls).toHaveAttribute('data-recording', 'true')
    expect(screen.queryByTestId('keypad')).not.toBeInTheDocument()
    expect(screen.getByTestId('disposition-bar')).toHaveAttribute('data-call', 'call-9')
  })

  it('shows the raw caller number with explicit accept and reject actions while an inbound call rings', () => {
    const dialer = setDialer({
      view: 'expanded',
      mode: 'call',
      phase: 'ringing',
      activeCall: { orgId: 'org-9', callId: 'call-9', toE164: '+12025550123', direction: 'inbound', recording: false },
    })
    render(<DialerDock />)

    expect(screen.getByText('+12025550123')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject call' }))

    expect(dialer.acceptIncomingCall).toHaveBeenCalledOnce()
    expect(dialer.rejectIncomingCall).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('in-call')).not.toBeInTheDocument()
  })

  it('keeps the disposition bar in the dock after a terminal call ends', () => {
    setDialer({
      view: 'expanded',
      mode: 'keypad',
      phase: 'completed',
      terminalStatus: 'no-answer',
      activeCall: { orgId: 'org-9', callId: 'call-9', recording: false },
    })
    render(<DialerDock />)

    expect(screen.getByTestId('disposition-bar')).toHaveAttribute('data-terminal-status', 'no-answer')
  })

  it('shows the running duration in the title bar during a call', () => {
    setDialer({
      view: 'expanded',
      mode: 'call',
      phase: 'in-progress',
      elapsedSeconds: 65,
      activeCall: { orgId: 'org-1', callId: 'call-1', recording: false },
    })
    render(<DialerDock />)

    expect(screen.getByLabelText('Call duration')).toHaveTextContent('01:05')
    expect(screen.getByTestId('in-call')).toBeInTheDocument()
  })

  it('shows no duration when idle', () => {
    setDialer({ phase: 'idle' })
    render(<DialerDock />)

    expect(screen.queryByLabelText('Call duration')).not.toBeInTheDocument()
  })
})
