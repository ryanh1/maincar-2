import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
    screen.getByRole('button', { name: 'Show the previous timeline event' }).click()
    expect(onNavigate).toHaveBeenCalledWith('event-newer')
    screen.getByRole('button', { name: 'Show the next timeline event' }).click()
    expect(onNavigate).toHaveBeenCalledWith('event-older')
  })

  it('uses arrow shortcuts for filtered detail navigation, ignores editable targets, and closes with Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onNavigate = vi.fn()
    renderWithProviders(
      <AccountTimelineDetailPanel
        open
        onOpenChange={onOpenChange}
        detail={{ type: 'note', id: 'note-1', body: 'Confirmed the rollout plan.' }}
        navigation={{ previousEventId: 'event-newer', nextEventId: 'event-older' }}
        onNavigate={onNavigate}
      />,
    )

    const panel = screen.getByRole('dialog', { name: 'note' })
    panel.focus()
    await user.keyboard('{ArrowLeft}{ArrowRight}')
    expect(onNavigate.mock.calls).toEqual([['event-newer'], ['event-older']])

    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Detail note')
    panel.append(input)
    input.focus()
    await user.keyboard('{ArrowLeft}')
    expect(onNavigate).toHaveBeenCalledTimes(2)

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
