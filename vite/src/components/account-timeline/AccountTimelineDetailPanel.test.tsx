import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'
import { AccountTimelineDetailPanel } from './AccountTimelineDetailPanel'

describe('AccountTimelineDetailPanel', () => {
  it('shows source-authoritative call content, a working full-call link, and filtered navigation', () => {
    const onOpenChange = vi.fn()
    const onNavigate = vi.fn()
    renderWithProviders(
      <AccountTimelineDetailPanel
        open
        onOpenChange={onOpenChange}
        detail={{ type: 'call', id: 'call-1', transcript: 'Discussed the proposal.', openFullCallPath: '/calls/call-1' }}
        navigation={{ previousEventId: 'event-newer', nextEventId: 'event-older' }}
        onNavigate={onNavigate}
      />,
    )

    expect(screen.getByText('Discussed the proposal.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open full call' })).toHaveAttribute('href', '/calls/call-1')
    screen.getByRole('button', { name: 'Previous timeline event' }).click()
    expect(onNavigate).toHaveBeenCalledWith('event-newer')
    screen.getByRole('button', { name: 'Next timeline event' }).click()
    expect(onNavigate).toHaveBeenCalledWith('event-older')
  })
})
