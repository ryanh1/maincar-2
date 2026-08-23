import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AudioPlayer } from '@/components/call-review/AudioPlayer'
import { renderWithProviders, withProviders } from '@/test/utils'

const SOURCE = {
  kind: 'audio' as const,
  url: 'https://recordings.example/signed/call-1.mp3',
  expiresAt: '2026-08-01T13:00:00.000Z',
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
})

afterEach(() => vi.restoreAllMocks())

function player(overrides: Partial<ComponentProps<typeof AudioPlayer>> = {}) {
  return <AudioPlayer source={SOURCE} recordingState="ready" callLabel="+12015550111" {...overrides} />
}

function renderPlayer(overrides: Partial<ComponentProps<typeof AudioPlayer>> = {}) {
  return renderWithProviders(player(overrides))
}

describe('AudioPlayer', () => {
  it('offers compact custom playback controls and all supported rates', () => {
    renderPlayer()

    expect(screen.getByRole('button', { name: 'Play recording' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek recording' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Recording volume' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Playback speed' })).toHaveTextContent('1×')
  })

  it('renders the synchronized speaker ribbon beneath the controls', () => {
    renderPlayer({
      segments: [{ speakerKey: 'rep', startMs: 0, endMs: 1_000 }],
      speakers: [{ speakerKey: 'rep', label: 'You' }],
    })
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 })
    fireEvent.loadedMetadata(audio)

    expect(screen.getByRole('region', { name: 'Speaker activity' })).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('seeks, toggles playback, and supports keyboard navigation outside editors', async () => {
    const user = userEvent.setup()
    renderPlayer()
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 120 })
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 30 })
    fireEvent.loadedMetadata(audio)

    await user.click(screen.getByRole('button', { name: 'Skip forward 15 seconds' }))
    expect(audio.currentTime).toBe(45)

    const seek = screen.getByRole('slider', { name: 'Seek recording' })
    seek.focus()
    await user.keyboard('{End}')
    expect(audio.currentTime).toBe(120)

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(audio.currentTime).toBe(105)

    fireEvent.keyDown(window, { key: ' ' })
    expect(audio.play).toHaveBeenCalled()
  })

  it('routes a ribbon seek through the media controller once', () => {
    const onSeek = vi.fn()
    renderPlayer({ onSeek })
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 120 })
    fireEvent.loadedMetadata(audio)
    const ribbon = screen.getByRole('slider', { name: 'Seek call recording' })
    vi.spyOn(ribbon, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}),
    })

    fireEvent.pointerDown(ribbon, { clientX: 25, pointerId: 1 })

    expect(audio.currentTime).toBe(30)
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(30)
  })

  it('does not capture shortcuts while an editor has focus', () => {
    renderPlayer()
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 30 })
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(audio.currentTime).toBe(30)
    input.remove()
  })

  it('keeps loading, buffering, and playback errors honest', () => {
    const { unmount } = renderPlayer({ recordingState: 'processing' })
    expect(screen.getByText('Recording is processing.')).toBeInTheDocument()

    unmount()
    renderPlayer()
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    fireEvent.waiting(audio)
    expect(screen.getByText('Buffering recording…')).toBeInTheDocument()
    fireEvent.error(audio)
    expect(screen.getByText('Recording could not play. Refresh the call and try again.')).toBeInTheDocument()
  })

  it('returns to loading when a signed source refreshes', () => {
    const { rerender } = renderPlayer()
    const audio = screen.getByLabelText('Recording of the call to +12015550111') as HTMLAudioElement
    fireEvent.loadedMetadata(audio)
    expect(screen.queryByText('Loading recording…')).not.toBeInTheDocument()

    rerender(withProviders(player({ source: { ...SOURCE, url: 'https://recordings.example/signed/call-1-refreshed.mp3' } })))

    expect(screen.getByText('Loading recording…')).toBeInTheDocument()
  })
})
