import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Mail, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { EmailDraft } from '@/lib/emailTypes'
import { useComposer } from './composerContext'
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
 * Narrower than this and there is no room left of the dialer for even one card,
 * so every draft collapses to a chip rather than render a card that runs off the
 * left edge and under the sidebar.
 */
const MIN_DOCK_WIDTH_PX = 240

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
 * The bottom-right strip the composer cards live in, Gmail-style: oldest on the
 * left, newest on the right, kept drafts gathered into one button.
 *
 * It renders nothing at all when the rep has no drafts, so mounting it costs an
 * empty corner and never a stray border.
 */
export function ComposerDock({ renderCard }: ComposerDockProps) {
  const { openDrafts, keptDrafts, setMinimized, reopenCard } = useComposer()
  const windowWidth = useWindowWidth()

  /**
   * A card the rep clicked while it was squeezed into a chip by the arithmetic
   * rather than by their own `−`. It holds an expanded slot until the next one
   * is clicked. Deliberately local and unsaved: how many cards fit is a property
   * of this window, not of the draft, and it must not follow the rep to another
   * screen.
   */
  const [promotedId, setPromotedId] = useState<string | null>(null)

  // Room left of the reserved dialer corner, and the number of cards it holds.
  const dockWidth = Math.max(windowWidth - DIALER_RESERVE_PX, 0)
  const capacity = dockWidth < MIN_DOCK_WIDTH_PX ? 0 : Math.floor(dockWidth / CARD_SLOT_PX)

  const expandedIds = useMemo(() => {
    // Only cards the rep has not minimized compete for a slot.
    const candidates = openDrafts.filter((d) => !d.isMinimized)
    if (capacity <= 0) return new Set<string>()

    // Newest first, because the newest card is the one being typed in and the
    // oldest are the ones that collapse first.
    const byPriority = candidates.slice().reverse()
    const promoted = byPriority.findIndex((d) => d.id === promotedId)
    if (promoted > 0) byPriority.unshift(...byPriority.splice(promoted, 1))

    return new Set(byPriority.slice(0, capacity).map((d) => d.id))
  }, [openDrafts, capacity, promotedId])

  if (openDrafts.length === 0 && keptDrafts.length === 0) return null

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
      aria-label="Email drafts"
      // The strip itself must not swallow clicks meant for the page under it, so
      // it is transparent to the pointer and each card, chip, and button turns
      // the pointer back on for its own box.
      className="pointer-events-none fixed bottom-0 z-40 flex items-end gap-3"
      style={{
        right: DIALER_RESERVE_PX,
        // Chips squeeze rather than let the strip grow past the left edge.
        maxWidth: dockWidth,
      }}
    >
      {newestKept && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          // Flush to the bottom edge, like everything else in the dock.
          className="pointer-events-auto shrink-0 rounded-b-none"
          onClick={() => void reopenCard(newestKept.id)}
        >
          <Mail size={16} />
          {keptDrafts.length === 1 ? '1 draft' : `${keptDrafts.length} drafts`}
        </Button>
      )}

      {openDrafts.map((draft) =>
        expandedIds.has(draft.id) ? (
          <div key={draft.id} className="pointer-events-auto shrink-0">
            {renderCard(draft)}
          </div>
        ) : (
          <button
            key={draft.id}
            type="button"
            onClick={() => restore(draft)}
            className="pointer-events-auto flex h-8 w-56 shrink items-center gap-2 rounded-t-md border border-b-0 border-border bg-card px-2 text-left text-sm font-medium text-card-foreground transition-colors hover:bg-accent/50"
          >
            <Pencil size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{draftTitle(draft)}</span>
          </button>
        ),
      )}
    </div>
  )
}

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/**
 * The viewport width, read through `useSyncExternalStore` rather than a
 * `useState` seeded in an effect: the first paint gets the real width, so a card
 * never renders expanded for one frame and snaps to a chip on the next.
 */
function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToResize, () => window.innerWidth)
}
