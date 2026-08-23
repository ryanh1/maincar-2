import { useCallback, useMemo } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import type { GridCell, GridColumn, Item, Rectangle, Theme } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'

import { useAuth } from '@/providers/useAuth'
import type { AttributeDef, CrmListEntry } from '@/lib/crmTypes'
import { buildGridCell } from './cellBuilder'
import { chipCellRenderer } from './chipCell'
import { useGridColors } from './useGridColors'

interface ListEntryGridProps {
  attributes: AttributeDef[]
  entries: CrmListEntry[]
  totalCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  onRemoveEntry: (entry: CrmListEntry) => void
}

/** A read-only Glide grid: list values come from ListEntry, never a record PATCH. */
export function ListEntryGrid({ attributes, entries, totalCount, hasNextPage, isFetchingNextPage, fetchNextPage, onRemoveEntry }: ListEntryGridProps) {
  const { user } = useAuth()
  const colors = useGridColors()
  const columns = useMemo(() => attributes.filter((attribute) => !attribute.isArchived), [attributes])
  const gridColumns = useMemo<GridColumn[]>(
    () => [
      ...columns.map((attribute, index) => ({ id: attribute.slug, title: attribute.name, width: index === 0 ? 220 : 160 })),
      { id: '__remove-entry', title: 'Remove', width: 84 },
    ],
    [columns],
  )
  const getCellContent = useCallback(([column, row]: readonly [number, number]): GridCell => {
    const entry = entries[row]
    if (!entry) return { kind: GridCellKind.Loading, allowOverlay: false }
    if (gridColumns[column]?.id === '__remove-entry') {
      return { kind: GridCellKind.Text, data: 'Remove', displayData: 'Remove', readonly: true, allowOverlay: false }
    }
    const attribute = columns[column]
    if (!attribute) return { kind: GridCellKind.Loading, allowOverlay: false }
    if (!entry.target && column === 0) return { kind: GridCellKind.Text, data: 'Unavailable record', displayData: 'Unavailable record', readonly: true, allowOverlay: false }
    const value = attribute.storage === 'list' ? entry.values[attribute.slug] : entry.target?.[attribute.slug]
    return buildGridCell({ ...attribute, isReadOnly: true }, value, { timeZone: user?.timeZone })
  }, [columns, entries, gridColumns, user?.timeZone])
  const requestRemoval = useCallback(([column, row]: Item) => {
    if (gridColumns[column]?.id !== '__remove-entry') return
    const entry = entries[row]
    if (entry) onRemoveEntry(entry)
  }, [entries, gridColumns, onRemoveEntry])
  const onVisibleRegionChanged = useCallback((range: Rectangle) => {
    if (hasNextPage && !isFetchingNextPage && range.y + range.height >= entries.length - 20) void fetchNextPage()
  }, [entries.length, fetchNextPage, hasNextPage, isFetchingNextPage])
  const theme = useMemo<Partial<Theme>>(() => ({ accentColor: colors.accent, textDark: colors.cellText, textMedium: colors.mutedText, textLight: colors.mutedText, textHeader: colors.headerText, bgCell: colors.background, bgHeader: colors.headerBg, bgHeaderHasFocus: colors.headerBg, bgHeaderHovered: colors.headerBg, borderColor: colors.border, horizontalBorderColor: colors.border, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }), [colors])
  if (columns.length === 0) return <p className="text-sm text-muted-foreground">This list’s object has no fields yet.</p>
  return <div className="h-full min-h-0 border border-border bg-bg"><DataEditor columns={gridColumns} getCellContent={getCellContent} customRenderers={[chipCellRenderer]} rows={totalCount} freezeColumns={1} rowHeight={32} rowMarkers="none" verticalBorder smoothScrollX smoothScrollY onVisibleRegionChanged={onVisibleRegionChanged} onCellClicked={requestRemoval} onCellActivated={requestRemoval} theme={theme} width="100%" height="100%" /></div>
}
