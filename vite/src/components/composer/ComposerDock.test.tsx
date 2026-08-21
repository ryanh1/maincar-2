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
 * is what tells an expanded card apart from the row it collapses into.
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

  // The dock's own rail (EC-9, MAI-209) wraps plain buttons that live inside a
  // `TooltipProvider` elsewhere in the app; nothing here needs one directly,
  // but it is mounted anyway to match the tree `App.tsx` renders.
  const { container } = render(
    <TooltipProvider>
      <ComposerContext.Provider value={value}>
        <ComposerDock renderCard={(draft) => <article>{draftTitle(draft)}</article>} />
      </ComposerContext.Provider>
    </TooltipProvider>,
  )

  return { ...stubs, container }
}

/** The drafts-popup trigger, or null when there is nothing collapsed to show. */
function draftsButton() {
  return screen.queryByRole('button', { name: /draft/ })
}

describe('ComposerDock', () => {
  it('still draws the bar, with only the compose button, when the rep has no drafts', () => {
    renderDock([])

    // EC-9: the bar hosts a standing action now, so it can no longer render
    // nothing just because there is nothing to autosave.
    expect(screen.getByRole('region', { name: 'Email composer dock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compose email' })).toBeInTheDocument()
    expect(draftsButton()).not.toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('opens a composer when the rep clicks the compose button', async () => {
    const user = userEvent.setup()
    const { openComposer } = renderDock([])

    await user.click(screen.getByRole('button', { name: 'Compose email' }))

    expect(openComposer).toHaveBeenCalledTimes(1)
  })

  it('draws a real bar the whole width of the main content, not a transparent strip, at card height', () => {
    renderDock([makeDraft({ subject: 'Quote' })])

    const dock = screen.getByRole('region', { name: 'Email composer dock' })
    // Starts where the sidebar ends, runs to the window edge, and pads its own
    // right side clear of the dialer's reserved corner.
    expect(dock).toHaveStyle({ left: '224px', right: '0px', paddingRight: '368px' })
    // `h-8`, not the old `h-10`: the bar's own height now matches the cards
    // and buttons inside it, so its top border sits flush against them
    // (MAI-209 → dock height matches card height).
    expect(dock).toHaveClass('fixed', 'bottom-0', 'z-40', 'h-8', 'border-t', 'border-border', 'bg-muted')
  })

  it('lays the newest card out rightmost', () => {
    // 2000 - 224 sidebar - 368 dialer - 280 rail = 1128 px, which holds three
    // 332 px slots.
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
    expect(draftsButton()).not.toBeInTheDocument()
  })

  it('gathers the oldest card into the Drafts button when the window cannot fit them all', () => {
    // 1300 - 224 sidebar - 368 dialer - 280 rail = 428 px, which holds exactly
    // one 332 px card.
    renderDock(
      [
        makeDraft({ id: 'a', subject: 'Oldest' }),
        makeDraft({ id: 'b', subject: 'Middle' }),
        makeDraft({ id: 'c', subject: 'Newest' }),
      ],
      { width: 1300 },
    )

    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual(['Newest'])
    expect(screen.getByRole('button', { name: '2 drafts' })).toBeInTheDocument()
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
    // not the bar's full width (which also carries the rail). The pixels
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
    // 1280 - 224 sidebar - 368 dialer - 280 rail = 408 px, which holds one
    // 332 px slot, not two, so the older card collapses into the Drafts
    // button rather than sliding under the sidebar.
    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual(['Newest'])
    expect(screen.getByRole('button', { name: '1 draft' })).toBeInTheDocument()
  })

  it('renders nothing below lg, rather than a card wider than the phone', () => {
    // A card is no better here: it only exists to grow to 320 px.
    const { container } = renderDock([makeDraft({ id: 'a', subject: 'Quote' })], { width: 375 })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing one pixel under lg, and the dock at lg exactly', () => {
    const narrow = renderDock([makeDraft({ id: 'a', subject: 'Quote' })], { width: 1203 })
    expect(narrow.container).toBeEmptyDOMElement()

    renderDock([makeDraft({ id: 'a', subject: 'Quote' })], { width: 1204 })
    expect(screen.getByRole('region', { name: 'Email composer dock' })).toBeInTheDocument()
    // 1204 - 224 sidebar - 368 dialer - 280 rail = 332 px, exactly one 332 px
    // slot. That is the `lg` gate's whole job: the narrowest window the dock
    // renders at is still wide enough for one card, clear of the sidebar, the
    // dialer's corner, AND the standing rail — never a draft stranded in the
    // Drafts popup the instant the rep opens it.
    expect(screen.getByRole('article')).toHaveTextContent('Quote')
    expect(screen.queryByRole('button', { name: /draft/ })).not.toBeInTheDocument()
  })

  it('expands a card the rep picks from the Drafts popup', async () => {
    const user = userEvent.setup()
    renderDock(
      [
        makeDraft({ id: 'a', subject: 'Oldest', updatedAt: '2026-08-20T12:00:00.000Z' }),
        makeDraft({ id: 'b', subject: 'Newest', updatedAt: '2026-08-20T13:00:00.000Z' }),
      ],
      { width: 1300 },
    )

    await user.click(screen.getByRole('button', { name: '1 draft' }))
    await user.click(await screen.findByRole('menuitem', { name: /Oldest/ }))

    expect(screen.getAllByRole('article').map((el) => el.textContent)).toEqual(['Oldest'])
    expect(screen.getByRole('button', { name: '1 draft' })).toBeInTheDocument()
  })

  it('gathers a minimized card into the Drafts popup and restores it on click', async () => {
    const user = userEvent.setup()
    const { setMinimized } = renderDock([
      makeDraft({ id: 'a', subject: 'Quote', toAddrs: ['ann@acme.test'], isMinimized: true }),
    ])

    expect(screen.getByRole('button', { name: '1 draft' })).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '1 draft' }))
    expect(
      await screen.findByRole('menuitem', { name: /Quote.*To: ann@acme.test/s }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /Quote.*To: ann@acme.test/s }))

    expect(setMinimized).toHaveBeenCalledWith('a', false)
  })

  it('titles an untouched draft "New message" in the popup', async () => {
    const user = userEvent.setup()
    renderDock([makeDraft({ id: 'a', isMinimized: true })])

    await user.click(screen.getByRole('button', { name: '1 draft' }))

    expect(await screen.findByRole('menuitem', { name: 'New message' })).toBeInTheDocument()
  })

  it('gathers closed drafts into the same Drafts button, and reopens the one the rep picks', async () => {
    const user = userEvent.setup()
    const { reopenCard } = renderDock([
      makeDraft({
        id: 'a',
        subject: 'First closed',
        isOpen: false,
        updatedAt: '2026-08-20T12:00:00.000Z',
      }),
      makeDraft({
        id: 'b',
        subject: 'Second closed',
        isOpen: false,
        updatedAt: '2026-08-20T13:00:00.000Z',
      }),
      makeDraft({
        id: 'c',
        subject: 'Last closed',
        isOpen: false,
        updatedAt: '2026-08-20T14:00:00.000Z',
      }),
    ])

    await user.click(screen.getByRole('button', { name: '3 drafts' }))
    // Newest-touched first.
    await user.click(await screen.findByRole('menuitem', { name: 'Last closed' }))

    expect(reopenCard).toHaveBeenCalledWith('c')
  })

  it('counts a single collapsed draft in the singular', () => {
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
