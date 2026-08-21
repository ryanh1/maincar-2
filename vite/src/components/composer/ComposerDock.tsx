import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pencil, SquarePen } from 'lucide-react'

import { SIDEBAR_WIDTH_PX } from '@/components/sidebarWidth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EmailDraft } from '@/lib/emailTypes'
import { useComposer } from './composerContext'
import { LG_BREAKPOINT_PX, useWindowWidth } from './desktopOnly'

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
 * One expanded card's footprint: `w-80` (320 px, matching the dialer's own card
 * — MAI-209) + the `gap-3` (12 px) that sits beside it = 332 px. Dividing the
 * free width by this is what decides how many cards stay expanded.
 */
const CARD_SLOT_PX = 332

/**
 * The standing rail's own footprint: the "Compose email" button plus, when
 * there is at least one collapsed draft, the "N drafts" button beside it —
 * each an icon, a label, and `px-3` padding, edge to edge with no border
 * between the rail and either neighbor but its own.
 *
 * There is no CSS box this can be measured from — both buttons hug their own
 * text (MAI-209 → condensed buttons), and jsdom lays out no text at all — so
 * this is a deliberate upper estimate of the two labels at their longest
 * ("Compose email", "99 drafts"), the same kind of guess `DIALER_RESERVE_PX`
 * already makes for the dialer's card. Reserving a few pixels more than the
 * rail ever actually draws only ever costs a card its slot one line early; the
 * alternative — reserving too little — is a card painted under the rail.
 */
const RAIL_RESERVE_PX = 280

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

/** The subject line a drafts-popup row shows, falling back the same way the
 * card's own title does for an untouched draft. */
function subjectLine(draft: EmailDraft): string {
  return draft.subject?.trim() || 'New message'
}

/** The first address the rep actually typed, or null. Mirrors `draftTitle`'s
 * own rule: a recipient field can hold a blank chip while it is being typed,
 * and "To: " with nothing after it would be noise. */
function firstRecipient(draft: EmailDraft): string | null {
  return draft.toAddrs.map((a) => a.trim()).find((a) => a.length > 0) ?? null
}

/**
 * The bar along the whole bottom of the app: a strip of chrome, one shade off
 * the page, that the composer cards live inside of Gmail-style — oldest on the
 * left, newest on the right — with a standing rail at its far right: every
 * draft that is not on screen gathered into one "Drafts" button, and the
 * "Compose email" button beside it.
 *
 * It renders nothing below `lg`, where the sidebar and the dialer's reserve
 * leave no corner to put a 320 px card in. It no longer disappears just
 * because the rep has no drafts open — the compose button lives here now, and
 * a bar that vanished would take it with it.
 */
export function ComposerDock({ renderCard }: ComposerDockProps) {
  const { openDrafts, keptDrafts, setMinimized, reopenCard, openComposer } = useComposer()
  const windowWidth = useWindowWidth()

  /**
   * A card the rep clicked while it was squeezed out of a slot by the
   * arithmetic rather than by their own `−`. It holds an expanded slot until
   * the next one is clicked. Deliberately local and unsaved: how many cards
   * fit is a property of this window, not of the draft, and it must not
   * follow the rep to another screen.
   */
  const [promotedId, setPromotedId] = useState<string | null>(null)

  // The Drafts popup: open on hover OR click, closed on a short delay so
  // moving the pointer from the button to the menu (through the few pixels of
  // gap between them) does not read as leaving it — same reasoning `Tooltip`
  // already carries in `components/ui/tooltip.tsx`, just without Radix's own
  // hover primitive, because `DropdownMenu` (the templates popup's own
  // component, reused here for the same look) does not have one.
  //
  // Opening on hover is ALSO delayed, not just closing. `DropdownMenuTrigger`
  // already toggles on click through Radix's own controlled `open`/
  // `onOpenChange`; a real click fires its hover events and its click within
  // the same tick, and an un-delayed hover-open would flip the menu open a
  // moment before the click's own toggle read that same "open" and closed it
  // right back — a click that visibly does nothing. The delay is short enough
  // that a genuine hover still opens promptly.
  const [draftsMenuOpen, setDraftsMenuOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearDraftsMenuTimers() {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function scheduleOpenDraftsMenu() {
    clearDraftsMenuTimers()
    openTimer.current = setTimeout(() => setDraftsMenuOpen(true), 100)
  }

  function scheduleCloseDraftsMenu() {
    clearDraftsMenuTimers()
    closeTimer.current = setTimeout(() => setDraftsMenuOpen(false), 150)
  }

  useEffect(() => clearDraftsMenuTimers, [])

  // Room between the sidebar and the reserved dialer corner, minus the
  // standing rail, and the number of cards it holds. BOTH edges come off the
  // window width by hand: the strip is `fixed`, so its box is the whole
  // viewport and not the `<main>` that the sidebar's `lg:ml-56` already
  // indents. Subtracting only the dialer is what painted the leftmost card
  // over the sidebar (MAI-88).
  const dockWidth = Math.max(windowWidth - SIDEBAR_WIDTH_PX - DIALER_RESERVE_PX - RAIL_RESERVE_PX, 0)
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

  // Every draft not on screen as a card, oldest-open and just-closed alike —
  // this is the whole of what the "Drafts" button counts and lists. There is
  // no separate collapsed shape for an open draft anymore (MAI-209 → the
  // collapsed email card is removed entirely): a draft is either an expanded
  // card, or it is in this one list.
  const collapsedDrafts = useMemo(() => {
    const collapsedOpen = openDrafts.filter((d) => !expandedIds.has(d.id))
    return [...collapsedOpen, ...keptDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [openDrafts, keptDrafts, expandedIds])

  // Below `lg` the whole dock is gone, chips included: a card that expanded
  // wider than the phone it is on is a control that cannot do its job.
  if (windowWidth < LG_BREAKPOINT_PX) return null

  /** One drafts-popup row click, whichever of the two reasons put it there. */
  function restoreFromPopup(draft: EmailDraft) {
    setDraftsMenuOpen(false)
    if (draft.isOpen) {
      // Claim a slot first: a rep-minimized card on a full window would
      // otherwise un-minimize into the popup list again and the click would
      // read as broken.
      setPromotedId(draft.id)
      if (draft.isMinimized) void setMinimized(draft.id, false)
    } else {
      void reopenCard(draft.id)
    }
  }

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
      // `h-8`, matching every card and button that lives inside it, so the
      // bar's own top border sits flush against every one of them instead of
      // leaving a strip of bare chrome above (MAI-209 → dock height matches
      // card height).
      //
      // `bg-muted` rather than design-system.md's `bg-surface`: that token has
      // no `--color-surface` behind it in `index.css` today (neither does
      // `bg-surface-2`, already dead in `Settings.tsx`), so it paints nothing.
      // `bg-muted` is the token this same feature already trusts for "toolbar,
      // one shade off the page" — it is `ComposerCard`'s own header.
      className="fixed bottom-0 z-40 flex h-8 items-end border-t border-border bg-muted"
      style={{ left: SIDEBAR_WIDTH_PX, right: 0, paddingRight: DIALER_RESERVE_PX }}
    >
      <div
        className="flex min-w-0 flex-1 items-end justify-end gap-3 overflow-hidden"
        // Cards squeeze rather than let one grow over the sidebar or the rail.
        style={{ maxWidth: dockWidth }}
      >
        {openDrafts
          .filter((draft) => expandedIds.has(draft.id))
          .map((draft) => (
            <div key={draft.id} className="shrink-0">
              {renderCard(draft)}
            </div>
          ))}
      </div>

      {/* The standing rail. No top border and no rounded corners on either
          button — only the side borders that separate the rail from the cards
          beside it and split the two buttons from each other (MAI-209 →
          edge-to-edge borders); the bar's own `border-t` above does the job a
          card's top border used to. */}
      <div className="flex shrink-0 items-stretch divide-x divide-border border-x border-border">
        {collapsedDrafts.length > 0 && (
          <DropdownMenu open={draftsMenuOpen} onOpenChange={setDraftsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseEnter={scheduleOpenDraftsMenu}
                onMouseLeave={scheduleCloseDraftsMenu}
                className="flex h-8 shrink-0 items-center gap-1.5 bg-card px-3 text-sm font-medium text-card-foreground transition-colors hover:bg-accent/50"
              >
                <Pencil size={16} aria-hidden className="shrink-0 text-muted-foreground" />
                {collapsedDrafts.length === 1 ? '1 draft' : `${collapsedDrafts.length} drafts`}
              </button>
            </DropdownMenuTrigger>
            {/* Same interaction pattern as the footer's templates popup
                (`ComposerCard.tsx`): opens upward and right-aligned, since the
                rail sits on the bottom edge of the screen and a menu that
                dropped down would land off it. */}
            <DropdownMenuContent
              align="end"
              side="top"
              onMouseEnter={scheduleOpenDraftsMenu}
              onMouseLeave={scheduleCloseDraftsMenu}
            >
              {collapsedDrafts.map((draft) => (
                <DropdownMenuItem key={draft.id} onSelect={() => restoreFromPopup(draft)}>
                  <div className="flex min-w-0 flex-col items-start">
                    <span className="truncate">{subjectLine(draft)}</span>
                    {firstRecipient(draft) && (
                      <span className="truncate text-xs text-muted-foreground">
                        To: {firstRecipient(draft)}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          type="button"
          onClick={() => void openComposer()}
          className="flex h-8 shrink-0 items-center gap-1.5 bg-card px-3 text-sm font-medium text-card-foreground transition-colors hover:bg-accent/50"
        >
          <SquarePen size={16} aria-hidden className="shrink-0 text-muted-foreground" />
          Compose email
        </button>
      </div>
    </div>
  )
}
