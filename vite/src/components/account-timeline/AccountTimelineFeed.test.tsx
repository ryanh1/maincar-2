import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'
import { AccountTimelineFeed } from './AccountTimelineFeed'
import { groupFeedItemsByDay } from './feedGroups'
import { mapAccountTimelineEvent } from '@/components/activity-feed/activityFeed'

const EVENT = {
  id: 'event-1', sourceType: 'email' as const, sourceId: 'email-1', title: 'Sent proposal', preview: null,
  subtype: null, intensity: 2 as const, display: { actorName: 'Grace Hopper' }, marker: null, direction: 'outbound' as const,
  occurredAt: '2026-08-22T18:00:00.000Z', companyId: 'company-1', personId: 'person-1', dealId: 'deal-1',
}

describe('AccountTimelineFeed', () => {
  it('groups feed rows by the viewing user’s calendar day and keeps selection when another page arrives', () => {
    const first = mapAccountTimelineEvent(EVENT)
    const older = { ...first, id: 'event-2', occurredAt: '2026-08-21T18:00:00.000Z', title: 'Left voicemail' }
    const nextPage = { ...older, id: 'event-3', title: 'Created follow-up task' }
    const { rerender } = renderWithProviders(
      <AccountTimelineFeed items={[first, older]} state="ready" timeZone="America/New_York" selectedEventId="event-1" />,
    )

    expect(groupFeedItemsByDay([first, older], 'America/New_York')).toHaveLength(2)
    expect(screen.getByText('Aug 22, 2026')).toBeInTheDocument()
    expect(screen.getByText('Aug 21, 2026')).toBeInTheDocument()
    expect(screen.getByText('Sent proposal').closest('article')).toHaveAttribute('aria-current', 'true')

    rerender(
      <AccountTimelineFeed items={[first, older, nextPage]} state="ready" timeZone="America/New_York" selectedEventId="event-1" />,
    )
    expect(screen.getByText('Sent proposal').closest('article')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Created follow-up task')).toBeInTheDocument()
  })

  it('renders honest empty and error states, with retry only for a failed request', () => {
    const retry = vi.fn()
    const { rerender } = renderWithProviders(<AccountTimelineFeed items={[]} state="empty" timeZone="America/New_York" />)
    expect(screen.getByText('No activity in this range.')).toBeInTheDocument()

    rerender(<AccountTimelineFeed items={[]} state="error" timeZone="America/New_York" onRetry={retry} />)
    expect(screen.getByText('Could not load activity.')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('exposes a keyboard-accessible selection control when the caller handles event selection', () => {
    const onEventSelect = vi.fn()
    renderWithProviders(
      <AccountTimelineFeed items={[mapAccountTimelineEvent(EVENT)]} state="ready" timeZone="America/New_York" onEventSelect={onEventSelect} />,
    )

    screen.getByRole('button', { name: 'Sent proposal' }).click()
    expect(onEventSelect).toHaveBeenCalledWith('event-1')
  })
})
