import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AccountTimelineEvent, AccountTimelineRange } from '@/lib/accountTimelineTypes'
import { renderWithProviders } from '@/test/utils'
import { AccountTimelineWorkspace } from './AccountTimelineWorkspace'

const RANGE: AccountTimelineRange = {
  from: '2026-08-22T00:00:00.000Z',
  to: '2026-08-23T00:00:00.000Z',
  isDefault: true,
}

const EVENT: AccountTimelineEvent = {
  id: 'event-1',
  sourceType: 'email',
  sourceId: 'email-1',
  title: 'Sent proposal',
  preview: null,
  subtype: null,
  intensity: 2,
  display: { actorName: 'Grace Hopper' },
  marker: null,
  direction: 'outbound',
  occurredAt: '2026-08-22T14:00:00.000Z',
  companyId: 'company-1',
  personId: 'person-1',
  dealId: 'deal-1',
}

const OLDER_EVENT: AccountTimelineEvent = {
  ...EVENT,
  id: 'event-2',
  sourceId: 'call-1',
  sourceType: 'call',
  title: 'Reviewed pricing',
  occurredAt: '2026-08-22T12:00:00.000Z',
}

describe('AccountTimelineWorkspace', () => {
  it('synchronizes band selection and feed movement without a scroll feedback loop', async () => {
    const user = userEvent.setup()
    const onEventSelect = vi.fn()
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    function Harness() {
      const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null)
      return (
        <AccountTimelineWorkspace
          events={[EVENT, OLDER_EVENT]}
          state="ready"
          range={RANGE}
          timeZone="America/New_York"
          now={new Date('2026-08-22T18:00:00.000Z')}
          selectedEventId={null}
          highlightedEventId={highlightedEventId}
          onEventSelect={onEventSelect}
          onHighlightedEventChange={setHighlightedEventId}
        />
      )
    }
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole('button', { name: /Email: Sent proposal/ }))
    expect(onEventSelect).toHaveBeenCalledWith('event-1')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
    expect(screen.getByRole('button', { name: /Email: Sent proposal/ })).toHaveAttribute('aria-current', 'true')

    const feed = screen.getByRole('feed', { name: 'Account activity' })
    const rows = [...feed.querySelectorAll<HTMLElement>('[data-event-id]')]
    vi.spyOn(feed, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ top: 260 } as DOMRect)
    vi.spyOn(rows[1], 'getBoundingClientRect').mockReturnValue({ top: 108 } as DOMRect)
    fireEvent.scroll(feed)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Call: Reviewed pricing/ })).toHaveAttribute('aria-current', 'true')
    })
    expect(onEventSelect).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })
})
