import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EmailDraft } from '@/lib/emailTypes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ComposerContext, type ComposerContextValue } from '@/components/composer/composerContext'
import type { DialerContextValue } from '@/components/dialer/dialerContext'
import { OutreachLayoutProvider } from '@/components/OutreachLayoutProvider'
import { CommandBar } from './CommandBar'

const { useDialerMock } = vi.hoisted(() => ({ useDialerMock: vi.fn() }))
vi.mock('@/components/dialer/dialerContext', () => ({ useDialer: useDialerMock }))
vi.mock('@/components/composer/ComposerCard', () => ({
  ComposerCard: ({ fullScreen }: { fullScreen?: boolean }) => (
    <article aria-label="Mobile composer" className={fullScreen ? 'inset-0 h-[100dvh] w-full' : ''} />
  ),
}))

function draft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1', mailAccountId: null, recordObject: null, recordId: null,
    toAddrs: ['alex@example.test'], ccAddrs: [], bccAddrs: [], subject: 'Follow-up', bodyHtml: null,
    isOpen: false, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z', ...overrides,
  }
}

function renderBar(drafts: EmailDraft[] = [], width = 1440) {
  window.innerWidth = width
  const composer: ComposerContextValue = {
    drafts, openDrafts: drafts.filter((item) => item.isOpen), keptDrafts: drafts.filter((item) => !item.isOpen),
    openComposer: vi.fn().mockResolvedValue(drafts.find((item) => item.isOpen) ?? null), saveDraft: vi.fn().mockResolvedValue(undefined),
    closeCard: vi.fn().mockResolvedValue(undefined), reopenCard: vi.fn().mockResolvedValue(undefined),
    discardDraft: vi.fn().mockResolvedValue(undefined),
  }
  const dialer: Partial<DialerContextValue> = { expandDialer: vi.fn(), phase: 'idle' }
  useDialerMock.mockReturnValue(dialer)
  render(
    <TooltipProvider>
      <ComposerContext.Provider value={composer}>
        <OutreachLayoutProvider><CommandBar /></OutreachLayoutProvider>
      </ComposerContext.Provider>
    </TooltipProvider>,
  )
  return { composer, dialer }
}

describe('CommandBar', () => {
  it('shows the working Email and Phone actions in a fixed, full-height desktop rail', () => {
    renderBar()

    expect(screen.getByRole('toolbar', { name: 'Outreach actions' })).toHaveClass(
      'fixed', 'inset-y-0', 'right-0', 'w-16', 'border-l', 'bg-surface',
    )
    expect(screen.getByRole('button', { name: 'Write an email' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open the dialer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /text|calendar|ask ai/i })).not.toBeInTheDocument()
  })

  it('opens email and dialer from their respective actions', async () => {
    const user = userEvent.setup()
    const { composer, dialer } = renderBar()

    await user.click(screen.getByRole('button', { name: 'Write an email' }))
    await user.click(screen.getByRole('button', { name: 'Open the dialer' }))

    expect(composer.openComposer).toHaveBeenCalledTimes(1)
    expect(dialer.expandDialer).toHaveBeenCalledTimes(1)
  })

  it('adds a conditional Drafts action which restores a saved draft by click', async () => {
    const user = userEvent.setup()
    const { composer } = renderBar([draft()])

    await user.click(screen.getByRole('button', { name: 'Open 1 email draft' }))
    expect(await screen.findByRole('heading', { name: 'Drafts' })).toBeInTheDocument()
    expect(screen.getByText('alex@example.test')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /alex@example.test.*follow-up/i }))

    expect(composer.reopenCard).toHaveBeenCalledWith('draft-1')
  })

  it('uses a plain paper icon and confirms deleting a draft from the drafts menu', async () => {
    const user = userEvent.setup()
    const { composer } = renderBar([draft()])

    const draftsButton = screen.getByRole('button', { name: 'Open 1 email draft' })
    expect(draftsButton.querySelector('.lucide-file')).toBeInTheDocument()

    await user.click(draftsButton)
    await user.click(screen.getByRole('button', { name: 'Delete draft for alex@example.test' }))

    expect(await screen.findByRole('heading', { name: 'Delete this draft?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete draft' }))

    expect(composer.discardDraft).toHaveBeenCalledWith('draft-1')
  })

  it('changes to a horizontal bottom bar on a narrow screen', () => {
    renderBar([], 375)
    expect(screen.getByRole('toolbar', { name: 'Outreach actions' })).toHaveClass('bottom-0', 'left-0', 'right-0', 'flex-row')
  })

  it('keeps the desktop command rail at the sm breakpoint', () => {
    renderBar([], 640)

    expect(screen.getByRole('toolbar', { name: 'Outreach actions' })).toHaveClass('inset-y-0', 'right-0', 'w-16', 'flex-col')
  })

  it('uses a full-screen composer below the desktop dock threshold', async () => {
    const user = userEvent.setup()
    renderBar([draft({ isOpen: true })], 900)

    await user.click(screen.getByRole('button', { name: 'Write an email' }))
    expect(screen.getByRole('article', { name: 'Mobile composer' })).toHaveClass('inset-0', 'h-[100dvh]', 'w-full')
  })

  it('opens recoverable drafts in a dialog on a compact screen', async () => {
    const user = userEvent.setup()
    renderBar([draft()], 900)

    await user.click(screen.getByRole('button', { name: 'Open 1 email draft' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Drafts' })).toBeInTheDocument()
  })

  it('keeps drafts that were already open recoverable on a compact screen', () => {
    renderBar([draft({ isOpen: true })], 900)

    expect(screen.getByRole('button', { name: 'Open 1 email draft' })).toBeInTheDocument()
  })
})
