import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SpeakerRibbon } from '@/components/call-review/SpeakerRibbon'
import { renderWithProviders } from '@/test/utils'

const SEGMENTS = [
  { id: 'segment-1', speakerKey: 'rep', startMs: 0, endMs: 2_000, position: 0, text: 'Hello', words: [] },
  { id: 'segment-2', speakerKey: 'buyer', startMs: 2_000, endMs: 5_000, position: 1, text: 'Hi', words: [] },
]

function renderRibbon(overrides: Partial<Parameters<typeof SpeakerRibbon>[0]> = {}) {
  return renderWithProviders(
    <SpeakerRibbon
      duration={10}
      currentTime={3}
      segments={SEGMENTS}
      speakers={[{ speakerKey: 'rep', label: 'You' }, { speakerKey: 'buyer', label: 'Morgan Lee' }]}
      bufferedRanges={[{ start: 0, end: 8 }]}
      playedRanges={[{ start: 0, end: 3 }]}
      selectionRange={{ start: 2, end: 5 }}
      searchTicks={[{ id: 'search-1', time: 4 }]}
      commentPins={[{ id: 'comment-1', time: 7 }]}
      onSeek={vi.fn()}
      {...overrides}
    />,
  )
}

describe('SpeakerRibbon', () => {
  it('renders labeled speaker lanes with semantic colors and every marker extension point', () => {
    renderRibbon()

    expect(screen.getByRole('region', { name: 'Speaker activity' })).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Morgan Lee')).toBeInTheDocument()
    expect(screen.getAllByTestId('speaker-ribbon-segment')).toHaveLength(2)
    expect(screen.getAllByTestId('speaker-ribbon-segment')[0]).toHaveStyle({ backgroundColor: 'var(--option-2)' })
    expect(screen.getByTestId('speaker-ribbon-buffered-range')).toBeInTheDocument()
    expect(screen.getByTestId('speaker-ribbon-played-range')).toBeInTheDocument()
    expect(screen.getByTestId('speaker-ribbon-selection-range')).toBeInTheDocument()
    expect(screen.getByTestId('speaker-ribbon-marker-search-1')).toBeInTheDocument()
    expect(screen.getByTestId('speaker-ribbon-marker-comment-1')).toBeInTheDocument()
  })

  it('seeks once from keyboard and pointer input through the accessible slider', () => {
    const onSeek = vi.fn()
    renderRibbon({ onSeek })
    const slider = screen.getByRole('slider', { name: 'Seek call recording' })

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onSeek).toHaveBeenLastCalledWith(8)

    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}),
    })
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(5)
    expect(onSeek).toHaveBeenCalledTimes(2)
    expect(slider).toHaveAttribute('aria-valuenow', '3')
  })

  it('activates a comment pin once without also seeking through the ribbon surface', () => {
    const onSeek = vi.fn()
    const onCommentActivate = vi.fn()
    renderRibbon({ onSeek, onCommentActivate })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open comment at 00:07' }), { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Open comment at 00:07' }))

    expect(onCommentActivate).toHaveBeenCalledWith('comment-1', 7)
    expect(onCommentActivate).toHaveBeenCalledTimes(1)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('keeps the seek surface honest when duration is unavailable', () => {
    renderRibbon({ duration: 0, currentTime: 0, segments: [] })

    expect(screen.getByRole('slider', { name: 'Seek call recording' })).toHaveAttribute('aria-valuemax', '0')
    expect(screen.getByText('Call duration is not available.')).toBeInTheDocument()
  })
})
