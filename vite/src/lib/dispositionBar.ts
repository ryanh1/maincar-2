export const MAX_PINNED_DISPOSITIONS = 7

export interface PinDispositionResult {
  pinnedIds: string[]
  overflowed: boolean
}

/**
 * Adds an item to the end of the fast bar unless every visible slot is already
 * occupied. The server repeats this validation; the client result lets the
 * editor explain the overflow before an admin tries to publish it.
 */
export function pinDisposition(pinnedIds: string[], dispositionId: string): PinDispositionResult {
  if (pinnedIds.includes(dispositionId) || pinnedIds.length >= MAX_PINNED_DISPOSITIONS) {
    return { pinnedIds, overflowed: !pinnedIds.includes(dispositionId) }
  }

  return { pinnedIds: [...pinnedIds, dispositionId], overflowed: false }
}

/** Moves the dragged item before the item it was dropped over. */
export function reorderPinned(pinnedIds: string[], activeId: string, overId: string): string[] {
  const oldIndex = pinnedIds.indexOf(activeId)
  const newIndex = pinnedIds.indexOf(overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return pinnedIds

  const next = [...pinnedIds]
  next.splice(oldIndex, 1)
  next.splice(newIndex, 0, activeId)
  return next
}
