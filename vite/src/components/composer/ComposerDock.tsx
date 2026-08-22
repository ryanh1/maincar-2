import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'

import { SIDEBAR_WIDTH_PX } from '@/components/sidebarWidth'
import type { EmailDraft } from '@/lib/emailTypes'
import { useComposer } from './composerContext'
import { LG_BREAKPOINT_PX, useWindowWidth } from './desktopOnly'

/** The dialer remains reserved while collapsed, so cards never jump during a call. */
const DIALER_RESERVE_PX = 384
/** One card plus the gap that separates it from its neighbour. */
const CARD_SLOT_PX = 332

interface ComposerDockProps {
  renderCard: (draft: EmailDraft) => ReactNode
  selectedDraftId?: string | null
  onHiddenDraftIdsChange?: (draftIds: string[]) => void
}

/**
 * Desktop-only active email cards. Launchers and saved drafts deliberately live
 * in CommandBar; when no card is visible this returns nothing at all.
 */
export function ComposerDock({ renderCard, selectedDraftId, onHiddenDraftIdsChange }: ComposerDockProps) {
  const { openDrafts } = useComposer()
  const windowWidth = useWindowWidth()
  const capacity = Math.max(0, Math.floor((windowWidth - SIDEBAR_WIDTH_PX - DIALER_RESERVE_PX) / CARD_SLOT_PX))

  const expandedIds = useMemo(() => {
    const newestFirst = openDrafts.slice().reverse()
    const selected = newestFirst.findIndex((draft) => draft.id === selectedDraftId)
    if (selected > 0) newestFirst.unshift(...newestFirst.splice(selected, 1))
    return new Set(newestFirst.slice(0, capacity).map((draft) => draft.id))
  }, [capacity, openDrafts, selectedDraftId])

  const visibleDrafts = useMemo(
    () => openDrafts.filter((draft) => expandedIds.has(draft.id)),
    [expandedIds, openDrafts],
  )
  const hiddenDraftIds = useMemo(
    () => openDrafts.filter((draft) => !expandedIds.has(draft.id)).map((draft) => draft.id),
    [expandedIds, openDrafts],
  )

  useEffect(() => onHiddenDraftIdsChange?.(windowWidth >= LG_BREAKPOINT_PX ? hiddenDraftIds : []), [hiddenDraftIds, onHiddenDraftIdsChange, windowWidth])

  if (windowWidth < LG_BREAKPOINT_PX || visibleDrafts.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Active email cards"
      className="fixed bottom-0 z-40 flex items-end gap-3"
      style={{ left: SIDEBAR_WIDTH_PX, right: DIALER_RESERVE_PX }}
    >
      {visibleDrafts.map((draft) => <div key={draft.id} className="shrink-0">{renderCard(draft)}</div>)}
    </div>
  )
}
