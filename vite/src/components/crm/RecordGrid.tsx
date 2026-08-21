import { useCallback, useMemo } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import type { GridCell, GridColumn, Item, Rectangle, Theme } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'

import { Button } from '@/components/ui/button'
import { useRecordWindow } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'
import type { AttributeDef } from '@/lib/crmTypes'
import { formatCellValue } from './recordCellValue'
import { useGridColors } from './useGridColors'

const LEADING_COLUMN_WIDTH = 220
const DEFAULT_COLUMN_WIDTH = 160
// Glide asks for the next window once the reader has scrolled within this many
// rows of the end of what is loaded, so the fetch lands before blank rows do.
const PREFETCH_MARGIN = 60

interface RecordGridProps {
  orgId: string
  objectId: string
  attributes: AttributeDef[]
}

/**
 * The Glide record grid (design-system.md → Tables and grids): canvas, 60fps,
 * a tinted frozen header row (native to Glide) plus a frozen leading column
 * (MAI-164, plan T0.2; spec CHUNK-1 §B). Read-only — editing is T2.x.
 */
export function RecordGrid({ orgId, objectId, attributes }: RecordGridProps) {
  const { user } = useAuth()
  const colors = useGridColors()

  // list-storage attributes (ListEntry-scoped) never appear in a row payload
  // (server/src/crm/recordList.ts mapRow), so they have no column here either.
  const columns = useMemo(
    () =>
      attributes
        .filter((attr) => attr.storage !== 'list' && !attr.isArchived)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [attributes],
  )

  const gridColumns: GridColumn[] = useMemo(
    () =>
      columns.map((attr, index) => ({
        id: attr.slug,
        title: attr.name,
        width: index === 0 ? LEADING_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH,
      })),
    [columns],
  )

  const { rows, totalCount, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useRecordWindow(orgId, objectId)

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const record = rows[row]
      const attr = columns[col]
      if (!record || !attr) {
        return { kind: GridCellKind.Loading, allowOverlay: false }
      }
      const display = formatCellValue(record[attr.slug], attr.type, user?.timeZone)
      return {
        kind: GridCellKind.Text,
        data: display,
        displayData: display,
        allowOverlay: false,
        readonly: true,
      }
    },
    [rows, columns, user?.timeZone],
  )

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      if (!hasNextPage || isFetchingNextPage) return
      if (range.y + range.height >= rows.length - PREFETCH_MARGIN) {
        void fetchNextPage()
      }
    },
    [rows.length, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  const theme: Partial<Theme> = useMemo(
    () => ({
      accentColor: colors.accent,
      textDark: colors.cellText,
      textMedium: colors.mutedText,
      textLight: colors.mutedText,
      textHeader: colors.headerText,
      bgCell: colors.background,
      bgHeader: colors.headerBg,
      bgHeaderHasFocus: colors.headerBg,
      bgHeaderHovered: colors.headerBg,
      borderColor: colors.border,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    }),
    [colors],
  )

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">Could not load these records.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (gridColumns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This object has no fields yet.
      </div>
    )
  }

  return (
    <DataEditor
      columns={gridColumns}
      getCellContent={getCellContent}
      rows={totalCount}
      freezeColumns={1}
      rowMarkers="none"
      smoothScrollX
      smoothScrollY
      onVisibleRegionChanged={onVisibleRegionChanged}
      theme={theme}
      width="100%"
      height="100%"
    />
  )
}
