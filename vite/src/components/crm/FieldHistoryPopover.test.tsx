import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, withProviders } from '@/test/utils'
import type { AttributeDef, FieldHistoryEntry } from '@/lib/crmTypes'
import { FieldHistoryPopover } from './FieldHistoryPopover'

const useGetFieldHistory = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/crm', () => ({ useGetFieldHistory }))

const attribute = {
  id: 'stage',
  slug: 'stage',
  name: 'Stage',
  type: 'status',
  optionsJson: [
    { value: 'demo', label: 'Demo', color: 'option-1' },
    { value: 'won', label: 'Closed — Won', color: 'option-2' },
  ],
} as AttributeDef

function entry(overrides: Partial<FieldHistoryEntry> = {}): FieldHistoryEntry {
  return {
    id: 'history-1',
    recordId: 'deal-1',
    attribute: 'stage',
    oldValue: 'demo',
    newValue: 'won',
    changedByUserId: 'user-1',
    actor: { name: 'Ana Ruiz', avatarUrl: null },
    changeSource: 'user',
    reason: null,
    changedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  }
}

function queryResult(history: FieldHistoryEntry[] = [entry()]) {
  return {
    data: { pages: [{ history, nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }
}

describe('FieldHistoryPopover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T02:00:00.000Z'))
    useGetFieldHistory.mockReset()
    useGetFieldHistory.mockReturnValue(queryResult())
  })

  afterEach(() => vi.useRealTimers())

  it('renders actor, time, and colored status chips', () => {
    renderWithProviders(
      <FieldHistoryPopover orgId="org-1" recordId="deal-1" attribute={attribute} timeZone="America/New_York" />,
    )

    expect(useGetFieldHistory).toHaveBeenLastCalledWith('org-1', null, null)
    fireEvent.click(screen.getByRole('button', { name: 'Show Stage history' }))
    expect(useGetFieldHistory).toHaveBeenLastCalledWith('org-1', 'deal-1', 'stage')

    expect(screen.getByRole('heading', { name: 'Stage history' })).toBeInTheDocument()
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument()
    const time = screen.getByText('2 hours ago')
    expect(time).toHaveAttribute('title', 'Aug 23, 2026, 8:00 PM EDT')
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getByText('Closed — Won')).toBeInTheDocument()
    expect(screen.getAllByTestId('option-chip-color')).toHaveLength(2)
  })

  it('opens the history clock from the keyboard', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderWithProviders(
      <FieldHistoryPopover orgId="org-1" recordId="deal-1" attribute={attribute} timeZone="America/New_York" />,
    )

    const trigger = screen.getByRole('button', { name: 'Show Stage history' })
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('heading', { name: 'Stage history' })).toBeInTheDocument()
  })

  it('renders first-set and cleared edge cases with System attribution', () => {
    useGetFieldHistory.mockReturnValue(queryResult([
      entry({ id: 'history-set', oldValue: null, newValue: 'demo', changedByUserId: null, actor: null, changeSource: 'import' }),
      entry({ id: 'history-clear', oldValue: 'won', newValue: null }),
    ]))

    renderWithProviders(
      <FieldHistoryPopover orgId="org-1" recordId="deal-1" attribute={attribute} timeZone="America/New_York" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show Stage history' }))

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('System')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('— → Demo')
    expect(rows[1]).toHaveTextContent('Closed — Won → —')
  })

  it('handles loading, error, empty, and cursor paging states', () => {
    const fetchNextPage = vi.fn()
    useGetFieldHistory.mockReturnValue({
      ...queryResult([]),
      data: { pages: [{ history: [], nextCursor: 'next' }] },
      hasNextPage: true,
      fetchNextPage,
    })
    const { rerender } = renderWithProviders(
      <FieldHistoryPopover orgId="org-1" recordId="deal-1" attribute={attribute} timeZone="America/New_York" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show Stage history' }))
    expect(screen.getByText('No field history yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(fetchNextPage).toHaveBeenCalledOnce()

    useGetFieldHistory.mockReturnValue({ ...queryResult([]), data: undefined, isPending: true })
    rerender(withProviders(<FieldHistoryPopover orgId="org-1" recordId="deal-1" attribute={attribute} timeZone="America/New_York" />))
    expect(screen.getByText('Loading field history…')).toBeInTheDocument()

    useGetFieldHistory.mockReturnValue({ ...queryResult([]), data: undefined, isError: true })
    rerender(withProviders(<FieldHistoryPopover orgId="org-1" recordId="deal-1" attribute={attribute} timeZone="America/New_York" />))
    expect(screen.getByText('Could not load field history.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload history' })).toBeInTheDocument()
  })
})
