import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  TimedTranscript,
  type TimedTranscriptSelection,
} from '@/components/call-review/TimedTranscript'
import type { TimedTranscriptSegment } from '@/lib/callTypes'
import { renderWithProviders, withProviders } from '@/test/utils'

const SEGMENTS: TimedTranscriptSegment[] = [
  {
    id: 'segment-1',
    position: 0,
    speakerKey: 'rep',
    startMs: 0,
    endMs: 1_000,
    text: 'Hello world.',
    words: [
      { word: 'Hello', punctuatedWord: 'Hello', startMs: 0, endMs: 400 },
      { word: 'world', punctuatedWord: 'world.', startMs: 500, endMs: 900 },
    ],
  },
  {
    id: 'segment-2',
    position: 1,
    speakerKey: 'buyer',
    startMs: 1_200,
    endMs: 2_500,
    text: 'The renewal plan works.',
    words: [
      { word: 'The', punctuatedWord: 'The', startMs: 1_200, endMs: 1_400 },
      { word: 'renewal', punctuatedWord: 'renewal', startMs: 1_450, endMs: 1_800 },
      { word: 'plan', punctuatedWord: 'plan', startMs: 1_850, endMs: 2_050 },
      { word: 'works', punctuatedWord: 'works.', startMs: 2_100, endMs: 2_400 },
    ],
  },
  {
    id: 'segment-3',
    position: 2,
    speakerKey: 'rep',
    startMs: 2_700,
    endMs: 3_600,
    text: 'Renewal is next.',
    words: [
      { word: 'Renewal', punctuatedWord: 'Renewal', startMs: 2_700, endMs: 3_000 },
      { word: 'is', punctuatedWord: 'is', startMs: 3_050, endMs: 3_200 },
      { word: 'next', punctuatedWord: 'next.', startMs: 3_250, endMs: 3_500 },
    ],
  },
]

function transcript(overrides: Partial<ComponentProps<typeof TimedTranscript>> = {}) {
  return (
    <TimedTranscript
      segments={SEGMENTS}
      speakerLabels={{ rep: 'You', buyer: 'Morgan Lee' }}
      currentTimeMs={0}
      onSeek={vi.fn()}
      onSearchTicksChange={vi.fn()}
      onSelectionChange={vi.fn()}
      {...overrides}
    />
  )
}

describe('TimedTranscript', () => {
  it('renders diarized timed words and routes segment and word seeks to their durable anchors', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderWithProviders(transcript({ onSeek }))

    expect(screen.getAllByText('You')).toHaveLength(2)
    expect(screen.getByText('Morgan Lee')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '00:01' }))
    await user.click(screen.getByRole('button', { name: 'renewal, 00:01' }))

    expect(onSeek).toHaveBeenNthCalledWith(1, 1_200)
    expect(onSeek).toHaveBeenNthCalledWith(2, 1_450)
  })

  it('marks only the current segment and word without announcing every playback update', () => {
    renderWithProviders(transcript({ currentTimeMs: 1_500 }))

    expect(screen.getByTestId('transcript-segment-segment-2')).toHaveAttribute('data-current', 'true')
    expect(screen.getByRole('button', { name: 'renewal, 00:01' })).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('status', { name: /current word/i })).not.toBeInTheDocument()

    fireEvent.focus(screen.getByRole('button', { name: 'renewal, 00:01' }))
    expect(screen.getByText('00:01', { selector: '[data-word-time]' })).toBeVisible()
  })

  it('pauses auto-follow on manual scroll and resumes only from Jump to current', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { rerender } = renderWithProviders(transcript({ currentTimeMs: 100 }))
    scrollIntoView.mockClear()

    fireEvent.wheel(screen.getByRole('region', { name: 'Timed transcript' }))
    rerender(withProviders(transcript({ currentTimeMs: 1_500 })))

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Jump to current' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Jump to current' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Jump to current' })).not.toBeInTheDocument()
  })

  it('highlights search matches, navigates both directions, and emits ribbon ticks', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    const onSearchTicksChange = vi.fn()
    renderWithProviders(transcript({ onSeek, onSearchTicksChange }))

    await user.type(screen.getByRole('searchbox', { name: 'Search transcript' }), 'renewal')

    expect(screen.getAllByText(/renewal/i, { selector: 'mark' })).toHaveLength(2)
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(onSearchTicksChange).toHaveBeenLastCalledWith([
      { id: 'transcript-search-0', time: 1.45 },
      { id: 'transcript-search-1', time: 2.7 },
    ])

    await user.click(screen.getByRole('button', { name: 'Next transcript match' }))
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(onSeek).toHaveBeenLastCalledWith(2_700)

    await user.click(screen.getByRole('button', { name: 'Previous transcript match' }))
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(onSeek).toHaveBeenLastCalledWith(1_450)
  })

  it('emits an exact typed range with millisecond and character anchors', () => {
    const selections: TimedTranscriptSelection[] = []
    renderWithProviders(transcript({ onSelectionChange: (selection) => { if (selection) selections.push(selection) } }))
    const hello = screen.getByText('Hello', { selector: '[data-transcript-piece]' }).firstChild
    const world = screen.getByText('world.', { selector: '[data-transcript-piece]' }).firstChild
    if (!hello || !world) throw new Error('Timed word text nodes did not render')
    const range = document.createRange()
    range.setStart(hello, 1)
    range.setEnd(world, 6)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.mouseUp(screen.getByTestId('timed-transcript-content'))

    expect(selections).toEqual([{
      atMs: 0,
      startMs: 0,
      endMs: 900,
      quote: 'ello world.',
      startChar: 1,
      endChar: 12,
    }])
  })

  it('keeps focus stable while a long transcript follows playback', async () => {
    const user = userEvent.setup()
    Element.prototype.scrollIntoView = vi.fn()
    const longSegments = Array.from({ length: 120 }, (_, index): TimedTranscriptSegment => ({
      id: `long-${index}`,
      position: index,
      speakerKey: index % 2 === 0 ? 'rep' : 'buyer',
      startMs: index * 1_000,
      endMs: index * 1_000 + 900,
      text: `Word ${index}`,
      words: [{ word: 'Word', punctuatedWord: 'Word', startMs: index * 1_000, endMs: index * 1_000 + 400 }],
    }))
    const { rerender } = renderWithProviders(transcript({ segments: longSegments, currentTimeMs: 0 }))
    const search = screen.getByRole('searchbox', { name: 'Search transcript' })
    await user.click(search)

    rerender(withProviders(transcript({ segments: longSegments, currentTimeMs: 119_100 })))

    expect(search).toHaveFocus()
    expect(screen.getByTestId('transcript-segment-long-119')).toHaveAttribute('data-current', 'true')
    expect(within(screen.getByTestId('transcript-segment-long-119')).getByRole('button', { name: 'Word, 01:59' })).toHaveAttribute('aria-current', 'true')
  })

  it('keeps malformed provider words and opaque segment ids from breaking the transcript', () => {
    const malformedSegments = [{
      id: 'segment"]#opaque',
      position: 0,
      speakerKey: 'rep',
      startMs: 0,
      endMs: 1_000,
      text: 'Provider text remains readable.',
      words: { unexpected: true } as unknown as TimedTranscriptSegment['words'],
    }]

    renderWithProviders(transcript({ segments: malformedSegments, currentTimeMs: 100 }))

    expect(screen.getByText('Provider text remains readable.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Provider,/ })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search transcript' })).toHaveAttribute('maxlength', '200')
  })
})
