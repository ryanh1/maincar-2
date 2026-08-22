import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DEVICE_CHOICE_KEY } from '@/lib/deviceStorage'

// vi.hoisted() makes the mock fns, vi.mock() swaps the module, and the component
// is imported AFTER both so the mock is in place when its graph loads.
const { useGetDevicesMock } = vi.hoisted(() => ({ useGetDevicesMock: vi.fn() }))
// `useNetworkStatus` is left real — it only reads `navigator.onLine` and two
// window events, and the network-status tests below flip that flag directly.
vi.mock('@/hooks/devices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/devices')>()
  return { ...actual, useGetDevices: useGetDevicesMock }
})

import { DeviceCheck } from '@/components/DeviceCheck'

const MICROPHONES = [
  { deviceId: 'default', label: 'Default - MacBook Pro Microphone', groupId: 'g1' },
  { deviceId: 'mic-headset', label: 'Headset Microphone', groupId: 'g2' },
]
const SPEAKERS = [
  { deviceId: 'default', label: 'Default - MacBook Pro Speakers', groupId: 'g1' },
  { deviceId: 'spk-headset', label: 'Headset Speakers', groupId: 'g2' },
]

function mockDevices(overrides: Record<string, unknown> = {}) {
  useGetDevicesMock.mockReturnValue({
    microphones: MICROPHONES,
    speakers: SPEAKERS,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  })
}

// --- Web Audio and getUserMedia doubles ------------------------------------
// jsdom implements neither, so both the mic meter and the speaker test are
// simulated here.

const oscillatorStart = vi.fn()
const oscillatorStop = vi.fn()
const gainRamp = vi.fn()
const contextClose = vi.fn().mockResolvedValue(undefined)
// The element-level `setSinkId`, not the (nonstandard) context-level one — the
// beep now has to leave through an `<audio>` element for the same reason
// `browserCanChooseSpeaker` checks `HTMLMediaElement.prototype` in the first
// place. See MAI-225.
const setSinkId = vi.fn().mockResolvedValue(undefined)
const audioPlay = vi.fn().mockResolvedValue(undefined)
const trackStop = vi.fn()
const getUserMedia = vi.fn()

/** Byte value written into every analyser frame: 128 is silence. */
let analyserSample = 128

class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  close = contextClose
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: oscillatorStart,
      stop: oscillatorStop,
    }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: gainRamp },
      connect: vi.fn(),
    }
  }
  createMediaStreamSource() {
    return { connect: vi.fn() }
  }
  createMediaStreamDestination() {
    return { stream: fakeMediaStream() }
  }
  createAnalyser() {
    return {
      fftSize: 2048,
      connect: vi.fn(),
      getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(analyserSample),
    }
  }
}

function fakeStream() {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream
}

/** What `createMediaStreamDestination().stream` hands to the `<audio>` element. */
function fakeMediaStream() {
  return { getTracks: () => [] } as unknown as MediaStream
}

// Outside `vi.useFakeTimers()`, jsdom has no `requestAnimationFrame` at all, so
// this stub stands in — one call, no loop, exactly what the old suite relied
// on. Under fake timers Vitest's own clock takes `requestAnimationFrame` over
// and actually drives the loop as time advances, which is what the mic-meter
// tests below use to observe more than one frame.
beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  analyserSample = 128
  mockDevices()

  getUserMedia.mockResolvedValue(fakeStream())
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  // Chrome and Edge have this; Firefox and Safari do not. jsdom does not either,
  // so the tests that want a working speaker picker add it.
  ;(HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId = setSinkId
  // jsdom has no real media pipeline: `.play()` rejects "not implemented" and
  // `srcObject` is not a real property, so both are stubbed for the beep's
  // `<audio>` element.
  HTMLMediaElement.prototype.play = audioPlay
  HTMLMediaElement.prototype.pause = vi.fn()
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() {
      return null
    },
    set() {},
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId
})

function micTrigger() {
  return screen.getByRole('combobox', { name: 'Microphone' })
}
function speakerTrigger() {
  return screen.getByRole('combobox', { name: 'Speaker' })
}
function micMeter() {
  return screen.getByRole('meter', { name: 'Microphone level' })
}
function speakerMeter() {
  return screen.getByRole('meter', { name: 'Speaker level' })
}

describe('DeviceCheck', () => {
  it('renders a microphone and a speaker dropdown filled from the devices', async () => {
    const user = userEvent.setup()
    render(<DeviceCheck />)

    expect(micTrigger()).toHaveTextContent('Default - MacBook Pro Microphone')
    expect(speakerTrigger()).toHaveTextContent('Default - MacBook Pro Speakers')

    await user.click(micTrigger())

    expect(await screen.findByRole('option', { name: 'Headset Microphone' })).toBeInTheDocument()
  })

  it('does not repeat status-strip copy after the devices are read', () => {
    render(<DeviceCheck />)

    expect(screen.queryByText('Check your audio')).not.toBeInTheDocument()
    expect(screen.queryByText('Microphone allowed.')).not.toBeInTheDocument()
    expect(screen.queryByText('Connected.')).not.toBeInTheDocument()
  })

  // MAI-213: one row per device, no separate "Test" button for the mic and no
  // status-strip text describing each result.
  it('has no manual Test button — only the speaker gets one', () => {
    render(<DeviceCheck />)

    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test speaker' })).toBeInTheDocument()
  })

  it('renders an empty meter for each device before anything is heard', () => {
    render(<DeviceCheck />)

    expect(micMeter()).toHaveAttribute('aria-valuenow', '0')
    expect(speakerMeter()).toHaveAttribute('aria-valuenow', '0')
  })

  it('says it is checking while the read is in flight', () => {
    mockDevices({ isLoading: true, microphones: [], speakers: [] })

    render(<DeviceCheck />)

    expect(screen.getByText('Checking your microphone.')).toBeInTheDocument()
  })

  it('shows a permission request link and still renders', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    const denied = 'Allow the microphone in your browser settings to start calling.'
    mockDevices({ error: denied, microphones: [], speakers: [], refetch })

    render(<DeviceCheck />)

    expect(screen.getByRole('button', { name: 'Allow your microphone' })).toBeInTheDocument()
    expect(screen.getByText('in your browser settings to start calling.')).toBeInTheDocument()
    expect(micTrigger()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Allow your microphone' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('re-reads the devices when the rep retries after a denial', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockDevices({ error: 'No microphone found. Plug one in, then try again.', refetch })
    render(<DeviceCheck />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('persists the chosen microphone and restores it on remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<DeviceCheck />)

    await user.click(micTrigger())
    await user.click(await screen.findByRole('option', { name: 'Headset Microphone' }))

    await waitFor(() => expect(micTrigger()).toHaveTextContent('Headset Microphone'))
    expect(JSON.parse(window.localStorage.getItem(DEVICE_CHOICE_KEY) ?? '{}')).toMatchObject({
      microphoneId: 'mic-headset',
    })

    unmount()
    render(<DeviceCheck />)

    expect(micTrigger()).toHaveTextContent('Headset Microphone')
  })

  // A dropdown pointing at hardware that is not there is a lie.
  it('falls back to the system default when the saved device is unplugged', () => {
    window.localStorage.setItem(
      DEVICE_CHOICE_KEY,
      JSON.stringify({ microphoneId: 'mic-unplugged', speakerId: 'spk-unplugged' }),
    )

    render(<DeviceCheck />)

    expect(micTrigger()).toHaveTextContent('Default - MacBook Pro Microphone')
    expect(speakerTrigger()).toHaveTextContent('Default - MacBook Pro Speakers')
  })

  it('does not crash when localStorage refuses the write', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    render(<DeviceCheck />)

    await user.click(micTrigger())
    await user.click(await screen.findByRole('option', { name: 'Headset Microphone' }))

    await waitFor(() => expect(micTrigger()).toHaveTextContent('Headset Microphone'))
  })

  describe('when the browser cannot switch speakers', () => {
    beforeEach(() => {
      delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId
    })

    it('disables the speaker dropdown and the test button, and says why', () => {
      render(<DeviceCheck />)

      expect(speakerTrigger()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Test speaker' })).toBeDisabled()
      expect(
        screen.getByText("Your browser can't switch speakers — change it in your system settings."),
      ).toBeInTheDocument()
      // The microphone picker is unaffected — only the speaker needs setSinkId.
      expect(micTrigger()).toBeEnabled()
    })
  })

  it('says so when no microphone is plugged in', () => {
    mockDevices({ microphones: [] })

    render(<DeviceCheck />)

    expect(micTrigger()).toBeDisabled()
    expect(
      screen.getByText('No microphone found. Plug one in, then choose it here.'),
    ).toBeInTheDocument()
  })

  it('persists the chosen speaker separately from the microphone', async () => {
    const user = userEvent.setup()
    render(<DeviceCheck />)

    await user.click(speakerTrigger())
    await user.click(await screen.findByRole('option', { name: 'Headset Speakers' }))

    await waitFor(() => expect(speakerTrigger()).toHaveTextContent('Headset Speakers'))
    // The microphone half of the choice is left exactly as it was.
    expect(JSON.parse(window.localStorage.getItem(DEVICE_CHOICE_KEY) ?? '{}')).toEqual({
      microphoneId: null,
      speakerId: 'spk-headset',
    })
  })

  // Chrome hands back an empty label for the default device even after a grant, so
  // a raw label would render a blank row the rep cannot choose between.
  it('names a device the browser did not name', async () => {
    const user = userEvent.setup()
    mockDevices({
      microphones: [
        { deviceId: 'default', label: '', groupId: 'g1' },
        { deviceId: 'mic-2', label: '', groupId: 'g2' },
      ],
    })
    render(<DeviceCheck />)

    expect(micTrigger()).toHaveTextContent('Default microphone')

    await user.click(micTrigger())

    expect(await screen.findByRole('option', { name: 'Microphone 2' })).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // The microphone: continuous meter, no button
  // ---------------------------------------------------------------------------

  describe('the microphone meter', () => {
    it('opens the chosen microphone as soon as it is selected, with no click', async () => {
      render(<DeviceCheck />)

      await waitFor(() =>
        expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'default' } } }),
      )
    })

    it('opens a device chosen from storage on mount', async () => {
      window.localStorage.setItem(
        DEVICE_CHOICE_KEY,
        JSON.stringify({ microphoneId: 'mic-headset', speakerId: null }),
      )
      render(<DeviceCheck />)

      await waitFor(() =>
        expect(getUserMedia).toHaveBeenCalledWith({
          audio: { deviceId: { exact: 'mic-headset' } },
        }),
      )
    })

    it('shows the live level once the microphone reports a signal', async () => {
      analyserSample = 200
      render(<DeviceCheck />)

      await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
      await waitFor(() => expect(micMeter()).toHaveAttribute('aria-valuenow', '100'))
    })

    it('re-opens the microphone when the rep picks a different one', async () => {
      const user = userEvent.setup()
      render(<DeviceCheck />)
      await waitFor(() =>
        expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'default' } } }),
      )

      await user.click(micTrigger())
      await user.click(await screen.findByRole('option', { name: 'Headset Microphone' }))

      await waitFor(() =>
        expect(getUserMedia).toHaveBeenCalledWith({
          audio: { deviceId: { exact: 'mic-headset' } },
        }),
      )
      // The old device's stream is released, not left hot in the background.
      expect(trackStop).toHaveBeenCalled()
    })

    it('stops the microphone when the component unmounts', async () => {
      const { unmount } = render(<DeviceCheck />)
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled())

      unmount()

      expect(trackStop).toHaveBeenCalled()
      expect(contextClose).toHaveBeenCalled()
    })

    it('shows a nudge after 4s of silence, and clears it once real signal arrives', async () => {
      vi.useFakeTimers()
      try {
        analyserSample = 128 // silence
        render(<DeviceCheck />)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(getUserMedia).toHaveBeenCalled()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(4_000)
        })
        expect(
          screen.getByText(
            "We're not picking up any sound. Try picking another microphone above.",
          ),
        ).toBeInTheDocument()

        analyserSample = 200
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50)
        })

        expect(
          screen.queryByText(
            "We're not picking up any sound. Try picking another microphone above.",
          ),
        ).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('never shows the silence nudge once the mic has heard something', async () => {
      vi.useFakeTimers()
      try {
        analyserSample = 200 // heard immediately
        render(<DeviceCheck />)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4_000)
        })

        expect(
          screen.queryByText(
            "We're not picking up any sound. Try picking another microphone above.",
          ),
        ).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('falls back to the default microphone when the chosen one is gone', async () => {
      getUserMedia.mockRejectedValueOnce(new Error('OverconstrainedError'))
      getUserMedia.mockResolvedValueOnce(fakeStream())
      render(<DeviceCheck />)

      await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true }))
    })

    it('is disabled with a reason when the browser has no Web Audio', () => {
      vi.stubGlobal('AudioContext', undefined)
      render(<DeviceCheck />)

      expect(
        screen.getByText(/Your browser can.t play test audio. Open Maincar in Chrome or Edge./),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Test speaker' })).toBeDisabled()
    })
  })

  // ---------------------------------------------------------------------------
  // The speaker: a single press, an envelope tied to the actual tone
  // ---------------------------------------------------------------------------

  describe('the speaker test', () => {
    it('plays a ramped beep through the chosen speaker', async () => {
      const user = userEvent.setup()
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test speaker' }))

      await waitFor(() => expect(oscillatorStart).toHaveBeenCalled())
      expect(oscillatorStop).toHaveBeenCalled()
      // Ramped, not switched on at full volume — otherwise it is a click, not a tone.
      expect(gainRamp).toHaveBeenCalled()
      expect(setSinkId).toHaveBeenCalledWith('default')
    })

    it('moves the speaker meter off the beep signal, not a fixed animation', async () => {
      const user = userEvent.setup()
      analyserSample = 200
      render(<DeviceCheck />)

      expect(speakerMeter()).toHaveAttribute('aria-valuenow', '0')

      await user.click(screen.getByRole('button', { name: 'Test speaker' }))

      await waitFor(() => expect(speakerMeter()).toHaveAttribute('aria-valuenow', '100'))
    })

    it('shows a retry note after every press, not only on failure', async () => {
      const user = userEvent.setup()
      render(<DeviceCheck />)

      expect(
        screen.queryByText("Didn't hear anything? Choose another speaker above."),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Test speaker' }))

      expect(
        await screen.findByText("Didn't hear anything? Choose another speaker above."),
      ).toBeInTheDocument()
    })

    it('shows the retry note even when the speaker fails to play', async () => {
      const user = userEvent.setup()
      class BlockedContext extends FakeAudioContext {
        resume = vi.fn().mockRejectedValue(new DOMException('NotAllowedError'))
      }
      vi.stubGlobal('AudioContext', BlockedContext)
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test speaker' }))

      expect(
        await screen.findByText("Didn't hear anything? Choose another speaker above."),
      ).toBeInTheDocument()
    })

    it('says so when no speaker is plugged in', () => {
      mockDevices({ speakers: [] })

      render(<DeviceCheck />)

      expect(speakerTrigger()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Test speaker' })).toBeDisabled()
      expect(
        screen.getByText('No speaker found. Plug one in, then choose it here.'),
      ).toBeInTheDocument()
    })
  })
})
