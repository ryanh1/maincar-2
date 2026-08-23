import { useCallback, useMemo, useState } from 'react'

export interface RowSelection {
  selectedIds: ReadonlySet<string>
  allInFilter: boolean
  selectedCount: number
  shouldOfferSelectAll: boolean
  isSelected: (id: string) => boolean
  toggle: (id: string, extendRange?: boolean) => void
  toggleLoaded: () => void
  selectAllInFilter: () => void
  clear: () => void
}

/**
 * Keeps the loaded-row selection small while representing a whole filtered
 * result set as one flag. A later bulk request receives either the explicit
 * ids or the active filter, never a materialized set of every matching row.
 */
export function useRowSelection(loadedIds: readonly string[], totalCount: number): RowSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allInFilter, setAllInFilter] = useState(false)
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null)
  const loadedIdSet = useMemo(() => new Set(loadedIds), [loadedIds])
  const loadedSelectionComplete = loadedIds.length > 0 && loadedIds.every((id) => selectedIds.has(id))

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    setAllInFilter(false)
    setRangeAnchor(null)
  }, [])

  const toggle = useCallback((id: string, extendRange = false) => {
    if (!loadedIdSet.has(id)) return
    if (allInFilter) {
      clear()
      return
    }

    setSelectedIds((current) => {
      const next = new Set(current)
      const anchorIndex = rangeAnchor ? loadedIds.indexOf(rangeAnchor) : -1
      const targetIndex = loadedIds.indexOf(id)

      if (extendRange && anchorIndex >= 0 && targetIndex >= 0) {
        for (const rowId of loadedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)) next.add(rowId)
      } else if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    if (!extendRange || rangeAnchor === null) setRangeAnchor(id)
  }, [allInFilter, clear, loadedIdSet, loadedIds, rangeAnchor])

  const toggleLoaded = useCallback(() => {
    if (allInFilter || loadedSelectionComplete) {
      clear()
      return
    }
    setSelectedIds(new Set(loadedIds))
    setRangeAnchor(loadedIds[0] ?? null)
  }, [allInFilter, clear, loadedIds, loadedSelectionComplete])

  const selectAllInFilter = useCallback(() => {
    setSelectedIds(new Set())
    setAllInFilter(true)
    setRangeAnchor(null)
  }, [])

  return {
    selectedIds,
    allInFilter,
    selectedCount: allInFilter ? totalCount : selectedIds.size,
    shouldOfferSelectAll: !allInFilter && loadedSelectionComplete && totalCount > loadedIds.length,
    isSelected: (id) => allInFilter || selectedIds.has(id),
    toggle,
    toggleLoaded,
    selectAllInFilter,
    clear,
  }
}
