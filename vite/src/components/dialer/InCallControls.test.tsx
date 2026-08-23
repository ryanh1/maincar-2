import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

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
const { useDialerMock, useEndCallMock, useGetActivityMock, muteCallMock, mutateMock, toastErrorMock } = vi.hoisted(() => ({
  useDialerMock: vi.fn(),
  useEndCallMock: vi.fn(),
  useGetActivityMock: vi.fn(),
  muteCallMock: vi.fn(),
  mutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/components/dialer/dialerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dialerContext')>()),
  useDialer: useDialerMock,
}))
vi.mock('@/hooks/dialer', () => ({ useEndCall: useEndCallMock }))
vi.mock('@/hooks/crm', () => ({ useGetActivity: useGetActivityMock }))
vi.mock('@/providers/useAuth', () => ({ useAuth: () => ({ user: { timeZone: 'America/New_York' } }) }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

beforeEach(() => {
  vi.clearAllMocks()
  useDialerMock.mockReturnValue({
    phase: 'in-progress',
    elapsedSeconds: 0,
    canControlAudio: true,
    muteCall: muteCallMock,
  })
  useEndCallMock.mockReturnValue({ mutate: mutateMock, isPending: false })
  useGetActivityMock.mockReturnValue({
    data: {
      activity: [
        {
          id: 'activity-1', sourceType: 'call', sourceId: 'call-prior-1', summary: 'Completed call',
          preview: 'Asked for a demo.', direction: 'outbound', occurredAt: '2026-08-23T15:00:00.000Z',
          createdByUserId: 'user-1', companyId: 'company-1', personId: 'person-2', dealId: null,
          createdAt: '2026-08-23T15:00:00.000Z',
        },
      ],
      page: 1,
      limit: 3,
      hasMore: false,
    },
    isPending: false,
    isError: false,
  })
})

function renderControls(props: Partial<Parameters<typeof InCallControls>[0]> = {}) {
  return renderWithProviders(<InCallControls orgId="org-1" callId="call-1" {...props} />)
}

describe('InCallControls', () => {
  it('renders the elapsed time from context as mm:ss', () => {
    useDialerMock.mockReturnValue({
      phase: 'in-progress',
      elapsedSeconds: 75,
      canControlAudio: true,
      muteCall: muteCallMock,
    })
    renderControls()

    expect(screen.getByText('Call duration', { selector: '.sr-only' })).toBeInTheDocument()
    expect(screen.getByText('01:15')).toBeInTheDocument()
  })

  it('shows status text derived from the phase', () => {
    useDialerMock.mockReturnValue({
      phase: 'ringing',
      elapsedSeconds: 0,
      canControlAudio: true,
      muteCall: muteCallMock,
    })
    const { rerender } = renderControls()
    expect(screen.getByText('Ringing')).toBeInTheDocument()

    useDialerMock.mockReturnValue({
      phase: 'in-progress',
      elapsedSeconds: 0,
      canControlAudio: true,
      muteCall: muteCallMock,
    })
    rerender(withProviders(<InCallControls orgId="org-1" callId="call-1" />))
    expect(screen.getByText('Connected')).toBeInTheDocument()

    useDialerMock.mockReturnValue({
      phase: 'completed',
      elapsedSeconds: 0,
      canControlAudio: true,
      muteCall: muteCallMock,
    })
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

  it('shows an accessible recording dot and announces recording state changes', async () => {
    const { rerender } = renderControls({ recording: false })
    expect(screen.queryByRole('img', { name: 'Recording' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    rerender(withProviders(<InCallControls orgId="org-1" callId="call-1" recording />))
    const indicator = screen.getByRole('img', { name: 'Recording' })
    expect(indicator).toHaveClass('size-2', 'bg-destructive')
    expect(indicator).toHaveAttribute('tabindex', '0')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Recording started.'))

    fireEvent.focus(indicator)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Recording')

    rerender(withProviders(<InCallControls orgId="org-1" callId="call-1" recording={false} />))
    expect(screen.queryByRole('img', { name: 'Recording' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Recording stopped.'))
  })

  it('renders no hold control — the Voice SDK Call has no hold method to wire it to', () => {
    renderControls()

    expect(screen.queryByRole('button', { name: 'Hold the call' })).not.toBeInTheDocument()
  })

  it('hides mute when this tab recovered a call without a Voice SDK connection', () => {
    useDialerMock.mockReturnValue({
      phase: 'in-progress',
      elapsedSeconds: 0,
      canControlAudio: false,
      muteCall: muteCallMock,
    })
    renderControls()

    expect(screen.queryByRole('button', { name: 'Mute the call' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End the call' })).toBeInTheDocument()
  })

  it('shows a linked company\'s prior calls only after the collapsed strip is expanded', () => {
    renderControls({ companyId: 'company-1', companyName: 'Acme' })

    const priorCalls = screen.getByRole('button', { name: 'Prior calls at Acme' })
    expect(priorCalls).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Completed call')).not.toBeInTheDocument()
    expect(useGetActivityMock).toHaveBeenCalledWith(
      'org-1',
      { companyId: 'company-1' },
      { sourceType: 'call', limit: 3 },
    )

    fireEvent.click(priorCalls)

    expect(priorCalls).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Completed call')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Asked for a demo.')).toBeInTheDocument()
  })

  it('does not render a prior-call strip when the live call has no linked company', () => {
    renderControls()

    expect(screen.queryByRole('button', { name: /Prior calls at/ })).not.toBeInTheDocument()
  })

  it('gives every icon-only control a verb-and-object accessible name', () => {
    renderControls({ recording: true })

    // Each icon button owes a screen reader a name that is a verb phrase naming
    // both the action and its object — "Mute the call", never a lone "Mute".
    // The name comes from IconButton's required `tooltip`, so the visible
    // tooltip and the accessible name are the same string.
    expect(screen.getByRole('button', { name: 'Mute the call' })).toBeInTheDocument()
    const endCall = screen.getByRole('button', { name: 'End the call' })
    expect(endCall).toBeInTheDocument()
    expect(endCall.querySelector('svg.lucide-phone')).toHaveClass('rotate-[135deg]')
    expect(screen.getByText('Call duration', { selector: '.sr-only' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Call controls' })).toBeInTheDocument()
  })
})
