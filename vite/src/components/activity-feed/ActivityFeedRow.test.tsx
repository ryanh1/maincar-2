import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { ActivityFeedRow } from './ActivityFeedRow'
import { formatRelativeActivityTime, mapAccountTimelineEvent, mapActivityEntry } from './activityFeed'

const EVENT = {
  id: 'event-1',
  sourceType: 'call' as const,
  sourceId: 'call-1',
  title: 'Called Ada Lovelace',
  preview: 'Discussed the account plan and agreed to send a follow-up with the revised terms.',
  subtype: 'completed',
  intensity: 3 as const,
  display: { actorName: 'Grace Hopper', personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
  marker: null,
  direction: 'outbound' as const,
  occurredAt: '2026-08-22T18:00:00.000Z',
  companyId: 'company-1',
  personId: 'person-1',
  dealId: 'deal-1',
}

describe('ActivityFeedRow', () => {
  it('renders a typed event with actor, event metadata, relative time, and a zone-labeled detailed timestamp', () => {
    renderWithProviders(
      <ActivityFeedRow item={mapAccountTimelineEvent(EVENT)} timeZone="America/New_York" now={new Date('2026-08-22T18:05:00.000Z')} />,
    )

    expect(screen.getByText('Call')).toBeInTheDocument()
    expect(screen.getByText('Called Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText(/Grace Hopper/)).toBeInTheDocument()
    expect(screen.getByText(/Outbound/)).toBeInTheDocument()
    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument()
    expect(screen.getByText(/Aug 22, 2026, 2:00 PM EDT/)).toBeInTheDocument()
  })

  it('keeps long preview content collapsed until the person expands it', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ActivityFeedRow item={mapAccountTimelineEvent(EVENT)} timeZone="America/New_York" />,
    )

    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('maps the compact CRM activity response through the same row contract', () => {
    expect(mapActivityEntry({
      id: 'activity-1', sourceType: 'note', sourceId: 'note-1', summary: 'Added account notes', preview: 'Summary',
      direction: null, occurredAt: '2026-08-22T18:00:00.000Z', createdByUserId: null,
      companyId: 'company-1', personId: null, dealId: null, createdAt: '2026-08-22T18:00:00.000Z',
    })).toMatchObject({ id: 'activity-1', sourceType: 'note', title: 'Added account notes', preview: 'Summary' })
  })

  it('does not describe a future scheduled activity as already happening', () => {
    expect(formatRelativeActivityTime('2026-08-24T18:00:00.000Z', new Date('2026-08-22T18:00:00.000Z'))).toBe('in 2 days')
  })
})
