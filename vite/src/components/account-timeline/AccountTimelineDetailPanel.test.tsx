import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ComposerContext, type ComposerContextValue } from '@/components/composer/composerContext'
import { renderWithProviders, withProviders } from '@/test/utils'
import { AccountTimelineDetailPanel } from './AccountTimelineDetailPanel'

const { getCallDetail, updateTask, updateNote } = vi.hoisted(() => ({
  getCallDetail: vi.fn(),
  updateTask: vi.fn(),
  updateNote: vi.fn(),
}))

vi.mock('@/hooks/dialer', () => ({ useGetCallDetail: getCallDetail }))
vi.mock('@/hooks/tasks', () => ({ useUpdateTask: () => ({ mutateAsync: updateTask, isPending: false }) }))
vi.mock('@/hooks/crm', () => ({ useUpdateNote: () => ({ mutateAsync: updateNote, isPending: false }) }))

const noNavigation = { previousEventId: null, nextEventId: null }

beforeEach(() => {
  vi.clearAllMocks()
  getCallDetail.mockReturnValue({ isPending: false, isError: false, data: undefined })
  updateTask.mockResolvedValue({ task: { isDone: true } })
  updateNote.mockResolvedValue({ note: {} })
})

describe('AccountTimelineDetailPanel', () => {
  it('shows source-authoritative call content, a working full-call link, and filtered navigation', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('button', { name: 'Show the previous timeline event' }))
    expect(onNavigate).toHaveBeenCalledWith('event-newer')
    await user.click(screen.getByRole('button', { name: 'Show the next timeline event' }))
    expect(onNavigate).toHaveBeenCalledWith('event-older')
  })

  it('uses J/K for filtered detail navigation and ignores navigation and Escape in editable targets', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onNavigate = vi.fn()
    renderWithProviders(
      <AccountTimelineDetailPanel
        open
        onOpenChange={onOpenChange}
        detail={{
          type: 'note', id: 'note-1', bodyText: 'Confirmed the rollout plan.',
          bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Confirmed the rollout plan.' }] }] },
          authorName: 'Ada Lovelace', createdAt: '2026-08-22T18:00:00.000Z', updatedAt: '2026-08-22T18:00:00.000Z',
        }}
        navigation={{ previousEventId: 'event-newer', nextEventId: 'event-older' }}
        onNavigate={onNavigate}
      />,
    )

    const panel = screen.getByRole('dialog', { name: 'Note' })
    panel.focus()
    await user.keyboard('kj')
    expect(onNavigate.mock.calls).toEqual([['event-newer'], ['event-older']])

    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Detail note')
    panel.append(input)
    input.focus()
    await user.keyboard('k{Escape}')
    expect(onNavigate).toHaveBeenCalledTimes(2)
    expect(onOpenChange).not.toHaveBeenCalled()

    panel.focus()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders a safe full email, trimmed reply content, attachments, and composer handoffs', async () => {
    const user = userEvent.setup()
    const openComposer = vi.fn().mockResolvedValue(null)
    const composer = {
      drafts: [], openDrafts: [], keptDrafts: [], openComposer,
      saveDraft: vi.fn(), closeCard: vi.fn(), reopenCard: vi.fn(), discardDraft: vi.fn(),
    } satisfies ComposerContextValue
    renderWithProviders(
      <ComposerContext.Provider value={composer}>
        <AccountTimelineDetailPanel
          open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} timeZone="America/New_York"
          detail={{
            type: 'email', id: 'email-1', subject: 'Renewal', bodyHtml: '<p>Current answer</p><script>bad()</script><blockquote>Earlier reply</blockquote>', bodyText: null,
            sentAt: '2026-08-22T18:00:00.000Z', receivedAt: null,
            participants: [
              { id: 'p1', role: 'from', name: 'Ada', address: 'ada@example.com', personId: null },
              { id: 'p2', role: 'to', name: 'Grace', address: 'grace@example.com', personId: null },
            ],
            attachments: [{ id: 'a1', filename: 'proposal.pdf', contentType: 'application/pdf', sizeBytes: 2048, isInline: false, isStored: true }],
          }}
        />
      </ComposerContext.Provider>,
    )

    expect(screen.getByText('Current answer')).toBeInTheDocument()
    expect(screen.queryByText('bad()')).not.toBeInTheDocument()
    expect(screen.getByText('Earlier reply')).toBeInTheDocument()
    expect(screen.getByText('proposal.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    expect(openComposer).toHaveBeenCalledWith(expect.objectContaining({ toAddrs: ['ada@example.com'], subject: 'Re: Renewal' }))
    await user.click(screen.getByRole('button', { name: 'Forward' }))
    expect(openComposer).toHaveBeenLastCalledWith(expect.objectContaining({ toAddrs: [], subject: 'Fwd: Renewal' }))
  })

  it('renders directional SMS conversation bubbles with timestamps, statuses, and reply handoff', () => {
    renderWithProviders(
      <AccountTimelineDetailPanel
        open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} timeZone="America/New_York"
        detail={{
          type: 'sms', id: 'sms-2', direction: 'outbound', fromE164: '+12025550100', toE164: '+12025550123', body: 'Sent reply', status: 'delivered', sentAt: '2026-08-22T18:01:00.000Z', deliveredAt: null, createdAt: '2026-08-22T18:01:00.000Z', media: [],
          conversation: [
            { id: 'sms-1', direction: 'inbound', fromE164: '+12025550123', toE164: '+12025550100', body: 'Can we renew?', status: 'received', sentAt: '2026-08-22T18:00:00.000Z', deliveredAt: null, createdAt: '2026-08-22T18:00:00.000Z', media: [] },
            { id: 'sms-2', direction: 'outbound', fromE164: '+12025550100', toE164: '+12025550123', body: 'Sent reply', status: 'delivered', sentAt: '2026-08-22T18:01:00.000Z', deliveredAt: null, createdAt: '2026-08-22T18:01:00.000Z', media: [] },
          ],
        }}
      />,
    )
    expect(screen.getByRole('article', { name: 'Received text message' })).toHaveTextContent('Can we renew?')
    expect(screen.getByRole('article', { name: 'Sent text message' })).toHaveTextContent('Delivered')
    expect(screen.getByRole('link', { name: 'Reply by text' })).toHaveAttribute('href', 'sms:+12025550123')
    expect(screen.getAllByText(/EDT/)).toHaveLength(2)
  })

  it('renders meeting, note, task, and durable stage-change contracts', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(
      <AccountTimelineDetailPanel
        open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} timeZone="America/New_York"
        detail={{
          type: 'meeting', id: 'meeting-1', title: 'Renewal review', description: 'Review pricing and rollout.', isAllDay: false,
          startsAt: '2026-08-22T18:00:00.000Z', endsAt: '2026-08-22T18:30:00.000Z', startDate: null, endDate: null, timeZone: 'America/New_York',
          status: 'confirmed', location: 'Room 4', joinUrl: 'javascript:alert(1)', webLink: null, hasRecording: true, recordingUrl: 'https://recording.example/1', recordingProvider: 'zoom', transcriptStatus: 'done',
          attendees: [{ id: 'a1', email: 'ada@example.com', name: 'Ada', responseStatus: 'accepted' }],
        }}
      />,
    )
    expect(screen.getByText('Review pricing and rollout.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open recording' })).toHaveAttribute('href', 'https://recording.example/1')
    expect(screen.queryByRole('link', { name: 'Join meeting' })).not.toBeInTheDocument()

    rerender(withProviders(<AccountTimelineDetailPanel open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} orgId="org-1" timeZone="America/New_York" detail={{ type: 'note', id: 'note-1', bodyText: 'Confirmed the rollout plan.', bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Confirmed the rollout plan.' }] }] }, authorName: 'Ada Lovelace', createdAt: '2026-08-22T18:00:00.000Z', updatedAt: '2026-08-22T18:00:00.000Z', links: [{ object: 'company', id: 'company-1' }] }} />))
    expect(screen.getByText('Confirmed the rollout plan.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()

    rerender(withProviders(<AccountTimelineDetailPanel open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} orgId="org-1" timeZone="America/New_York" detail={{ type: 'task', id: 'task-1', title: 'Send proposal', body: 'Use annual pricing.', taskType: 'email', priority: 'high', commitment: 'soft', assigneeUserId: 'user-1', assigneeName: 'Grace Hopper', dueAt: '2026-08-23T18:00:00.000Z', isDone: false, doneAt: null, links: [{ object: 'company', id: 'company-1' }] }} />))
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Complete task' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reopen task' })).toBeInTheDocument())

    rerender(withProviders(<AccountTimelineDetailPanel open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} timeZone="America/New_York" detail={{ type: 'stage_change', id: 'stage-1', dealId: 'deal-1', actorName: 'Ada Lovelace', occurredAt: '2026-08-22T18:00:00.000Z', marker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' } }} />))
    expect(screen.getByLabelText('Changed from Discovery to Proposal')).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace.*EDT/)).toBeInTheDocument()
  })

  it('shows an actionable stale-source state', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    renderWithProviders(<AccountTimelineDetailPanel open onOpenChange={vi.fn()} onNavigate={vi.fn()} navigation={noNavigation} detail={null} state="error" onRetry={retry} />)
    expect(screen.getByText('This activity source is missing or no longer available.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
