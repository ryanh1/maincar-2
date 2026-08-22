/**
 * MAI-24: the greenroom with its real neighbours attached.
 *
 * Every other suite in this feature mocks the module next door. `GreenRoom.test.tsx`
 * mocks `@/hooks/devices`, `DeviceCheck.test.tsx` mocks it too, and the hook suites
 * never render anything. Each half is proven against a stand-in for the other half,
 * which is exactly the shape of test that misses a disagreement between them.
 *
 * Nothing of ours is mocked here. `GreenRoom`, `DeviceCheck`, `useGetDevices`,
 * `useGreenRoomDecision`, `greenRoomSession` and `deviceStorage` are the real
 * modules, wired to each other. Only the browser is faked: `navigator.mediaDevices`,
 * `navigator.permissions`, and `AudioContext`, none of which jsdom implements.
 * `sessionStorage` and `localStorage` are jsdom's real ones, so the storage
 * round-trips are real round-trips.
 *
 * Two defects were found this way and no mocked suite could have seen either: a
 * second dial that stalled because each hook instance kept its own copy of the
 * record, and a blocked-mic guard that could not fire on the first dial because
 * `decide()` tested the missing record before the live denial. Both are fixed;
 * the tests that pinned them now pin the guarantees instead.
 */
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GreenRoom } from '@/components/GreenRoom'
import type { DeviceSelection } from '@/components/DeviceCheck'
import { useGreenRoomDecision } from '@/hooks/devices'
import { DEVICE_CHOICE_KEY } from '@/lib/deviceStorage'
import { __resetGreenRoomCheckStoreForTests } from '@/hooks/devices/greenRoomCheckStore'
import { GREEN_ROOM_SESSION_KEY, recordGreenRoomCheck } from '@/lib/greenRoomSession'
import type { GreenRoomCheck } from '@/hooks/devices'

// ---------------------------------------------------------------------------
// The browser, and only the browser
// ---------------------------------------------------------------------------

function deviceInfo(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: `group-${deviceId}`,
    toJSON: () => ({}),
  } as MediaDeviceInfo
}

const DEVICES = [
  deviceInfo('audioinput', 'default', 'Default - MacBook Pro Microphone'),
  deviceInfo('audioinput', 'mic-headset', 'Headset Microphone'),
  deviceInfo('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
]

const DENIED = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' })

interface BrowserOptions {
  /** What `permissions.query({ name: 'microphone' })` settles on. */
  permission?: PermissionState
  /** Pass null for a browser with no Permissions API at all (Safari, older Firefox). */
  permissionsApi?: null
  /** A promise the query waits on, for the "still deciding" window. */
  permissionGate?: Promise<void>
  /** Swap in a rejecting `getUserMedia` to block the microphone. */
  getUserMedia?: () => Promise<unknown>
  devices?: MediaDeviceInfo[]
}

function installBrowser(options: BrowserOptions = {}) {
  const stop = vi.fn()
  const deviceChangeListeners = new Set<() => void>()
  const getUserMedia = vi.fn(
    options.getUserMedia ?? (async () => ({ getTracks: () => [{ stop }] })),
  )
  const enumerateDevices = vi.fn(async () => options.devices ?? DEVICES)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices,
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'devicechange') deviceChangeListeners.add(listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'devicechange') deviceChangeListeners.delete(listener)
      }),
    },
  })

  if (options.permissionsApi === null) {
    Reflect.deleteProperty(navigator, 'permissions')
    return { getUserMedia, enumerateDevices, stop, emitDeviceChange: () => {
      act(() => {
        for (const listener of deviceChangeListeners) listener()
      })
    } }
  }

  const status = {
    state: options.permission ?? 'granted',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const query = vi.fn(async () => {
    if (options.permissionGate) await options.permissionGate
    return status
  })
  Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })
  return {
    getUserMedia,
    enumerateDevices,
    stop,
    query,
    status,
    emitDeviceChange: () => {
      act(() => {
        for (const listener of deviceChangeListeners) listener()
      })
    },
  }
}

/** jsdom has no Web Audio; enough of one that `DeviceCheck` renders its real controls. */
class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
  createMediaStreamSource() {
    return { connect: vi.fn() }
  }
  createAnalyser() {
    return { fftSize: 2048, getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(128) }
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  // The shared record outlives a test, so its cache is dropped alongside the
  // storage it caches. Tests that seed a record write it after this runs.
  __resetGreenRoomCheckStoreForTests()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  ;(HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId = () =>
    Promise.resolve()
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices')
  Reflect.deleteProperty(navigator, 'permissions')
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  window.localStorage.clear()
  __resetGreenRoomCheckStoreForTests()
})

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/**
 * What the dialer is meant to look like, per `GreenRoom`'s docstring: read the
 * decision, then either open the greenroom or dial straight through.
 *
 * Some tests still unmount and render again to prove the record survives a fresh
 * mount; others stay mounted, because a record made inside the dialog is now
 * visible to the caller holding its own instance of the decision hook.
 */
function Dialer({ onCall }: { onCall: (selection: DeviceSelection) => void }) {
  const { shouldShow } = useGreenRoomDecision()
  const [intent, setIntent] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() =>
          shouldShow ? setIntent(true) : onCall({ microphoneId: null, speakerId: null })
        }
      >
        Call
      </button>
      <GreenRoom
        open={intent}
        onOpenChange={setIntent}
        onConfirm={(selection) => {
          setIntent(false)
          onCall(selection)
        }}
      />
    </>
  )
}

function storedCheck(): GreenRoomCheck | null {
  const raw = window.sessionStorage.getItem(GREEN_ROOM_SESSION_KEY)
  return raw ? (JSON.parse(raw) as GreenRoomCheck) : null
}

/** The dialog is up and `useGetDevices` has finished its real read. */
async function waitForReadyDialog() {
  await screen.findByRole('dialog')
  await waitFor(() => expect(screen.queryByText('Checking your microphone.')).not.toBeInTheDocument())
}

// ---------------------------------------------------------------------------
// The first dial of a session
// ---------------------------------------------------------------------------

describe('the first dial of a session, end to end', () => {
  it('opens the greenroom, lists the devices the browser really reported, and hands the rep the one they picked', async () => {
    installBrowser()
    const user = userEvent.setup()
    const onCall = vi.fn()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()

    // The options came from enumerateDevices, through useGetDevices, into the picker.
    const microphone = screen.getByRole('combobox', { name: 'Microphone' })
    expect(microphone).toHaveTextContent('Default - MacBook Pro Microphone')
    await user.click(microphone)
    await user.click(await screen.findByRole('option', { name: 'Headset Microphone' }))
    await waitFor(() => expect(microphone).toHaveTextContent('Headset Microphone'))

    await user.click(screen.getByRole('button', { name: 'Start call' }))

    // The selection that reached the caller is the one the rep chose, resolved by
    // the real `resolveDeviceId` rather than by a mocked hook's return value.
    expect(onCall).toHaveBeenCalledWith({ microphoneId: 'mic-headset', speakerId: 'default' })
  })

  it('records the pass in session storage before the call starts, so the dial can never outrun the record', async () => {
    installBrowser()
    const user = userEvent.setup()
    // Reads storage at the moment the caller is handed control, which is the only
    // moment that matters: `onConfirm` may unmount the dialog on the spot.
    const atCallTime = vi.fn(() => storedCheck())
    render(<Dialer onCall={() => void atCallTime()} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    await user.click(screen.getByRole('button', { name: 'Start call' }))

    expect(atCallTime).toHaveBeenCalledTimes(1)
    expect(atCallTime.mock.results[0].value).toMatchObject({
      permission: 'granted',
      hasMicrophone: true,
      problem: null,
    })
  })

  it('saves the picked microphone to localStorage, where a later session will find it', async () => {
    installBrowser()
    const user = userEvent.setup()
    render(<Dialer onCall={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    await user.click(screen.getByRole('combobox', { name: 'Microphone' }))
    await user.click(await screen.findByRole('option', { name: 'Headset Microphone' }))

    // Device choice is a preference and lives in localStorage; the check result is
    // a session fact and lives in sessionStorage. Two stores, on purpose.
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(DEVICE_CHOICE_KEY) ?? '{}')).toMatchObject({
        microphoneId: 'mic-headset',
      }),
    )
    expect(window.sessionStorage.getItem(DEVICE_CHOICE_KEY)).toBeNull()
  })

  it('keeps the open greenroom up while a device change refreshes its microphone choices', async () => {
    const browser = installBrowser()
    const user = userEvent.setup()
    const onCall = vi.fn()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()

    browser.enumerateDevices.mockResolvedValue([
      deviceInfo('audioinput', 'mic-usb', 'USB Microphone'),
      deviceInfo('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
    ])
    browser.emitDeviceChange()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveTextContent(
        'USB Microphone',
      ),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The second dial — the whole reason the feature exists
// ---------------------------------------------------------------------------

describe('the second dial of a session', () => {
  it('skips the greenroom entirely once a pass is on record and permission has not moved', async () => {
    // The point of the feature: one interruption per session, not one per call.
    // Proven across the real boundary — `recordGreenRoomCheck` wrote it during the
    // first dial, `useGreenRoomDecision` reads it back on the second.
    installBrowser()
    const user = userEvent.setup()
    const onCall = vi.fn()
    const { unmount } = render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    await user.click(screen.getByRole('button', { name: 'Start call' }))
    expect(onCall).toHaveBeenCalledTimes(1)

    unmount()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the greenroom again when the first check found no microphone, because that was never a pass', async () => {
    // No audioinput at all: the primary action stays disabled, so a failed
    // readiness check cannot start a silent call. With no pass recorded, the
    // next dial starts over in the greenroom.
    installBrowser({
      devices: [deviceInfo('audiooutput', 'default', 'Default - MacBook Pro Speakers')],
    })
    const user = userEvent.setup()
    const onCall = vi.fn()
    const { unmount } = render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled()
    expect(onCall).not.toHaveBeenCalled()
    expect(storedCheck()).toBeNull()

    unmount()
    render(<Dialer onCall={onCall} />)
    await user.click(screen.getByRole('button', { name: 'Call' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('dials straight through for a caller holding its own decision instance, without remounting', async () => {
    // The guarantee: every instance of `useGreenRoomDecision` reads ONE record.
    // `GreenRoom` records the pass; the caller, holding its own instance of the
    // same hook, sees it on the very next render. No mocked suite could prove
    // this — `GreenRoom.test.tsx` gives both instances one mocked return value,
    // so they agree by construction. When they genuinely disagreed:
    //
    //   - the caller's instance still held `check: null` -> shouldShow, set intent
    //   - GreenRoom's instance had recorded the pass     -> 'retry', renders nothing
    //
    // and `GreenRoom` never auto-confirms, by design. The rep pressed Call and
    // nothing at all happened. The shared store in `greenRoomCheckStore` is what
    // keeps the two halves agreeing, and this test is what holds it there.
    installBrowser()
    const user = userEvent.setup()
    const onCall = vi.fn()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    await user.click(screen.getByRole('button', { name: 'Start call' }))
    expect(onCall).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Same tree, still mounted — a dialer working a list of sixty numbers.
    await user.click(screen.getByRole('button', { name: 'Call' }))

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the greenroom again after the browser reports a device change', async () => {
    const browser = installBrowser()
    const user = userEvent.setup()
    const onCall = vi.fn()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    await user.click(screen.getByRole('button', { name: 'Start call' }))
    expect(onCall).toHaveBeenCalledTimes(1)

    browser.enumerateDevices.mockResolvedValue([
      deviceInfo('audioinput', 'mic-usb', 'USB Microphone'),
      deviceInfo('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
    ])
    browser.emitDeviceChange()

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveTextContent('USB Microphone')
    expect(onCall).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// A blocked microphone, end to end
// ---------------------------------------------------------------------------

describe('a microphone blocked in browser settings', () => {
  it("carries getUserMedia's rejection through the hook into the device check, in the rep's words", async () => {
    installBrowser({ permission: 'denied', getUserMedia: () => Promise.reject(DENIED) })
    const user = userEvent.setup()
    render(<Dialer onCall={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await screen.findByRole('dialog')

    // The DOMException never reaches the rep; the permission action names the fix.
    expect(await screen.findByRole('button', { name: 'Allow your microphone' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toBeDisabled()
  })

  it('disables the primary button and names the fix once a recorded pass turns into a denial', async () => {
    // The reachable route to 'mic-denied': a pass earlier this session, and the rep
    // has since blocked the microphone. A call placed now would connect, bill, and
    // reach a prospect who hears nothing.
    recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })
    installBrowser({ permission: 'denied', getUserMedia: () => Promise.reject(DENIED) })
    const user = userEvent.setup()
    render(<Dialer onCall={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await screen.findByRole('dialog')

    expect(await screen.findByRole('button', { name: 'Allow your microphone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled()
    // Never a trap: the way out is always live.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('fires the blocked-mic guard on the first dial of a session, with nothing on record', async () => {
    // The guarantee: a live denial outranks a missing record. The first dial of a
    // session is the likeliest moment for a mic blocked in browser settings, and
    // it is also the one moment there is nothing recorded to compare against, so
    // `decide()` tests the denial BEFORE it tests the missing record. Both
    // reasons open the greenroom; only 'mic-denied' names the fix and disables
    // the button, and 'initial' used to win here — the rep got a live "Start
    // call" on a microphone the browser had blocked. `GreenRoom.test.tsx` pinned
    // reason='mic-denied' by hand and so could never have seen it.
    const onCall = vi.fn()
    installBrowser({ permission: 'denied', getUserMedia: () => Promise.reject(DENIED) })
    const user = userEvent.setup()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await screen.findByRole('dialog')
    await screen.findByRole('button', { name: 'Allow your microphone' })

    expect(screen.getByText('in your browser settings to start calling.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start call' })).toBeDisabled()

    // And the guard holds: pressing it records nothing and places no call.
    await user.click(screen.getByRole('button', { name: 'Start call' }))
    expect(onCall).not.toHaveBeenCalled()
    expect(storedCheck()).toBeNull()
    // Never a trap: the way out is always live.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// The flash MAI-23 warned about, with nothing mocked between the halves
// ---------------------------------------------------------------------------

describe('the pending-permission window', () => {
  it('never flashes the dialog open while the browser is still deciding about permission', async () => {
    // `permission` starts 'unknown' and settles a tick later. With a pass on record
    // that first tick reads as 'permission-changed' + shouldShow, so a dialog wired
    // straight to `shouldShow` opens and shuts. Here the recorded pass, the slow
    // query and the guard are all the real ones.
    recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { query } = installBrowser({ permission: 'granted', permissionGate: gate })

    render(<GreenRoom open onOpenChange={vi.fn()} onConfirm={vi.fn()} />)
    await waitFor(() => expect(query).toHaveBeenCalled())

    // Several turns of the microtask queue, with the answer still outstanding.
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }

    // And it stays shut once the answer lands, because it matches the record: 'retry'.
    await act(async () => {
      release()
      await gate
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// One vocabulary on both sides of storage
// ---------------------------------------------------------------------------

describe('the vocabulary written and the vocabulary read', () => {
  it('skips the second dial on a browser with no Permissions API, because both sides say "unknown"', async () => {
    // MAI-22 deliberately does NOT pass `permission` to `recordSession`, so the
    // stored value is whatever the hook itself read. On a browser with no
    // Permissions API that is 'unknown' on both sides, and 'unknown' === 'unknown'
    // is 'retry'. This is the test that pins that decision.
    installBrowser({ permissionsApi: null })
    const user = userEvent.setup()
    const onCall = vi.fn()
    const { unmount } = render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitForReadyDialog()
    await user.click(screen.getByRole('button', { name: 'Start call' }))

    expect(storedCheck()).toMatchObject({ permission: 'unknown', hasMicrophone: true })

    unmount()
    render(<Dialer onCall={onCall} />)
    await user.click(screen.getByRole('button', { name: 'Call' }))

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('locks the rep out of dialling entirely if a recorded permission is one the browser can never confirm', async () => {
    // The counterfactual that gives the rule above its teeth, and it turned out
    // worse than "one greenroom too many". `getUserMedia` succeeding is stronger
    // evidence than the Permissions API, so writing 'granted' into the record
    // looks like an improvement. On a browser that reads 'unknown' the stored
    // value can then never equal the live one, and the two halves deadlock:
    //
    //   decision -> 'permission-changed' + shouldShow, so the caller sets intent
    //   GreenRoom -> that same pair IS its pending-permission guard, so it
    //                renders nothing and waits for an answer that never comes
    //
    // No dialog, no call, no way forward. Not passing `permission` is what keeps
    // the pair equal, which decides 'retry', which dials. The state below is
    // built by hand precisely because the shipped code cannot produce it.
    recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })
    installBrowser({ permissionsApi: null })
    const user = userEvent.setup()
    const onCall = vi.fn()
    render(<Dialer onCall={onCall} />)

    await user.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()
  })
})
