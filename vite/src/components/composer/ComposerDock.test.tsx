import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EmailDraft } from '@/lib/emailTypes'
import { ComposerContext, type ComposerContextValue } from './composerContext'
import { ComposerDock } from './ComposerDock'
import { draftTitle } from './draftTitle'

function makeDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    mailAccountId: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: null,
    bodyHtml: null,
    isOpen: true,
    isMinimized: false,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

interface Stubs {
  setMinimized: ReturnType<typeof vi.fn>
  reopenCard: ReturnType<typeof vi.fn>
  discardDraft: ReturnType<typeof vi.fn>
  saveDraft: ReturnType<typeof vi.fn>
}

/**
 * The dock reads the composer state and never fetches, so a plain context value
 * is the whole world it needs — no query client, no router, no transport mock.
 *
 * `renderCard` stands in for `ComposerCard` (EC-8). It draws an `article`, which
 * is what tells an expanded card apart from the chip it collapses to.
 */
function renderDock(
  drafts: EmailDraft[],
  { width = 1440 }: { width?: number } = {},
): Stubs & { container: HTMLElement } {
  window.innerWidth = width

  const stubs: Stubs = {
    setMinimized: vi.fn().mockResolvedValue(undefined),
    reopenCard: vi.fn().mockResolvedValue(undefined),
    discardDraft: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn().mockResolvedValue(undefined),
  }

  const value: ComposerContextValue = {
    drafts,
    openDrafts: drafts.filter((d) => d.isOpen),
    keptDrafts: drafts.filter((d) => !d.isOpen),
    openComposer: vi.fn().mockResolvedValue(null),
    ...stubs,
    closeCard: vi.fn().mockResolvedValue(undefined),
  }

  const { container } = render(
    <ComposerContext.Provider value={value}>
      <ComposerDock renderCard={(draft) => <article>{draftTitle(draft)}</article>} />
    </ComposerContext.Provider>,
  )

  return { ...stubs, container }
}

describe('ComposerDock', () => {
  it('renders nothing at all when the rep has no drafts', () => {
    const { container } = renderDock([])

    expect(container).toBeEmptyDOMElement()
  })

  it('reserves the dialer corner and stays transparent to the pointer', () => {
    renderDock([makeDraft({ subject: 'Quote' })])

    const dock = screen.getByRole('region', { name: 'Email drafts' })
    expect(dock).toHaveStyle({ right: '368px' })
    expect(dock).toHaveClass('pointer-events-none', 'fixed', 'bottom-0', 'z-40')
    // The card is what takes the click, not the strip around it.
    expect(screen.getByRole('article').parentElement).toHaveClass('pointer-events-auto')
  })

  it('lays the newest card out rightmost', () => {
    // 2000 - 368 reserved = 1632 px, which holds four of the 396 px slots.
    renderDock(
      [
        makeDraft({ id: 'a', subject: 'Oldest' }),
        makeDraft({ id: 'b', subject: 'Middle' }),
        makeDraft({ id: 'c', subject: 'Newest' }),
      ],
      { width: 2000 },
    )

    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual([
      'Oldest',
      'Middle',
      'Newest',
    ])
  })

  it('collapses the oldest cards to chips when the window cannot fit them all', () => {
    // 1100 - 368 reserved = 732 px of dock, and 732 / 396 holds exactly one card.
    renderDock(
      [
        makeDraft({ id: 'a', subject: 'Oldest' }),
        makeDraft({ id: 'b', subject: 'Middle' }),
        makeDraft({ id: 'c', subject: 'Newest' }),
      ],
      { width: 1100 },
    )

    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual(['Newest'])
    expect(screen.getByRole('button', { name: 'Oldest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Middle' })).toBeInTheDocument()
  })

  it('renders nothing below lg, rather than a card wider than the phone', () => {
    // A chip is no better here: it only exists to expand into a 384 px card.
    const { container } = renderDock([makeDraft({ id: 'a', subject: 'Quote' })], { width: 375 })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing one pixel under lg, and the dock at lg exactly', () => {
    const narrow = renderDock([makeDraft({ id: 'a', subject: 'Quote' })], { width: 1023 })
    expect(narrow.container).toBeEmptyDOMElement()

    renderDock([makeDraft({ id: 'a', subject: 'Quote' })], { width: 1024 })
    expect(screen.getByRole('region', { name: 'Email drafts' })).toBeInTheDocument()
    // 1024 - 368 = 656 px, which still holds one expanded card.
    expect(screen.getByRole('article')).toHaveTextContent('Quote')
  })

  it('expands a squeezed card when the rep clicks its chip', async () => {
    const user = userEvent.setup()
    renderDock(
      [
        makeDraft({ id: 'a', subject: 'Oldest' }),
        makeDraft({ id: 'b', subject: 'Newest' }),
      ],
      { width: 1100 },
    )

    await user.click(screen.getByRole('button', { name: 'Oldest' }))

    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual(['Oldest'])
    expect(screen.getByRole('button', { name: 'Newest' })).toBeInTheDocument()
  })

  it('renders a minimized card as a title chip that restores on click', async () => {
    const user = userEvent.setup()
    const { setMinimized } = renderDock([
      makeDraft({ id: 'a', subject: 'Quote', toAddrs: ['ann@acme.test'], isMinimized: true }),
    ])

    const chip = screen.getByRole('button', { name: 'Quote — ann@acme.test' })
    expect(chip).toHaveClass('h-8', 'w-56')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()

    await user.click(chip)

    expect(setMinimized).toHaveBeenCalledWith('a', false)
  })

  it('titles an untouched draft "New message"', () => {
    renderDock([makeDraft({ id: 'a', isMinimized: true })])

    expect(screen.getByRole('button', { name: 'New message' })).toBeInTheDocument()
  })

  it('gathers closed drafts into one button that reopens the most recent', async () => {
    const user = userEvent.setup()
    const { reopenCard } = renderDock([
      makeDraft({ id: 'a', subject: 'First closed', isOpen: false }),
      makeDraft({ id: 'b', subject: 'Second closed', isOpen: false }),
      makeDraft({ id: 'c', subject: 'Last closed', isOpen: false }),
    ])

    await user.click(screen.getByRole('button', { name: '3 drafts' }))

    // `keptDrafts` ends with the most recently closed, which is the one Gmail's
    // Drafts button brings back.
    expect(reopenCard).toHaveBeenCalledWith('c')
  })

  it('counts a single kept draft in the singular', () => {
    renderDock([makeDraft({ id: 'a', isOpen: false })])

    expect(screen.getByRole('button', { name: '1 draft' })).toBeInTheDocument()
  })

  it('never imports from the dialer, so the two docks cannot break each other', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'ComposerDock.tsx'), 'utf8')
    // Only the module specifiers, because the file names the dialer twice on
    // purpose — the 368 px reserve is meaningless without saying what it is for.
    const specifiers = [...source.matchAll(/(?:from|import\s*\()\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    )

    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter((s) => /dialer/i.test(s))).toEqual([])
  })
})
