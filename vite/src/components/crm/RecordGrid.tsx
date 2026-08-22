import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DataEditor, GridCellKind, emptyGridSelection } from '@glideapps/glide-data-grid'
import type {
  EditableGridCell,
  GridCell,
  GridColumn,
  GridMouseEventArgs,
  GridSelection,
  Item,
  Rectangle,
  Theme,
  ValidatedGridCell,
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { CornerRightUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useRecordWindow } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'
import type { AttributeDef, ObjectDef } from '@/lib/crmTypes'
import { buildGridCell, coerceForType, FLAGGED_THEME } from './cellBuilder'
import { chipCellRenderer, type ChipCellData } from './chipCell'
import { GridViewToolbar } from './GridViewToolbar'
import { useGridColors } from './useGridColors'
import { RecordPeekDrawer } from './RecordPeekDrawer'
import { createViewConfig, toRecordListQuery, type ViewConfig } from './viewConfig'

const LEADING_COLUMN_WIDTH = 220
const DEFAULT_COLUMN_WIDTH = 160
// Glide asks for the next window once the reader has scrolled within this many
// rows of the end of what is loaded, so the fetch lands before blank rows do.
const PREFETCH_MARGIN = 60

interface RecordGridProps {
  orgId: string
  object: ObjectDef
  attributes: AttributeDef[]
  viewConfig?: ViewConfig
  onViewConfigChange?: (update: (current: ViewConfig) => ViewConfig) => void
}

// Mirrors KeyboardSystem.tsx's guards (not imported from there: those two are
// local to that file, and duplicating five lines beats coupling this grid's
// row-scoped keys to the global command registry).
function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * The Glide record grid (design-system.md → Tables and grids): canvas, 60fps,
 * a tinted frozen header row (native to Glide) plus a frozen leading column
 * (MAI-164, plan T0.2; spec CHUNK-1 §B). Cell types + paste coercion land here
 * (MAI-169, T2.1); the optimistic-write/undo plumbing that persists an edit to
 * the server is T2.2-T2.4 (MAI-170) — edits here commit to local grid state
 * only, which is what lets each type demonstrate its round-trip.
 *
 * The read-only record peek drawer (MAI-167, Slice S1) also lives here: it
 * needs the same `rows` array the cells render from, so stepping between
 * records (`j`/`k`) is just moving an index into data already resident —
 * never a refetch.
 */
export function RecordGrid({ orgId, object, attributes, viewConfig, onViewConfigChange }: RecordGridProps) {
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

  const fallbackConfig = useMemo(() => createViewConfig(attributes), [attributes])
  const config = viewConfig ?? fallbackConfig
  const listQuery = useMemo(() => toRecordListQuery(config, attributes), [config, attributes])
  const { rows, totalCount, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useRecordWindow(orgId, object.id, listQuery)

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

  const onHeaderClicked = useCallback(
    (columnIndex: number) => {
      const attribute = columns[columnIndex]
      if (!attribute || !onViewConfigChange) return

      onViewConfigChange((current) => {
        const active = current.sorts[0]
        const direction =
          active?.attributeId !== attribute.id ? 'asc' : active.direction === 'asc' ? 'desc' : undefined
        return { ...current, sorts: direction ? [{ attributeId: attribute.id, direction }] : [] }
      })
    },
    [columns, onViewConfigChange],
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

  // --- Row focus (controlled selection) + the peek drawer (MAI-167) ---

  const [gridSelection, setGridSelection] = useState<GridSelection>(emptyGridSelection)
  const focusedRow = gridSelection.current?.cell[1] ?? null

  const [peekIndex, setPeekIndex] = useState<number | null>(null)
  const peekOpen = peekIndex !== null

  const focusRow = useCallback((row: number) => {
    setGridSelection({
      current: { cell: [0, row], range: { x: 0, y: row, width: 1, height: 1 }, rangeStack: [] },
      columns: emptyGridSelection.columns,
      rows: emptyGridSelection.rows,
    })
  }, [])

  const openPeek = useCallback(
    (row: number) => {
      if (row < 0 || row >= rows.length) return
      focusRow(row)
      setPeekIndex(row)
    },
    [rows.length, focusRow],
  )

  const closePeek = useCallback(() => setPeekIndex(null), [])

  const step = useCallback(
    (delta: 1 | -1) => {
      setPeekIndex((prev) => {
        if (prev === null) return prev
        const next = Math.min(Math.max(prev + delta, 0), rows.length - 1)
        if (next !== prev) focusRow(next)
        return next
      })
    },
    [rows.length, focusRow],
  )

  // Space opens the drawer for the focused row (DECISIONS D3 — not Enter, which
  // edits the cell). j/k step between records while the drawer is open, without
  // touching `rows` — no refetch. Esc is left to the Sheet's own Radix Dialog,
  // which already closes on Escape. Capture phase + stopPropagation so these
  // never also reach Glide's own handling (e.g. Space toggling a boolean cell).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (hasModifier(event) || isTypingTarget(document.activeElement)) return

      if (event.key === ' ') {
        if (peekOpen || focusedRow === null) return
        event.preventDefault()
        event.stopPropagation()
        openPeek(focusedRow)
        return
      }

      if (!peekOpen) return

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        step(1)
        return
      }

      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        step(-1)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [peekOpen, focusedRow, openPeek, step])

  // The ⤢ hover affordance (DECISIONS D3): a small button pinned to the
  // frozen leading column, following whichever row the pointer is over.
  const [hoveredRow, setHoveredRow] = useState<{ row: number; y: number; height: number } | null>(null)

  const onMouseMove = useCallback((args: GridMouseEventArgs) => {
    if (args.kind !== 'cell') {
      setHoveredRow(null)
      return
    }
    const [, row] = args.location
    setHoveredRow({ row, y: args.bounds.y, height: args.bounds.height })
  }, [])

  const gridRef = useRef<HTMLDivElement>(null)

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

  const peekRecord = peekIndex !== null ? (rows[peekIndex] ?? null) : null

  return (
    <div className="flex h-full min-h-0 flex-col border border-border bg-bg">
      {onViewConfigChange && <GridViewToolbar attributes={columns} config={config} onConfigChange={onViewConfigChange} />}
      <div ref={gridRef} className="relative min-h-0 flex-1" onMouseLeave={() => setHoveredRow(null)}>
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
        onHeaderClicked={onHeaderClicked}
        gridSelection={gridSelection}
        onGridSelectionChange={setGridSelection}
        onMouseMove={onMouseMove}
        theme={theme}
        width="100%"
        height="100%"
        />

        {hoveredRow && (
        <button
          type="button"
          aria-label="Open record"
          title="Open record (Space)"
          className="absolute z-10 flex items-center justify-center rounded-sm border border-border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
          style={{
            top: hoveredRow.y + hoveredRow.height / 2 - 10,
            left: LEADING_COLUMN_WIDTH - 26,
            width: 20,
            height: 20,
          }}
          onClick={() => openPeek(hoveredRow.row)}
        >
          <CornerRightUp className="size-3.5" />
        </button>
        )}

        <RecordPeekDrawer
        open={peekOpen}
        onOpenChange={(open) => {
          if (!open) closePeek()
        }}
        orgId={orgId}
        object={object}
        attributes={columns}
        record={peekRecord}
        timeZone={user?.timeZone}
        position={peekIndex !== null ? { index: peekIndex + 1, total: totalCount } : null}
        />
      </div>
    </div>
  )
}
