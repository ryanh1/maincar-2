import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { GreenRoomCheckResult, GreenRoomReason, MicPermission } from '@/hooks/devices'

// vi.hoisted() makes the mock fns, vi.mock() swaps the module, and the
// components are imported AFTER both so the mocks are in place when their graph
// loads. `@/hooks/devices` is the barrel both GreenRoom and DeviceCheck import
// from, so one mock covers both. MAI-24 covers the real integration.
const { useGetDevicesMock, useGreenRoomDecisionMock } = vi.hoisted(() => ({
  useGetDevicesMock: vi.fn(),
  useGreenRoomDecisionMock: vi.fn(),
}))
vi.mock('@/hooks/devices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/devices')>()
  return {
    ...actual,
    useGetDevices: useGetDevicesMock,
    useGreenRoomDecision: useGreenRoomDecisionMock,
  }
})

import { GreenRoom } from '@/components/GreenRoom'
import { useGreenRoomDecision } from '@/hooks/devices'

const MICROPHONES = [
  { deviceId: 'default', label: 'Default - MacBook Pro Microphone', groupId: 'g1' },
  { deviceId: 'mic-headset', label: 'Headset Microphone', groupId: 'g2' },
]
const SPEAKERS = [{ deviceId: 'default', label: 'Default - MacBook Pro Speakers', groupId: 'g1' }]

function mockDevices(overrides: Partial<Record<string, unknown>> = {}) {
  useGetDevicesMock.mockReturnValue({
    microphones: MICROPHONES,
    speakers: SPEAKERS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  })
}

/** The decision hook, pinned to one state. Returns the `recordSession` spy. */
function mockDecision(reason: GreenRoomReason, permission: MicPermission = 'granted') {
  const recordSession = vi.fn<(result: GreenRoomCheckResult) => void>()
  useGreenRoomDecisionMock.mockReturnValue({
    reason,
    shouldShow: reason !== 'retry',
    permission,
    recordSession,
  })
  return recordSession
}

/** The default happy setup: devices present, first check of the session. */
function setup(reason: GreenRoomReason = 'initial', permission: MicPermission = 'granted') {
  mockDevices()
  return mockDecision(reason, permission)
}

function renderGreenRoom(props: Partial<Parameters<typeof GreenRoom>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  const result = render(
    <GreenRoom open onOpenChange={onOpenChange} onConfirm={onConfirm} {...props} />,
  )
  return { onOpenChange, onConfirm, ...result }
}

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

describe('GreenRoom opening', () => {
  it('shows the title and the device check when the intent is set', () => {
    setup()
    renderGreenRoom()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Check your devices' })).toBeInTheDocument()
    // DeviceCheck itself, not a stand-in for it.
    expect(screen.getByRole('region', { name: 'Audio devices' })).toBeInTheDocument()
    expect(screen.getByLabelText('Microphone')).toBeInTheDocument()
    expect(screen.getByLabelText('Speaker')).toBeInTheDocument()
  })

  // MAI-211: DialerDock sits at z-[100] to clear the composer dock, and the
  // shared Dialog primitive has to stack above every fixed dock in the app, not
  // just this one, or the greenroom opens underneath a rep's own dialer.
  it('stacks above the dialer dock (MAI-211)', () => {
    setup()
    renderGreenRoom()

    expect(screen.getByRole('dialog').className).toContain('z-[150]')
  })

  it('renders nothing when the intent is not set', () => {
    setup()
    render(<GreenRoom open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Check your devices')).not.toBeInTheDocument()
  })

  it('stays shut while the browser has not answered about permission yet', () => {
    // The trap MAI-23 flagged: with a recorded pass in session storage, the very
    // first render reports 'permission-changed' + shouldShow for one tick before
    // settling on 'retry'. Opening on that tick flashes the dialog open and shut.
    setup('permission-changed', 'unknown')
    renderGreenRoom()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open when the rep unblocks the microphone mid-check', () => {
    // The decision flips 'mic-denied' -> 'retry' the moment the rep allows the
    // microphone in browser settings. Closing on that would leave them with a
    // working mic, no dialog, and no call.
    mockDevices({ error: 'Maincar needs your microphone to make calls.' })
    mockDecision('mic-denied', 'denied')
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    const { rerender } = render(
      <GreenRoom open onOpenChange={onOpenChange} onConfirm={onConfirm} />,
    )
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled()

    mockDevices()
    mockDecision('retry', 'granted')
    rerender(<GreenRoom open onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start call' })).toBeEnabled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('opens once a settled permission really has changed', () => {
    // The same reason with an answer behind it is a real change, and must show.
    setup('permission-changed', 'prompt')
    renderGreenRoom()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('GreenRoom closing', () => {
  it('closes on Escape and reports it to the parent', async () => {
    setup()
    const user = userEvent.setup()
    const { onOpenChange } = renderGreenRoom()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on Cancel without confirming', async () => {
    setup()
    const user = userEvent.setup()
    const { onOpenChange, onConfirm } = renderGreenRoom()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

describe('GreenRoom focus', () => {
  it('auto-focuses the primary button', () => {
    setup()
    renderGreenRoom()

    expect(screen.getByRole('button', { name: 'Start call' })).toHaveFocus()
  })

  it('traps focus inside the dialog', async () => {
    setup()
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Outside</button>
        <GreenRoom open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
      </>,
    )

    const dialog = screen.getByRole('dialog')
    // Enough tabs to walk past every control in the dialog and wrap around.
    for (let i = 0; i < 12; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    // `hidden: true`, because Radix marks everything outside a modal dialog
    // aria-hidden — which is itself half of what the trap is for.
    expect(screen.getByRole('button', { name: 'Outside', hidden: true })).not.toHaveFocus()
  })

  it('returns focus to the control that opened it', async () => {
    setup()
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Call
          </button>
          <GreenRoom open={open} onOpenChange={setOpen} onConfirm={vi.fn()} />
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Call' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Radix restores focus from the focus scope's cleanup, one macrotask later.
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

// ---------------------------------------------------------------------------
// Confirming
// ---------------------------------------------------------------------------

describe('GreenRoom confirm', () => {
  it('records the check before it hands the call over', async () => {
    const recordSession = setup()
    const user = userEvent.setup()
    const { onConfirm } = renderGreenRoom()

    const order: string[] = []
    recordSession.mockImplementation(() => order.push('record'))
    onConfirm.mockImplementation(() => order.push('confirm'))

    await user.click(screen.getByRole('button', { name: 'Start call' }))

    // Order is load-bearing: onConfirm starts the call and may unmount this
    // dialog, so a record written afterwards would never be written at all.
    expect(order).toEqual(['record', 'confirm'])
    expect(recordSession).toHaveBeenCalledWith({ hasMicrophone: true, problem: null })
    expect(onConfirm).toHaveBeenCalledWith({ microphoneId: 'default', speakerId: 'default' })
  })

  it('records the device error as the problem, so the next dial asks again', async () => {
    mockDevices({
      microphones: [],
      speakers: [],
      error: 'No microphone found. Plug one in, then try again.',
    })
    const recordSession = mockDecision('initial')
    const user = userEvent.setup()
    renderGreenRoom()

    await user.click(screen.getByRole('button', { name: 'Start call' }))

    expect(recordSession).toHaveBeenCalledWith({
      hasMicrophone: false,
      problem: 'No microphone found. Plug one in, then try again.',
    })
  })

  it('never records a permission of its own', async () => {
    // Letting `recordSession` default the permission keeps the stored value in
    // the same vocabulary the hook compares against next time. A value written
    // here would read as a permission change forever on a browser with no
    // Permissions API.
    const recordSession = setup()
    const user = userEvent.setup()
    renderGreenRoom()

    await user.click(screen.getByRole('button', { name: 'Start call' }))

    expect(recordSession.mock.calls[0][0]).not.toHaveProperty('permission')
  })

  it('takes the label the caller gives it', () => {
    setup()
    renderGreenRoom({ confirmLabel: 'Drop voicemail' })

    expect(screen.getByRole('button', { name: 'Drop voicemail' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start call' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The dead ends
// ---------------------------------------------------------------------------

describe('GreenRoom when the microphone is blocked', () => {
  it('names the fix and refuses to dial', () => {
    mockDevices({ error: 'Allow the microphone in your browser settings to start calling.' })
    mockDecision('mic-denied', 'denied')
    renderGreenRoom()

    expect(screen.getByRole('button', { name: 'Allow your microphone' })).toBeInTheDocument()
    // Never a live-looking control that cannot work.
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled()
    // Still an escape hatch, so the dialog is not a trap.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('leaves focus somewhere usable when the primary button is off', () => {
    mockDevices({ error: 'Maincar needs your microphone to make calls.' })
    mockDecision('mic-denied', 'denied')
    renderGreenRoom()

    expect(screen.getByRole('button', { name: 'Start call' })).not.toHaveFocus()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  })
})

// ---------------------------------------------------------------------------
// The contract with the caller
// ---------------------------------------------------------------------------

describe('the caller contract', () => {
  /**
   * What MAI-24 is expected to do: ask the decision, and either show the
   * greenroom or start the call. GreenRoom never auto-confirms, so a caller
   * that skipped this step on a 'retry' would simply never dial.
   */
  function Caller() {
    const { shouldShow } = useGreenRoomDecision()
    const [intent, setIntent] = useState(false)
    const [started, setStarted] = useState(false)
    return (
      <>
        <button type="button" onClick={() => (shouldShow ? setIntent(true) : setStarted(true))}>
          Call
        </button>
        {started && <span>Calling</span>}
        <GreenRoom open={intent} onOpenChange={setIntent} onConfirm={() => setStarted(true)} />
      </>
    )
  }

  it('skips straight to the call on a retry', async () => {
    setup('retry')
    const user = userEvent.setup()
    render(<Caller />)

    await user.click(screen.getByRole('button', { name: 'Call' }))

    expect(screen.getByText('Calling')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the greenroom first on the initial check', async () => {
    setup('initial')
    const user = userEvent.setup()
    render(<Caller />)

    await user.click(screen.getByRole('button', { name: 'Call' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('Calling')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start call' }))

    expect(screen.getByText('Calling')).toBeInTheDocument()
  })

  it('renders nothing at all when the check is not needed, even with intent set', () => {
    setup('retry')
    renderGreenRoom()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
