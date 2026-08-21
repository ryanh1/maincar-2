import { useMemo, useState, type ReactNode } from 'react'
import { Mail, Pencil, SquarePen } from 'lucide-react'

import { SIDEBAR_WIDTH_PX } from '@/components/sidebarWidth'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import type { EmailDraft } from '@/lib/emailTypes'
import { useComposer } from './composerContext'
import { LG_BREAKPOINT_PX, useWindowWidth } from './desktopOnly'
import { draftTitle } from './draftTitle'

/**
 * The corner the dialer owns: its 320 px card + the card's 24 px right margin +
 * a 24 px gap between the two docks = 368 px.
 *
 * Reserved whether the dialer is open or shut. A dock that shifted sideways
 * every time a call started would move a card out from under the cursor
 * mid-sentence. Nothing in this file imports from `components/dialer/` — the two
 * docks agree on this one number and on nothing else, so neither can break the
 * other (SPEC-composer-dock.md → Boundaries).
 */
const DIALER_RESERVE_PX = 368

/**
 * One expanded card's footprint: `w-96` (384 px) + the `gap-3` (12 px) that sits
 * beside it = 396 px. Dividing the free width by this is what decides how many
 * cards stay expanded.
 */
const CARD_SLOT_PX = 396

/**
 * The persistent compose button's own footprint: `size-8` (32 px) plus the 4 px
 * margin that keeps it off the chip beside it = 36 px.
 *
 * Kept to exactly the slack the `lg` floor already had — `1024 − 224 − 368 =
 * 432`, 36 px more than one 396 px card slot needs — so the checkpoint's own
 * guarantee ("a card always fits at the narrowest width the dock renders at")
 * survives adding a button that, unlike a card or a chip, never goes away.
 */
const ICON_RAIL_PX = 36

interface ComposerDockProps {
  /**
   * How to draw one expanded card.
   *
   * The dock owns the corner's arithmetic — what is reserved, what fits, what
   * collapses — and nothing about a card's insides. Passing the card in keeps
   * that split honest and lets the dock's own tests drive the layout without
   * dragging the card's autosave along. `ComposerCard` is what the app passes.
   */
  renderCard: (draft: EmailDraft) => ReactNode
}

/**
 * The bar along the whole bottom of the app: a strip of chrome, one shade off
 * the page, that the composer cards live inside of Gmail-style — oldest on the
 * left, newest on the right, kept drafts gathered into one button — with a
 * standing rail of icon actions at its far right.
 *
 * It renders nothing below `lg`, where the sidebar and the dialer's reserve
 * leave no corner to put a 384 px card in. Unlike before EC-9's checkpoint, it
 * no longer disappears just because the rep has no drafts open — the compose
 * button lives here now, and a bar that vanished would take it with it.
 */
export function ComposerDock({ renderCard }: ComposerDockProps) {
  const { openDrafts, keptDrafts, setMinimized, reopenCard, openComposer } = useComposer()
  const windowWidth = useWindowWidth()

  /**
   * A card the rep clicked while it was squeezed into a chip by the arithmetic
   * rather than by their own `−`. It holds an expanded slot until the next one
   * is clicked. Deliberately local and unsaved: how many cards fit is a property
   * of this window, not of the draft, and it must not follow the rep to another
   * screen.
   */
  const [promotedId, setPromotedId] = useState<string | null>(null)

  // Room between the sidebar and the reserved dialer corner, minus the icon
  // rail, and the number of cards it holds. BOTH edges come off the window
  // width by hand: the strip is `fixed`, so its box is the whole viewport and
  // not the `<main>` that the sidebar's `lg:ml-56` already indents. Subtracting
  // only the dialer is what painted the leftmost card over the sidebar (MAI-88).
  //
  // At the `lg` floor that is 1024 - 224 - 368 - 36 = 396 px, exactly one 396 px
  // slot, so a card always fits and the arithmetic never has to decide what to
  // do with no room at all.
  const dockWidth = Math.max(windowWidth - SIDEBAR_WIDTH_PX - DIALER_RESERVE_PX - ICON_RAIL_PX, 0)
  const capacity = Math.floor(dockWidth / CARD_SLOT_PX)

  const expandedIds = useMemo(() => {
    // Only cards the rep has not minimized compete for a slot.
    const candidates = openDrafts.filter((d) => !d.isMinimized)

    // Newest first, because the newest card is the one being typed in and the
    // oldest are the ones that collapse first.
    const byPriority = candidates.slice().reverse()
    const promoted = byPriority.findIndex((d) => d.id === promotedId)
    if (promoted > 0) byPriority.unshift(...byPriority.splice(promoted, 1))

    return new Set(byPriority.slice(0, capacity).map((d) => d.id))
  }, [openDrafts, capacity, promotedId])

  // Below `lg` the whole dock is gone, chips included: a chip that expanded into
  // a card wider than the phone it is on is a control that cannot do its job.
  if (windowWidth < LG_BREAKPOINT_PX) return null

  /** One chip click, whichever of the two reasons put the draft in a chip. */
  function restore(draft: EmailDraft) {
    // Claim a slot first: a rep-minimized card on a full window would otherwise
    // un-minimize into a chip again and the click would read as broken.
    setPromotedId(draft.id)
    if (draft.isMinimized) void setMinimized(draft.id, false)
  }

  const newestKept = keptDrafts.at(-1)

  return (
    <div
      role="region"
      aria-label="Email composer dock"
      // A real bar now, not a transparent strip: it starts where the sidebar
      // ends and reserves the dialer's corner on the right, the same two edges
      // the old strip computed by hand — just drawn in as chrome instead of
      // left invisible. Nothing below it needs the click, so unlike the old
      // strip this one keeps its own pointer events rather than punching a
      // hole through to the page.
      //
      // `bg-muted` rather than design-system.md's `bg-surface`: that token has
      // no `--color-surface` behind it in `index.css` today (neither does
      // `bg-surface-2`, already dead in `Settings.tsx`), so it paints nothing.
      // `bg-muted` is the token this same feature already trusts for "toolbar,
      // one shade off the page" — it is `ComposerCard`'s own header.
      className="fixed bottom-0 z-40 flex h-10 items-end border-t border-border bg-muted"
      style={{ left: SIDEBAR_WIDTH_PX, right: 0, paddingRight: DIALER_RESERVE_PX }}
    >
      <div
        className="flex min-w-0 flex-1 items-end justify-end gap-3 overflow-hidden"
        // Chips squeeze rather than let a card grow over the sidebar or the
        // icon rail.
        style={{ maxWidth: dockWidth }}
      >
        {newestKept && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            // Flush to the bottom edge, like everything else in the dock.
            className="shrink-0 rounded-b-none"
            onClick={() => void reopenCard(newestKept.id)}
          >
            <Mail size={16} />
            {keptDrafts.length === 1 ? '1 draft' : `${keptDrafts.length} drafts`}
          </Button>
        )}

        {openDrafts.map((draft) =>
          expandedIds.has(draft.id) ? (
            <div key={draft.id} className="shrink-0">
              {renderCard(draft)}
            </div>
          ) : (
            <button
              key={draft.id}
              type="button"
              onClick={() => restore(draft)}
              className="flex h-8 w-56 shrink items-center gap-2 rounded-t-md border border-b-0 border-border bg-card px-2 text-left text-sm font-medium text-card-foreground transition-colors hover:bg-accent/50"
            >
              <Pencil size={16} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{draftTitle(draft)}</span>
            </button>
          ),
        )}
      </div>

      {/* The icon rail. One button today; `ICON_RAIL_PX` is sized for exactly
          this one, so a second one needs its own budget, not just a second
          <IconButton/>. */}
      <IconButton
        tooltip="Create a new email draft"
        className="mb-1 ml-1 shrink-0"
        onClick={() => void openComposer()}
      >
        <SquarePen size={16} aria-hidden />
      </IconButton>
    </div>
  )
}
