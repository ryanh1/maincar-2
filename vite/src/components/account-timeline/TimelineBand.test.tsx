import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AccountTimelineEvent, AccountTimelineRange } from '@/lib/accountTimelineTypes'
import { renderWithProviders } from '@/test/utils'
import { TimelineBand } from './TimelineBand'

const NOW = new Date('2026-08-22T18:00:00.000Z')
const RANGE: AccountTimelineRange = {
  from: '2026-08-22T00:00:00.000Z',
  to: '2026-08-23T00:00:00.000Z',
  isDefault: true,
}

const EVENTS: AccountTimelineEvent[] = [
  {
    id: 'event-outbound',
    sourceType: 'email',
    sourceId: 'email-1',
    title: 'Sent proposal',
    preview: null,
    subtype: null,
    intensity: 2,
    display: { actorName: 'Grace Hopper', personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
    marker: null,
    direction: 'outbound',
    occurredAt: '2026-08-22T14:00:00.000Z',
    companyId: 'company-1',
    personId: 'person-1',
    dealId: 'deal-1',
  },
  {
    id: 'event-inbound',
    sourceType: 'call',
    sourceId: 'call-1',
    title: 'Ada called back',
    preview: null,
    subtype: null,
    intensity: 4,
    display: { personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
    marker: null,
    direction: 'inbound',
    occurredAt: '2026-08-22T16:00:00.000Z',
    companyId: 'company-1',
    personId: 'person-1',
    dealId: 'deal-1',
  },
  {
    id: 'event-stage',
    sourceType: 'stage_change',
    sourceId: 'stage-1',
    title: 'Moved to Proposal',
    preview: null,
    subtype: 'stage_changed',
    intensity: 1,
    display: { actorName: 'Grace Hopper', dealName: 'Enterprise renewal' },
    marker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
    direction: null,
    occurredAt: '2026-08-22T17:00:00.000Z',
    companyId: 'company-1',
    personId: null,
    dealId: 'deal-1',
  },
]

describe('TimelineBand', () => {
  it('renders positioned activity lanes, the deal ribbon, now, and an explicit future region', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TimelineBand events={EVENTS} range={RANGE} timeZone="America/New_York" now={NOW} />,
    )

    expect(screen.getByText('Outbound')).toBeInTheDocument()
    expect(screen.getByText('Inbound')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('separator', { name: 'Now' })).toBeInTheDocument()
    expect(screen.getByLabelText('Future timeline region')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deal stage moved from Discovery to Proposal' })).toBeInTheDocument()

    const bubble = screen.getByRole('button', {
      name: 'Email: Sent proposal, Aug 22, 2026, 10:00 AM EDT',
    })
    expect(bubble).toHaveAttribute('data-intensity', '2')
    expect(bubble).toHaveAttribute('data-timeline-position', expect.stringMatching(/^\d+(\.\d+)?%$/))

    await user.hover(bubble)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Email · Sent proposal · Aug 22, 2026, 10:00 AM EDT',
    )
  })

  it('renders each deal lifecycle marker once when paged event data repeats an item', () => {
    const created = { ...EVENTS[2], id: 'event-created', marker: { type: 'deal_created' as const } }
    const won = { ...EVENTS[2], id: 'event-won', marker: { type: 'closed_won' as const } }
    const lost = { ...EVENTS[2], id: 'event-lost', marker: { type: 'closed_lost' as const } }
    renderWithProviders(
      <TimelineBand events={[created, created, EVENTS[2], won, lost]} range={RANGE} timeZone="America/New_York" now={NOW} />,
    )

    expect(screen.getAllByRole('button', { name: 'Deal created' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Deal stage moved from Discovery to Proposal' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Deal closed won' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Deal closed lost' })).toHaveLength(1)
  })

  it('expands direction lanes into the people represented by each event', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TimelineBand events={EVENTS} range={RANGE} timeZone="America/New_York" now={NOW} />,
    )

    expect(screen.queryByText('Grace Hopper', { selector: '[data-person-lane]' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show people' }))
    expect(screen.getByText('Grace Hopper', { selector: '[data-person-lane]' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace', { selector: '[data-person-lane]' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide people' })).toBeInTheDocument()
  })

  it('supports keyboard bubble navigation and exposes the highlighted event', async () => {
    const user = userEvent.setup()
    const onEventSelect = vi.fn()
    renderWithProviders(
      <TimelineBand
        events={EVENTS}
        range={RANGE}
        timeZone="America/New_York"
        now={NOW}
        highlightedEventId="event-inbound"
        onEventSelect={onEventSelect}
      />,
    )

    const outbound = screen.getByRole('button', { name: /Email: Sent proposal/ })
    const inbound = screen.getByRole('button', { name: /Call: Ada called back/ })
    expect(inbound).toHaveAttribute('aria-current', 'true')

    outbound.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(inbound).toHaveFocus()
    expect(onEventSelect).toHaveBeenCalledWith('event-inbound')
  })

  it('reframes the shared range with presets, pan controls, and bubble zoom', async () => {
    const user = userEvent.setup()
    const onRangeChange = vi.fn()
    renderWithProviders(
      <TimelineBand
        events={EVENTS}
        range={RANGE}
        timeZone="America/New_York"
        now={NOW}
        onRangeChange={onRangeChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Week' }))
    const weekRange = onRangeChange.mock.calls.at(-1)?.[0]
    expect(Date.parse(weekRange.to) - Date.parse(weekRange.from)).toBe(7 * 24 * 60 * 60 * 1000)

    await user.click(screen.getByRole('button', { name: 'Pan the timeline forward' }))
    const pannedRange = onRangeChange.mock.calls.at(-1)?.[0]
    expect(Date.parse(pannedRange.from)).toBe(Date.parse(RANGE.to))

    await user.click(screen.getByRole('button', { name: /Call: Ada called back/ }))
    const zoomedRange = onRangeChange.mock.calls.at(-1)?.[0]
    expect(Date.parse(zoomedRange.to) - Date.parse(zoomedRange.from)).toBeLessThan(
      Date.parse(RANGE.to) - Date.parse(RANGE.from),
    )
  })

  it('keeps a manually panned historical range at full width instead of compressing it toward now', () => {
    const historicalRange: AccountTimelineRange = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      isDefault: false,
    }
    renderWithProviders(
      <TimelineBand events={[]} range={historicalRange} timeZone="America/New_York" now={NOW} />,
    )

    expect(screen.queryByRole('separator', { name: 'Now' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Future timeline region')).not.toBeInTheDocument()
  })
})
