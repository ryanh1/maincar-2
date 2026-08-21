import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DEVICE_CHOICE_KEY } from '@/lib/deviceStorage'

// vi.hoisted() makes the mock fns, vi.mock() swaps the module, and the component
// is imported AFTER both so the mock is in place when its graph loads.
const { useGetDevicesMock } = vi.hoisted(() => ({ useGetDevicesMock: vi.fn() }))
vi.mock('@/hooks/devices', () => ({ useGetDevices: useGetDevicesMock }))

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
// jsdom implements neither, so the whole test button is simulated here.

const oscillatorStart = vi.fn()
const oscillatorStop = vi.fn()
const gainRamp = vi.fn()
const contextClose = vi.fn().mockResolvedValue(undefined)
const setSinkId = vi.fn().mockResolvedValue(undefined)
const trackStop = vi.fn()
const getUserMedia = vi.fn()

/** Byte value written into every analyser frame: 128 is silence. */
let analyserSample = 128

class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  close = contextClose
  setSinkId = setSinkId
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
  createAnalyser() {
    return {
      fftSize: 2048,
      getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(analyserSample),
    }
  }
}

function fakeStream() {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream
}

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
  // One frame, not an endless loop: the real rAF would keep the meter ticking
  // for the whole test file.
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  // Chrome and Edge have this; Firefox and Safari do not. jsdom does not either,
  // so the tests that want a working speaker picker add it.
  ;(HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId = () =>
    Promise.resolve()
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

describe('DeviceCheck', () => {
  it('renders a microphone and a speaker dropdown filled from the devices', async () => {
    const user = userEvent.setup()
    render(<DeviceCheck />)

    expect(micTrigger()).toHaveTextContent('Default - MacBook Pro Microphone')
    expect(speakerTrigger()).toHaveTextContent('Default - MacBook Pro Speakers')

    await user.click(micTrigger())

    expect(await screen.findByRole('option', { name: 'Headset Microphone' })).toBeInTheDocument()
  })

  it('says the microphone is allowed once the devices are read', () => {
    render(<DeviceCheck />)

    expect(screen.getByText('Microphone allowed.')).toBeInTheDocument()
  })

  it('says it is checking while the read is in flight', () => {
    mockDevices({ isLoading: true, microphones: [], speakers: [] })

    render(<DeviceCheck />)

    expect(screen.getByText('Checking your microphone.')).toBeInTheDocument()
  })

  // The hook's sentence already names the rep's next action, so it is shown
  // verbatim rather than wrapped in a generic message.
  it('shows the permission error verbatim and still renders', () => {
    const denied =
      'Maincar needs your microphone to make calls. Allow microphone access in your browser settings, then try again.'
    mockDevices({ error: denied, microphones: [], speakers: [] })

    render(<DeviceCheck />)

    expect(screen.getByText(denied)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(micTrigger()).toBeDisabled()
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

    it('disables the speaker dropdown and says why', () => {
      render(<DeviceCheck />)

      expect(speakerTrigger()).toBeDisabled()
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

  describe('the test button', () => {
    it('plays a ramped beep through the chosen speaker', async () => {
      const user = userEvent.setup()
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() => expect(oscillatorStart).toHaveBeenCalled())
      expect(oscillatorStop).toHaveBeenCalled()
      // Ramped, not switched on at full volume — otherwise it is a click, not a tone.
      expect(gainRamp).toHaveBeenCalled()
      expect(setSinkId).toHaveBeenCalledWith('default')
      expect(await screen.findByText(/Speaker: beep played/)).toBeInTheDocument()
    })

    it('opens the chosen microphone', async () => {
      const user = userEvent.setup()
      window.localStorage.setItem(
        DEVICE_CHOICE_KEY,
        JSON.stringify({ microphoneId: 'mic-headset', speakerId: null }),
      )
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() =>
        expect(getUserMedia).toHaveBeenCalledWith({
          audio: { deviceId: { exact: 'mic-headset' } },
        }),
      )
    })

    it('reports that the microphone registered a voice', async () => {
      const user = userEvent.setup()
      analyserSample = 200
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      expect(await screen.findByText('Microphone: your voice registered.')).toBeInTheDocument()
      expect(screen.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute(
        'aria-valuenow',
        '100',
      )
    })

    // A device check that leaves the mic hot is worse than no check.
    it('stops every microphone track when the rep stops the test', async () => {
      const user = userEvent.setup()
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled())

      await user.click(await screen.findByRole('button', { name: 'Stop test' }))

      expect(trackStop).toHaveBeenCalled()
      expect(contextClose).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
    })

    it('stops every microphone track when the component unmounts mid-test', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled())

      unmount()

      expect(trackStop).toHaveBeenCalled()
    })

    it('falls back to the default microphone when the chosen one is gone', async () => {
      const user = userEvent.setup()
      getUserMedia.mockRejectedValueOnce(new Error('OverconstrainedError'))
      getUserMedia.mockResolvedValueOnce(fakeStream())
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true }))
    })

    it('names the next action when the microphone cannot be opened at all', async () => {
      const user = userEvent.setup()
      getUserMedia.mockRejectedValue(new Error('NotAllowedError'))
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      expect(
        await screen.findByText(
          'Could not open that microphone. Pick another one, then test again.',
        ),
      ).toBeInTheDocument()
    })

    it('reports a speaker that refused to play, and still tests the microphone', async () => {
      const user = userEvent.setup()
      class BlockedContext extends FakeAudioContext {
        resume = vi.fn().mockRejectedValue(new DOMException('NotAllowedError'))
      }
      vi.stubGlobal('AudioContext', BlockedContext)
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      expect(
        await screen.findByText(
          'Speaker: could not play the beep. Pick another speaker, then test again.',
        ),
      ).toBeInTheDocument()
      // One failure does not cancel the other half of the check.
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    })

    it('names the next action when the microphone opens but cannot be read', async () => {
      const user = userEvent.setup()
      class NoSourceContext extends FakeAudioContext {
        createMediaStreamSource(): never {
          throw new DOMException('InvalidStateError')
        }
      }
      vi.stubGlobal('AudioContext', NoSourceContext)
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      expect(
        await screen.findByText(
          'Could not read that microphone. Pick another one, then test again.',
        ),
      ).toBeInTheDocument()
      // The mic is released rather than left hot behind a failed read.
      await waitFor(() => expect(trackStop).toHaveBeenCalled())
    })

    // `fireEvent`, not `userEvent`: userEvent's own timer plumbing deadlocks
    // against vitest's fake clock, and the only thing this test needs from the
    // click is that it happened.
    it('says nothing came through when the mic stays silent for the whole test', async () => {
      vi.useFakeTimers()
      try {
        analyserSample = 128 // silence
        render(<DeviceCheck />)

        fireEvent.click(screen.getByRole('button', { name: 'Test' }))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(getUserMedia).toHaveBeenCalled()

        // The run closes itself after TEST_DURATION_MS rather than holding the mic
        // open for as long as the page lives.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000)
        })

        expect(
          screen.getByText('Microphone: nothing came through. Pick another one, then test again.'),
        ).toBeInTheDocument()
        expect(trackStop).toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('names the next action when the browser cannot open a microphone at all', async () => {
      const user = userEvent.setup()
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      expect(
        await screen.findByText(
          'Could not open that microphone. Pick another one, then test again.',
        ),
      ).toBeInTheDocument()
    })

    // Nothing else holds a reference to this stream, so if the late arrival is not
    // released here the recording indicator stays lit for the life of the page.
    it('releases a microphone that arrives after the rep has already stopped the test', async () => {
      const user = userEvent.setup()
      let release: (stream: MediaStream) => void = () => {}
      getUserMedia.mockImplementation(
        () => new Promise<MediaStream>((resolve) => (release = resolve)),
      )
      render(<DeviceCheck />)

      await user.click(screen.getByRole('button', { name: 'Test' }))
      await user.click(await screen.findByRole('button', { name: 'Stop test' }))
      expect(trackStop).not.toHaveBeenCalled()

      await act(async () => {
        release(fakeStream())
      })

      expect(trackStop).toHaveBeenCalledTimes(1)
    })

    it('is disabled with a reason when the browser has no Web Audio', () => {
      vi.stubGlobal('AudioContext', undefined)
      render(<DeviceCheck />)

      expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled()
      expect(
        screen.getByText(/Your browser can.t play test audio. Open Maincar in Chrome or Edge./),
      ).toBeInTheDocument()
    })
  })
})
