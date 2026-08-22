import { useCallback, useMemo, useState } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import type {
  EditableGridCell,
  GridCell,
  GridColumn,
  Item,
  Rectangle,
  Theme,
  ValidatedGridCell,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'

import { Button } from '@/components/ui/button'
import { useRecordWindow } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'
import type { AttributeDef } from '@/lib/crmTypes'
import { buildGridCell, coerceForType, FLAGGED_THEME } from './cellBuilder'
import { chipCellRenderer, type ChipCellData } from './chipCell'
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
 * (MAI-164, plan T0.2; spec CHUNK-1 §B). Cell types + paste coercion land here
 * (MAI-169, T2.1); the optimistic-write/undo plumbing that persists an edit to
 * the server is T2.2-T2.4 (MAI-170) — edits here commit to local grid state
 * only, which is what lets each type demonstrate its round-trip.
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

  // Local-only edit state (see the class doc comment): a per-record patch of
  // slug → value, plus which cells are currently flagged (accept-but-flag,
  // never silently dropped — issue MAI-169).
  const [edits, setEdits] = useState<Map<string, Record<string, unknown>>>(new Map())
  const [flaggedCells, setFlaggedCells] = useState<Set<string>>(new Set())

  const cellValue = useCallback(
    (record: Record<string, unknown> & { id: string }, attr: AttributeDef): unknown => {
      const patch = edits.get(record.id)
      return patch && attr.slug in patch ? patch[attr.slug] : record[attr.slug]
    },
    [edits],
  )

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const record = rows[row]
      const attr = columns[col]
      if (!record || !attr) {
        return { kind: GridCellKind.Loading, allowOverlay: false }
      }
      const value = cellValue(record, attr)
      const flagged = flaggedCells.has(`${record.id}:${attr.slug}`)
      return buildGridCell(attr, value, { timeZone: user?.timeZone, flagged })
    },
    [rows, columns, user?.timeZone, cellValue, flaggedCells],
  )

  // The single coercion seam: runs for a typed commit AND a paste (glide
  // calls this before either lands). Never returns `false` — the raw text
  // always commits, flagged rather than dropped when it doesn't parse.
  const validateCell = useCallback(
    (item: Item, newValue: EditableGridCell): boolean | ValidatedGridCell => {
      const [col, row] = item
      const record = rows[row]
      const attr = columns[col]
      if (!record || !attr) return true

      const cellKey = `${record.id}:${attr.slug}`

      if (newValue.kind === GridCellKind.Text) {
        const result = coerceForType(attr, newValue.data, cellValue(record, attr))
        setFlaggedCells((prev) => {
          const next = new Set(prev)
          if (result.ok) next.delete(cellKey)
          else next.add(cellKey)
          return next
        })
        return {
          ...newValue,
          data: String(result.value ?? ''),
          displayData: result.display,
          themeOverride: result.ok ? undefined : FLAGGED_THEME,
        }
      }

      if (newValue.kind === GridCellKind.Number && attr.type === 'currency' && typeof newValue.data === 'number') {
        return { ...newValue, displayData: newValue.data.toFixed(2) }
      }

      return true
    },
    [rows, columns, cellValue],
  )

  const onCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      const record = rows[row]
      const attr = columns[col]
      if (!record || !attr) return

      let stored: unknown
      if (newValue.kind === GridCellKind.Boolean) {
        stored = newValue.data
      } else if (newValue.kind === GridCellKind.Number) {
        stored = newValue.data ?? null
      } else if (newValue.kind === GridCellKind.Custom) {
        const chipData = newValue.data as ChipCellData
        stored = attr.isMulti ? chipData.selectedValues : (chipData.selectedValues[0] ?? null)
      } else if (newValue.kind === GridCellKind.Text) {
        stored = newValue.data === '' ? null : newValue.data
      } else {
        return
      }

      setEdits((prev) => {
        const next = new Map(prev)
        next.set(record.id, { ...next.get(record.id), [attr.slug]: stored })
        return next
      })
    },
    [rows, columns],
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
      onCellEdited={onCellEdited}
      validateCell={validateCell}
      customRenderers={[chipCellRenderer]}
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
