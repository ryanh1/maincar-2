import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import type { AccountTimelineEvent } from '@/lib/accountTimelineTypes'
import { renderWithProviders } from '@/test/utils'
import { AccountTimelineRecordTab } from './AccountTimelineRecordTab'

const EVENT: AccountTimelineEvent = {
  id: 'event-1',
  sourceType: 'task',
  sourceId: 'task-1',
  title: 'Prepare renewal brief',
  preview: 'Share the brief before the next call.',
  subtype: null,
  intensity: 2,
  display: { actorName: 'Grace Hopper', personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
  marker: null,
  direction: 'outbound',
  occurredAt: '2026-08-22T18:00:00.000Z',
  companyId: 'company-1',
  personId: 'person-1',
  dealId: 'deal-1',
}

const mocks = vi.hoisted(() => ({
  getTimeline: vi.fn(),
  getDetail: vi.fn(),
}))

vi.mock('@/hooks/accountTimeline', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/accountTimeline')>('@/hooks/accountTimeline')
  return {
    ...actual,
    useGetAccountTimeline: mocks.getTimeline,
    useGetAccountTimelineDetail: mocks.getDetail,
  }
})
vi.mock('@/hooks/crm', () => ({
  useGetRelatedRecords: () => ({ data: { related: [] } }),
}))

beforeEach(() => {
  sessionStorage.clear()
  mocks.getTimeline.mockReturnValue({
    events: [EVENT],
    state: 'ready',
    data: { pages: [{ range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true } }] },
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  })
  mocks.getDetail.mockImplementation((_orgId, _root, eventId) => ({
    data: eventId ? {
      detail: { type: 'task', id: 'task-1', title: 'Prepare renewal brief', isDone: false },
      navigation: { previousEventId: null, nextEventId: null },
    } : undefined,
  }))
})

describe('AccountTimelineRecordTab', () => {
  it('scopes every shared timeline view to the company and remembers its filters', async () => {
    const user = userEvent.setup()
    const root = { type: 'company' as const, id: 'company-1' }
    renderWithProviders(<AccountTimelineRecordTab orgId="org-1" objectId="company-object" root={root} timeZone="America/New_York" />)

    expect(mocks.getTimeline).toHaveBeenCalledWith('org-1', root, {})
    expect(screen.getByRole('combobox', { name: 'Contact' })).toHaveTextContent('All contacts')
    expect(screen.getByRole('combobox', { name: 'Deal' })).toHaveTextContent('All deals')

    await user.click(screen.getByRole('combobox', { name: 'Activity type' }))
    await user.click(screen.getByRole('option', { name: 'Tasks' }))
    await user.click(screen.getByRole('combobox', { name: 'Contact' }))
    await user.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    await user.click(screen.getByRole('combobox', { name: 'Deal' }))
    await user.click(screen.getByRole('option', { name: 'Enterprise renewal' }))
    const filters = { sourceType: 'task' as const, personId: 'person-1', dealId: 'deal-1' }
    await waitFor(() => expect(mocks.getTimeline).toHaveBeenLastCalledWith('org-1', root, filters))
    expect(sessionStorage.getItem('account-timeline-filters:org-1:company:company-1')).toContain('task')

    await user.click(within(screen.getByRole('feed', { name: 'Account activity' })).getByRole('button', { name: 'Prepare renewal brief' }))
    expect(mocks.getDetail).toHaveBeenLastCalledWith('org-1', root, 'event-1', filters)
    expect(screen.getByRole('dialog', { name: 'task' })).toBeInTheDocument()
  })

  it('uses a deal root without exposing invalid company-only filters', () => {
    const root = { type: 'deal' as const, id: 'deal-1' }
    renderWithProviders(<AccountTimelineRecordTab orgId="org-1" objectId="deal-object" root={root} timeZone="America/New_York" />)

    expect(mocks.getTimeline).toHaveBeenCalledWith('org-1', root, {})
    expect(screen.queryByRole('combobox', { name: 'Contact' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Deal' })).not.toBeInTheDocument()
  })
})
