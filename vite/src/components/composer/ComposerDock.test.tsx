import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SIDEBAR_WIDTH_PX } from '@/components/sidebarWidth'
import { TooltipProvider } from '@/components/ui/tooltip'
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
  openComposer: ReturnType<typeof vi.fn>
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
    openComposer: vi.fn().mockResolvedValue(null),
  }

  const value: ComposerContextValue = {
    drafts,
    openDrafts: drafts.filter((d) => d.isOpen),
    keptDrafts: drafts.filter((d) => !d.isOpen),
    ...stubs,
    closeCard: vi.fn().mockResolvedValue(undefined),
  }

  // The dock's own icon rail (EC-9) wraps an `IconButton`, which throws
  // outside a `TooltipProvider` — the one `App.tsx` mounts at the root, stood
  // in for here the way `renderWithProviders` does for a full-page test.
  const { container } = render(
    <TooltipProvider>
      <ComposerContext.Provider value={value}>
        <ComposerDock renderCard={(draft) => <article>{draftTitle(draft)}</article>} />
      </ComposerContext.Provider>
    </TooltipProvider>,
  )

  return { ...stubs, container }
}

describe('ComposerDock', () => {
  it('still draws the bar, with only the compose button, when the rep has no drafts', () => {
    renderDock([])

    // EC-9: the bar hosts a standing action now, so it can no longer render
    // nothing just because there is nothing to autosave.
    expect(screen.getByRole('region', { name: 'Email composer dock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a new email draft' })).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('opens a composer when the rep clicks the compose button', async () => {
    const user = userEvent.setup()
    const { openComposer } = renderDock([])

    await user.click(screen.getByRole('button', { name: 'Create a new email draft' }))

    expect(openComposer).toHaveBeenCalledTimes(1)
  })

  it('draws a real bar the whole width of the main content, not a transparent strip', () => {
    renderDock([makeDraft({ subject: 'Quote' })])

    const dock = screen.getByRole('region', { name: 'Email composer dock' })
    // Starts where the sidebar ends, runs to the window edge, and pads its own
    // right side clear of the dialer's reserved corner.
    expect(dock).toHaveStyle({ left: '224px', right: '0px', paddingRight: '368px' })
    expect(dock).toHaveClass('fixed', 'bottom-0', 'z-40', 'h-10', 'border-t', 'border-border', 'bg-muted')
  })

  it('lays the newest card out rightmost', () => {
    // 2000 - 224 sidebar - 368 dialer - 36 icon rail = 1372 px, which holds
    // three 396 px slots.
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
    // 1100 - 224 sidebar - 368 dialer - 36 icon rail = 472 px of dock, which
    // holds exactly one 396 px card.
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

  it('keeps the leftmost card clear of the sidebar', () => {
    // The defect this test exists for (MAI-88): at 1280 px the dock counted
    // 1280 - 368 = 912 px, fitted two cards into it, and painted the leftmost
    // one from x=132 straight over the sidebar's 0-224.
    //
    // jsdom lays nothing out, so the bar's own geometry is what can be read
    // here. The bar itself now starts flush at the sidebar's edge (`left:
    // 224px`), so that part of the old defect cannot recur structurally; what
    // is still worth measuring is that the CARDS stay inside the bar's own
    // content box, capped at `maxWidth` on the wrapper that holds them, and
    // not the bar's full width (which also carries the icon rail). The pixels
    // themselves were measured in a browser (SPEC-composer-dock.md → Not
    // covered by tests).
    renderDock(
      [makeDraft({ id: 'a', subject: 'Oldest' }), makeDraft({ id: 'b', subject: 'Newest' })],
      { width: 1280 },
    )

    const dock = screen.getByRole('region', { name: 'Email composer dock' })
    expect(dock).toHaveStyle({ left: '224px' })
    const cardsWrapper = dock.firstElementChild as HTMLElement
    const leftEdge = 1280 - Number.parseFloat(dock.style.paddingRight) - Number.parseFloat(cardsWrapper.style.maxWidth)

    expect(leftEdge).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_PX)
    // 1280 - 224 sidebar - 368 dialer - 36 icon rail = 652 px for cards, which
    // holds one 396 px slot, not two, so the older card collapses rather than
    // sliding under the sidebar.
    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual(['Newest'])
    expect(screen.getByRole('button', { name: 'Oldest' })).toBeInTheDocument()
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
    expect(screen.getByRole('region', { name: 'Email composer dock' })).toBeInTheDocument()
    // 1024 - 224 sidebar - 368 dialer - 36 icon rail = 396 px, exactly one
    // 396 px slot. That is the `lg` gate's whole job: the narrowest window the
    // dock renders at is still wide enough for a card that clears the sidebar,
    // the dialer's corner, AND the standing compose button.
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
