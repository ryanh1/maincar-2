import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DataEditor, GridCellKind, emptyGridSelection } from '@glideapps/glide-data-grid'
import type {
  DataEditorRef,
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
import { ChevronDown, ChevronUp, CornerRightUp, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useCreateRecord, useRecordWindow, useUpdateRecordValue } from '@/hooks/crm'
import { useAuth } from '@/providers/useAuth'
import { useDialer } from '@/components/dialer/dialerContext'
import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'
import { buildGridCell, coerceForType, FLAGGED_THEME, parseOptions } from './cellBuilder'
import { chipCellRenderer, type ChipCellData } from './chipCell'
import { fieldEditorCellRenderer, type FieldEditorCellData } from './fieldEditorCell'
import { GridViewToolbar } from './GridViewToolbar'
import { GridColumnFilterMenu } from './GridColumnFilterMenu'
import type { GridFilterValue, GridMenuAnchor } from './gridFilterMenu'
import { useGridColors } from './useGridColors'
import { RecordPeekDrawer } from './RecordPeekDrawer'
import { RecordGridCreateRow } from './RecordGrid_CreateRow'
import { formatCellValue } from './recordCellValue'
import { ColumnGroupHeaders } from './ColumnGroupHeaders'
import { createViewConfig, reorderColumnGroup, toRecordListQuery, type ViewConfig } from './viewConfig'
import { parseGridCommand } from './gridCommands'
import { coerceCurrency, coerceNumber } from './cellCoercion'

const LEADING_COLUMN_WIDTH = 220
const DEFAULT_COLUMN_WIDTH = 160
const ROW_HEIGHTS = { compact: 34, comfortable: 44, tall: 56 } as const
// Glide asks for the next window once the reader has scrolled within this many
// rows of the end of what is loaded, so the fetch lands before blank rows do.
const PREFETCH_MARGIN = 60
const JUST_CALLED_MARKER_MS = 5_000

interface FindMatch {
  col: number
  row: number
  record: Record<string, unknown> & { id: string }
  attribute: AttributeDef
  display: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createMatcher(query: string, matchCase: boolean, wholeCell: boolean, useRegex: boolean) {
  if (!query) return null

  try {
    const expression = useRegex
      ? new RegExp(wholeCell ? `^(?:${query})$` : query, matchCase ? '' : 'i')
      : new RegExp(wholeCell ? `^${escapeRegExp(query)}$` : escapeRegExp(query), matchCase ? '' : 'i')
    return (value: string) => expression.test(value)
  } catch {
    return null
  }
}

function replaceMatch(value: string, query: string, replacement: string, matchCase: boolean, wholeCell: boolean, useRegex: boolean) {
  if (wholeCell) return replacement
  const expression = useRegex
    ? new RegExp(query, matchCase ? 'g' : 'gi')
    : new RegExp(escapeRegExp(query), matchCase ? 'g' : 'gi')
  return value.replace(expression, replacement)
}

type DisplayRow =
  | { kind: 'group'; key: string; label: string; count: number }
  | { kind: 'record'; record: RecordRow }

interface EditHistoryEntry {
  recordId: string
  attribute: AttributeDef
  before: unknown
  after: unknown
}

interface RecordGridProps {
  orgId: string
  object: ObjectDef
  attributes: AttributeDef[]
  viewConfig?: ViewConfig
  onViewConfigChange?: (update: (current: ViewConfig) => ViewConfig) => void
  toolbarLeading?: ReactNode
}

const HEADER_MENU_UNSUPPORTED_TYPES = new Set(['multiselect', 'record_reference', 'user_reference', 'location', 'ai'])

function headerMenuSupported(attribute: AttributeDef): boolean {
  return !attribute.isMulti && !HEADER_MENU_UNSUPPORTED_TYPES.has(attribute.type)
}

function headerMenuValues(attribute: AttributeDef, rows: RecordRow[], timeZone: string | null | undefined): GridFilterValue[] {
  if (Array.isArray(attribute.optionsJson)) {
    return attribute.optionsJson
      .filter((option): option is { value: string; label: string; isArchived?: boolean } =>
        typeof option === 'object' && option !== null && typeof (option as { value?: unknown }).value === 'string' && typeof (option as { label?: unknown }).label === 'string',
      )
      .filter((option) => !option.isArchived)
      .map((option) => ({ value: option.value, label: option.label }))
  }

  const values = new Map<string, string>()
  for (const row of rows) {
    const raw = row[attribute.slug]
    if (raw === undefined || raw === null || raw === '') continue
    const value = String(raw)
    values.set(value, formatCellValue(raw, attribute.type, timeZone, typeof row.currency === 'string' ? row.currency : undefined))
  }
  return [...values.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
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

function isFillWritable(attribute: AttributeDef): boolean {
  return !attribute.isReadOnly && attribute.type !== 'ai'
}

function includesItem(range: Rectangle, col: number, row: number): boolean {
  return col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length
}

/**
 * The Glide record grid (design-system.md → Tables and grids): canvas, 60fps,
 * a tinted frozen header row (native to Glide) plus a frozen leading column
 * (MAI-164, plan T0.2; spec CHUNK-1 §B). Cell types + paste coercion land here
 * (MAI-169, T2.1). MAI-170 adds the Sheets intent layer: each edit paints
 * immediately, persists through the object route, rolls back on failure, and
 * remains reversible through this grid-owned undo stack.
 *
 * The read-only record peek drawer (MAI-167, Slice S1) also lives here: it
 * needs the same `rows` array the cells render from, so stepping between
 * records (`j`/`k`) is just moving an index into data already resident —
 * never a refetch.
 */
export function RecordGrid({ orgId, object, attributes, viewConfig, onViewConfigChange, toolbarLeading }: RecordGridProps) {
  const { user } = useAuth()
  const { activeCall, dialing } = useDialer()
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
  const teamScopeSupported = object.storage === 'table' && columns.some(
    (attribute) => attribute.slug === 'ownerUserId' && attribute.storage === 'column' && attribute.type === 'user_reference',
  )

  const fallbackConfig = useMemo(() => createViewConfig(attributes), [attributes])
  const config = viewConfig ?? fallbackConfig
  const [gridSelection, setGridSelection] = useState<GridSelection>(emptyGridSelection)
  const [headerMenu, setHeaderMenu] = useState<{ attribute: AttributeDef; anchor: GridMenuAnchor } | null>(null)

  const configuredColumns = useMemo(() => new Map(config.columns.map((column) => [column.attributeId, column])), [config.columns])
  const orderedVisibleColumns = useMemo(() => {
    return columns
      .filter((attribute) => configuredColumns.get(attribute.id)?.visible ?? true)
      .sort((left, right) => (configuredColumns.get(left.id)?.order ?? left.sortOrder) - (configuredColumns.get(right.id)?.order ?? right.sortOrder))
  }, [columns, configuredColumns])
  const visibleColumns = useMemo(() => {
    const firstInCollapsedGroup = new Set<string>()
    return orderedVisibleColumns.filter((attribute) => {
      const column = configuredColumns.get(attribute.id)
      if (!column?.group || !column.collapsed) return true
      if (firstInCollapsedGroup.has(column.group)) return false
      firstInCollapsedGroup.add(column.group)
      return true
    })
  }, [configuredColumns, orderedVisibleColumns])

  const gridColumns: GridColumn[] = useMemo(
    () =>
      visibleColumns.map((attr, index) => {
        const column = configuredColumns.get(attr.id)
        const collapsedGroup = column?.group && column.collapsed ? column.group : undefined
        return {
          id: attr.slug,
          title: collapsedGroup ? `${collapsedGroup} (${config.columns.filter((candidate) => candidate.group === collapsedGroup).length})` : attr.name,
          width: config.columnWidths[attr.id] ?? (index === 0 ? LEADING_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH),
          hasMenu: headerMenuSupported(attr),
        }
      }),
    [visibleColumns, config.columnWidths, configuredColumns, config.columns],
  )
  const firstGridColumn = gridColumns[0]
  const leadingColumnWidth =
    firstGridColumn && 'width' in firstGridColumn && typeof firstGridColumn.width === 'number'
      ? firstGridColumn.width
      : LEADING_COLUMN_WIDTH

  const listQuery = useMemo(() => toRecordListQuery(config, attributes), [config, attributes])
  const { rows, totalCount, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useRecordWindow(orgId, object.id, listQuery)
  const updateRecordValue = useUpdateRecordValue()
  const createRecord = useCreateRecord()
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const createAttributes = columns.filter((attribute) => !attribute.isReadOnly && (attribute.isIdentity || attribute.isRequired))
  if (createAttributes.length === 0) {
    const firstEditable = columns.find((attribute) => !attribute.isReadOnly)
    if (firstEditable) createAttributes.push(firstEditable)
  }

  const saveNewRecord = useCallback(async (values: Record<string, unknown>) => {
    setCreateError(null)
    try {
      await createRecord.mutateAsync({ orgId, object, values })
      setIsCreating(false)
    } catch (error) {
      setCreateError(error instanceof Error && error.message ? error.message : `Could not save this ${object.name.toLowerCase()}. Try again.`)
    }
  }, [createRecord, object, orgId])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const groupAttribute = config.groupBy[0] ? columns.find((attribute) => attribute.id === config.groupBy[0]?.attributeId) : undefined
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!groupAttribute) return rows.map((record) => ({ kind: 'record', record }))

    const groups = new Map<string, { label: string; records: RecordRow[] }>()
    for (const record of rows) {
      const value = record[groupAttribute.slug]
      const option = Array.isArray(groupAttribute.optionsJson)
        ? (groupAttribute.optionsJson as Array<{ value?: unknown; label?: unknown }>).find((candidate) => candidate.value === value)
        : undefined
      const label = typeof option?.label === 'string' ? option.label : value === null || value === undefined || value === '' ? 'No value' : String(value)
      const key = `${groupAttribute.id}:${label}`
      const group = groups.get(key) ?? { label, records: [] }
      group.records.push(record)
      groups.set(key, group)
    }

    return [...groups.entries()].flatMap(([key, group]) => [
      { kind: 'group' as const, key, label: group.label, count: group.records.length },
      ...(collapsedGroups.has(key) ? [] : group.records.map((record) => ({ kind: 'record' as const, record }))),
    ])
  }, [rows, groupAttribute, collapsedGroups])

  const recordAtRow = useCallback((row: number) => {
    const displayRow = displayRows[row]
    return displayRow?.kind === 'record' ? displayRow.record : null
  }, [displayRows])

  // Calls are standard CRM records, so the dialer's call id is the row identity
  // for the Calls grid. Do not apply it to another object whose record id merely
  // happens to match a call id.
  const liveCallRecordId = object.slug === 'call' && dialing ? activeCall?.callId ?? null : null
  const previousLiveCallRecordId = useRef<string | null>(null)
  const [justCalledRecordId, setJustCalledRecordId] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (liveCallRecordId) {
      previousLiveCallRecordId.current = liveCallRecordId
      queueMicrotask(() => setJustCalledRecordId(null))
      return
    }

    const endedRecordId = previousLiveCallRecordId.current
    previousLiveCallRecordId.current = null
    if (!endedRecordId) return

    queueMicrotask(() => setJustCalledRecordId(endedRecordId))
    const timeout = window.setTimeout(() => {
      setJustCalledRecordId((current) => current === endedRecordId ? null : current)
    }, JUST_CALLED_MARKER_MS)
    return () => window.clearTimeout(timeout)
  }, [liveCallRecordId])

  // Local-only edit state (see the class doc comment): a per-record patch of
  // slug → value, plus which cells are currently flagged (accept-but-flag,
  // never silently dropped — issue MAI-169).
  const [edits, setEdits] = useState<Map<string, Record<string, unknown>>>(new Map())
  const [flaggedCells, setFlaggedCells] = useState<Set<string>>(new Set())
  const [undoStack, setUndoStack] = useState<EditHistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<EditHistoryEntry[]>([])
  const [findOpen, setFindOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeCell, setWholeCell] = useState(false)
  const [useRegex, setUseRegex] = useState(false)

  const cellValue = useCallback(
    (record: Record<string, unknown> & { id: string }, attr: AttributeDef): unknown => {
      const patch = edits.get(record.id)
      return patch && attr.slug in patch ? patch[attr.slug] : record[attr.slug]
    },
    [edits],
  )

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const displayRow = displayRows[row]
      const attr = visibleColumns[col]
      if (!displayRow || !attr) {
        return { kind: GridCellKind.Loading, allowOverlay: false }
      }
      if (displayRow.kind === 'group') {
        const label = col === 0 ? `${collapsedGroups.has(displayRow.key) ? '▸' : '▾'} ${displayRow.label} · ${displayRow.count}` : ''
        return { kind: GridCellKind.Text, data: label, displayData: label, readonly: true, allowOverlay: false }
      }
      const record = displayRow.record
      const value = cellValue(record, attr)
      const flagged = flaggedCells.has(`${record.id}:${attr.slug}`)
      return buildGridCell(attr, value, { orgId, timeZone: user?.timeZone, currencyCode: typeof record.currency === 'string' ? record.currency : undefined, flagged })
    },
    [displayRows, visibleColumns, user?.timeZone, cellValue, flaggedCells, collapsedGroups, orgId],
  )

  // The single coercion seam: runs for a typed commit AND a paste (glide
  // calls this before either lands). Never returns `false` — the raw text
  // always commits, flagged rather than dropped when it doesn't parse.
  const validateCell = useCallback(
    (item: Item, newValue: EditableGridCell): boolean | ValidatedGridCell => {
      const [col, row] = item
      const record = recordAtRow(row)
      const attr = visibleColumns[col]
      if (!record || !attr) return true

      if (newValue.kind === GridCellKind.Text) {
        const result = coerceForType(attr, newValue.data, cellValue(record, attr))
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
    [recordAtRow, visibleColumns, cellValue],
  )

  const commitValue = useCallback(
    (record: Record<string, unknown> & { id: string }, attr: AttributeDef, stored: unknown, history = true) => {
      const prior = cellValue(record, attr)
      setEdits((previous) => {
        const next = new Map(previous)
        next.set(record.id, { ...next.get(record.id), [attr.slug]: stored })
        return next
      })

      void updateRecordValue.mutateAsync({ orgId, object, attribute: attr, recordId: record.id, value: stored }).catch(() => {
        setEdits((previous) => {
          const next = new Map(previous)
          next.set(record.id, { ...next.get(record.id), [attr.slug]: prior })
          return next
        })
        toast.error('Could not save. Check your connection and try again.')
      })

      if (history && !Object.is(prior, stored)) {
        setUndoStack((previous) => [...previous, { recordId: record.id, attribute: attr, before: prior, after: stored }])
        setRedoStack([])
      }
    },
    [cellValue, updateRecordValue, orgId, object],
  )

  // Glide renders the fill handle but delegates the values to us. This keeps
  // fills on the same typed coercion and optimistic persistence path as edits,
  // rather than copying a rendered GridCell into a record value.
  const fillRange = useCallback(
    (patternSource: Rectangle, fillDestination: Rectangle) => {
      const flagUpdates: Array<{ key: string; flagged: boolean }> = []

      for (let row = fillDestination.y; row < fillDestination.y + fillDestination.height; row += 1) {
        for (let col = fillDestination.x; col < fillDestination.x + fillDestination.width; col += 1) {
          if (includesItem(patternSource, col, row)) continue

          const targetRecord = recordAtRow(row)
          const targetAttribute = visibleColumns[col]
          if (!targetRecord || !targetAttribute || !isFillWritable(targetAttribute)) continue

          const sourceCol = patternSource.x + wrapIndex(col - patternSource.x, patternSource.width)
          const sourceRow = patternSource.y + wrapIndex(row - patternSource.y, patternSource.height)
          const sourceRecord = recordAtRow(sourceRow)
          const sourceAttribute = visibleColumns[sourceCol]
          if (!sourceRecord || !sourceAttribute) continue

          let sourceValue = cellValue(sourceRecord, sourceAttribute)
          const numericAttribute = targetAttribute.type === 'number' || targetAttribute.type === 'currency' || targetAttribute.type === 'rating'
          const extendsDown = patternSource.width === 1 && patternSource.height > 1
          const extendsRight = patternSource.height === 1 && patternSource.width > 1
          if (numericAttribute && (extendsDown || extendsRight)) {
            const firstRecord = recordAtRow(patternSource.y)
            const lastRecord = recordAtRow(patternSource.y + patternSource.height - 1)
            const firstAttribute = visibleColumns[patternSource.x]
            const lastAttribute = visibleColumns[patternSource.x + patternSource.width - 1]
            const first = extendsDown && firstRecord && firstAttribute
              ? cellValue(firstRecord, firstAttribute)
              : extendsRight && sourceRecord && firstAttribute
                ? cellValue(sourceRecord, firstAttribute)
                : undefined
            const last = extendsDown && lastRecord && lastAttribute
              ? cellValue(lastRecord, lastAttribute)
              : extendsRight && sourceRecord && lastAttribute
                ? cellValue(sourceRecord, lastAttribute)
                : undefined
            if (typeof first === 'number' && typeof last === 'number') {
              const steps = (extendsDown ? patternSource.height : patternSource.width) - 1
              const position = extendsDown ? row - patternSource.y : col - patternSource.x
              sourceValue = first + ((last - first) / steps) * position
            }
          }

          const typedValue = numericAttribute && typeof sourceValue !== 'number'
            ? targetAttribute.type === 'currency'
              ? coerceCurrency(String(sourceValue ?? ''))
              : coerceNumber(String(sourceValue ?? ''))
            : typeof sourceValue === 'string' || sourceValue === null || sourceValue === undefined
              ? coerceForType(targetAttribute, String(sourceValue ?? ''), cellValue(targetRecord, targetAttribute))
              : { ok: true, value: sourceValue }
          const key = `${targetRecord.id}:${targetAttribute.slug}`
          flagUpdates.push({ key, flagged: !typedValue.ok })
          commitValue(targetRecord, targetAttribute, typedValue.value)
        }
      }

      if (flagUpdates.length > 0) {
        setFlaggedCells((previous) => {
          const next = new Set(previous)
          for (const update of flagUpdates) {
            if (update.flagged) next.add(update.key)
            else next.delete(update.key)
          }
          return next
        })
      }
    },
    [recordAtRow, visibleColumns, cellValue, commitValue],
  )

  const onFillPattern = useCallback((event: { patternSource: Rectangle; fillDestination: Rectangle; preventDefault: () => void }) => {
    event.preventDefault()
    fillRange(event.patternSource, event.fillDestination)
  }, [fillRange])

  const onCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      const record = recordAtRow(row)
      const attr = visibleColumns[col]
      if (!record || !attr) return

      let stored: unknown
      if (newValue.kind === GridCellKind.Boolean) {
        stored = newValue.data
      } else if (newValue.kind === GridCellKind.Number) {
        stored = newValue.data ?? null
      } else if (newValue.kind === GridCellKind.Custom) {
        const customData = newValue.data as ChipCellData | FieldEditorCellData
        stored = customData.kind === 'field-editor-cell'
          ? customData.value
          : attr.isMulti ? customData.selectedValues : (customData.selectedValues[0] ?? null)
      } else if (newValue.kind === GridCellKind.Text) {
        const command = parseGridCommand(newValue.data, { type: attr.type, options: parseOptions(attr.optionsJson) })
        stored = command.kind === 'value' ? command.value : newValue.data === '' ? null : newValue.data
        const coercion = coerceForType(attr, newValue.data, cellValue(record, attr))
        const cellKey = `${record.id}:${attr.slug}`
        setFlaggedCells((previous) => {
          const next = new Set(previous)
          if (command.kind === 'value' || coercion.ok) next.delete(cellKey)
          else next.add(cellKey)
          return next
        })
      } else return
      commitValue(record, attr, stored)
    },
    [recordAtRow, visibleColumns, cellValue, commitValue],
  )

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      if (!hasNextPage || isFetchingNextPage) return
      if (range.y + range.height >= displayRows.length - PREFETCH_MARGIN) {
        void fetchNextPage()
      }
    },
    [displayRows.length, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  const onHeaderMenuClick = useCallback(
    (columnIndex: number, bounds: Rectangle) => {
      const attribute = visibleColumns[columnIndex]
      if (!attribute || !onViewConfigChange || !headerMenuSupported(attribute)) return
      setHeaderMenu({
        attribute,
        anchor: {
          x: bounds.x - window.scrollX,
          y: bounds.y - window.scrollY,
          width: bounds.width,
          height: bounds.height,
        },
      })
    },
    [visibleColumns, onViewConfigChange],
  )

  const activeHeaderMenuValues = useMemo(
    () => headerMenu ? headerMenuValues(headerMenu.attribute, rows, user?.timeZone) : [],
    [headerMenu, rows, user?.timeZone],
  )

  const selectedColumnIds = useMemo(() => {
    const indexes = [...new Set(gridSelection.columns.items.flatMap(([start, end]) =>
      Array.from({ length: end - start }, (_, index) => start + index),
    ))].sort((left, right) => left - right)
    if (indexes.length < 2 || indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) return []
    return indexes.map((index) => visibleColumns[index]?.id).filter((id): id is string => Boolean(id))
  }, [gridSelection.columns.items, visibleColumns])

  const onColumnGroupCollapsedChange = useCallback((group: string, collapsed: boolean) => {
    if (!onViewConfigChange) return
    onViewConfigChange((current) => ({
      ...current,
      columns: current.columns.map((column) => column.group === group ? { ...column, collapsed } : column),
    }))
  }, [onViewConfigChange])

  const onColumnGroupReorder = useCallback((activeGroup: string, overGroup: string) => {
    if (!onViewConfigChange) return
    onViewConfigChange((current) => ({ ...current, columns: reorderColumnGroup(current.columns, activeGroup, overGroup) }))
  }, [onViewConfigChange])

  const onColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!onViewConfigChange) return
      onViewConfigChange((current) => {
        const visible = current.columns
          .filter((column) => column.visible)
          .slice()
          .sort((left, right) => left.order - right.order)
        const [moved] = visible.splice(startIndex, 1)
        if (!moved) return current
        visible.splice(endIndex, 0, moved)
        const orderedIds = visible.map((column) => column.attributeId)
        const hiddenIds = current.columns
          .filter((column) => !column.visible)
          .slice()
          .sort((left, right) => left.order - right.order)
          .map((column) => column.attributeId)
        return {
          ...current,
          columns: [...orderedIds, ...hiddenIds].map((attributeId, order) => ({
            ...(current.columns.find((column) => column.attributeId === attributeId)!),
            order,
          })),
        }
      })
    },
    [onViewConfigChange],
  )

  const onColumnResize = useCallback(
    (_column: GridColumn, width: number, columnIndex: number) => {
      if (!onViewConfigChange) return
      const selectedIndexes = gridSelection.columns.items.flatMap(([start, end]) =>
        Array.from({ length: end - start }, (_, index) => start + index),
      )
      const indexes = selectedIndexes.length > 0 ? selectedIndexes : [columnIndex]
      const attributeIds = indexes.map((index) => visibleColumns[index]?.id).filter((id): id is string => Boolean(id))
      onViewConfigChange((current) => ({
        ...current,
        columnWidths: { ...current.columnWidths, ...Object.fromEntries(attributeIds.map((id) => [id, width])) },
      }))
    },
    [gridSelection.columns.items, onViewConfigChange, visibleColumns],
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
      horizontalBorderColor: config.gridLines ? colors.border : 'transparent',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    }),
    [colors, config.gridLines],
  )

  // --- Row focus (controlled selection) + the peek drawer (MAI-167) ---

  const focusedRow = gridSelection.current?.cell[1] ?? null
  const dataEditorRef = useRef<DataEditorRef>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  const getRowThemeOverride = useCallback((row: number): Partial<Theme> | undefined => {
    const record = recordAtRow(row)
    if (!record) return undefined
    if (record.id === liveCallRecordId) {
      return {
        // Glide renders this row's accent at the leading edge. It deliberately
        // uses the active-status token, rather than the primary selection token.
        accentColor: colors.activeCallAccent,
        accentLight: colors.activeCallTint,
        bgCell: colors.activeCallTint,
      }
    }
    if (record.id === justCalledRecordId) return { bgCell: colors.recentCallTint }
    return undefined
  }, [recordAtRow, liveCallRecordId, justCalledRecordId, colors])

  useEffect(() => {
    if (!liveCallRecordId) return
    const row = displayRows.findIndex((displayRow) => displayRow.kind === 'record' && displayRow.record.id === liveCallRecordId)
    if (row < 0) return
    // The call owns this motion. It never writes gridSelection, so a rep can
    // keep editing or inspecting any other row while the call remains visible.
    dataEditorRef.current?.scrollTo(0, row, 'both', 0, 0, {
      hAlign: 'center',
      vAlign: 'center',
      behavior: 'smooth',
    })
  }, [liveCallRecordId, displayRows])

  const focusCell = useCallback((col: number, row: number) => {
    setGridSelection({
      current: { cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] },
      columns: emptyGridSelection.columns,
      rows: emptyGridSelection.rows,
    })
  }, [])

  const [peekIndex, setPeekIndex] = useState<number | null>(null)
  const peekOpen = peekIndex !== null

  const focusRow = useCallback((row: number) => {
    focusCell(0, row)
  }, [focusCell])

  const matcher = useMemo(
    () => createMatcher(findQuery, matchCase, wholeCell, useRegex),
    [findQuery, matchCase, wholeCell, useRegex],
  )
  const matches = useMemo<FindMatch[]>(() => {
    if (!matcher) return []
    return displayRows.flatMap((displayRow, row) => {
      if (displayRow.kind !== 'record') return []
      return visibleColumns.flatMap((attribute, col) => {
        const record = displayRow.record
        const display = formatCellValue(cellValue(record, attribute), attribute.type, user?.timeZone)
        return matcher(display) ? [{ col, row, record, attribute, display }] : []
      })
    })
  }, [displayRows, visibleColumns, cellValue, matcher, user?.timeZone])
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const currentMatchIndex = matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1)
  const finderSelection: GridSelection | null =
    matches.length === 0
      ? null
      : {
          current: {
            cell: [matches[currentMatchIndex].col, matches[currentMatchIndex].row],
            range: { x: matches[currentMatchIndex].col, y: matches[currentMatchIndex].row, width: 1, height: 1 },
            rangeStack: [],
          },
          columns: emptyGridSelection.columns,
          rows: emptyGridSelection.rows,
        }

  const selectMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return
      const nextIndex = ((index % matches.length) + matches.length) % matches.length
      setActiveMatchIndex(nextIndex)
    },
    [matches],
  )

  useEffect(() => {
    const match = matches[currentMatchIndex]
    if (!match) return
    dataEditorRef.current?.scrollTo(match.col, match.row, 'both', 0, 0, {
      hAlign: 'center',
      vAlign: 'center',
      behavior: 'smooth',
    })
  }, [matches, currentMatchIndex])

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus()
  }, [findOpen, replaceOpen])

  useEffect(() => {
    function onFindShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        setFindOpen(true)
        setReplaceOpen(false)
      }
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault()
        event.stopPropagation()
        setFindOpen(true)
        setReplaceOpen(true)
      }
    }

    document.addEventListener('keydown', onFindShortcut, true)
    return () => document.removeEventListener('keydown', onFindShortcut, true)
  }, [])

  const replaceAll = useCallback(() => {
    if (!matcher || matches.length === 0) return
    setEdits((previous) => {
      const next = new Map(previous)
      for (const match of matches) {
        const value = replaceMatch(match.display, findQuery, replaceQuery, matchCase, wholeCell, useRegex)
        next.set(match.record.id, { ...next.get(match.record.id), [match.attribute.slug]: value })
      }
      return next
    })
  }, [matcher, matches, findQuery, replaceQuery, matchCase, wholeCell, useRegex])

  const openPeek = useCallback(
    (row: number) => {
      if (!recordAtRow(row)) return
      focusRow(row)
      setPeekIndex(row)
    },
    [recordAtRow, focusRow],
  )

  const closePeek = useCallback(() => setPeekIndex(null), [])

  const step = useCallback(
    (delta: 1 | -1) => {
      setPeekIndex((prev) => {
        if (prev === null) return prev
        let next = prev + delta
        while (next >= 0 && next < displayRows.length && !recordAtRow(next)) next += delta
        if (next < 0 || next >= displayRows.length) return prev
        focusRow(next)
        return next
      })
    },
    [displayRows.length, recordAtRow, focusRow],
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

  // The grid owns history because Glide's undo buffer stops at the canvas;
  // these entries replay through commitValue, so undo and redo are persisted
  // optimistic writes just like the original edit.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || isTypingTarget(document.activeElement)) return
      const isUndo = event.key.toLowerCase() === 'z' && !event.shiftKey
      const isRedo = event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)
      if (!isUndo && !isRedo) return
      const stack = isUndo ? undoStack : redoStack
      const entry = stack.at(-1)
      if (!entry) return
      const record = rows.find((candidate) => candidate.id === entry.recordId)
      if (!record) return
      event.preventDefault()
      if (isUndo) {
        setUndoStack((current) => current.slice(0, -1))
        setRedoStack((current) => [...current, entry])
        commitValue(record, entry.attribute, entry.before, false)
      } else {
        setRedoStack((current) => current.slice(0, -1))
        setUndoStack((current) => [...current, entry])
        commitValue(record, entry.attribute, entry.after, false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [rows, undoStack, redoStack, commitValue])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || isTypingTarget(document.activeElement)) return
      const range = gridSelection.current?.range
      const key = event.key.toLowerCase()
      const isFillDown = key === 'd' && range && range.height > 1
      const isFillRight = key === 'r' && range && range.width > 1
      if (!isFillDown && !isFillRight) return

      event.preventDefault()
      event.stopPropagation()
      const patternSource = isFillDown
        ? { ...range, height: 1 }
        : { ...range, width: 1 }
      fillRange(patternSource, range)
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [gridSelection, fillRange])

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

  const onCellClicked = useCallback(([_column, row]: Item) => {
    const displayRow = displayRows[row]
    if (displayRow?.kind !== 'group') return
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(displayRow.key)) next.delete(displayRow.key)
      else next.add(displayRow.key)
      return next
    })
  }, [displayRows])

  const [scrollOffsetX, setScrollOffsetX] = useState(0)
  const onGridVisibleRegionChanged = useCallback((range: Rectangle, tx: number) => {
    onVisibleRegionChanged(range)
    const widthBeforeVisibleColumn = gridColumns
      .slice(config.frozenCols, Math.max(config.frozenCols, range.x))
      .reduce((total, column) => total + ('width' in column && typeof column.width === 'number' ? column.width : 0), 0)
    setScrollOffsetX(Math.max(0, widthBeforeVisibleColumn - tx))
  }, [onVisibleRegionChanged, gridColumns, config.frozenCols])

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

  const peekBaseRecord = peekIndex !== null ? recordAtRow(peekIndex) : null
  const peekRecord = peekBaseRecord ? { ...peekBaseRecord, ...edits.get(peekBaseRecord.id) } : null
  const gridRowCount = groupAttribute ? displayRows.length : totalCount

  return (
    <div className="flex h-full min-h-0 flex-col border border-border bg-bg">
      {onViewConfigChange && (
        <GridViewToolbar
          leading={toolbarLeading}
          orgId={orgId}
          attributes={columns}
          config={config}
          onConfigChange={onViewConfigChange}
          teamScopeSupported={teamScopeSupported}
          createLabel={object.isGridCreateSupported ? `Create ${object.name}` : undefined}
          createDisabled={isCreating}
          onCreate={object.isGridCreateSupported ? () => { setCreateError(null); setIsCreating(true) } : undefined}
          selectedColumnIds={selectedColumnIds}
        />
      )}
      {isCreating && (
        <RecordGridCreateRow
          object={object}
          attributes={createAttributes}
          isSaving={createRecord.isPending}
          error={createError}
          onSave={saveNewRecord}
          onCancel={() => { setCreateError(null); setIsCreating(false) }}
        />
      )}
      {onViewConfigChange && (
        <ColumnGroupHeaders
          columns={gridColumns.map((column, index) => ({
            width: 'width' in column && typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH,
            group: configuredColumns.get(visibleColumns[index]?.id)?.group,
            collapsed: configuredColumns.get(visibleColumns[index]?.id)?.collapsed,
          }))}
          onCollapsedChange={onColumnGroupCollapsedChange}
          onReorder={onColumnGroupReorder}
        />
      )}
      <div ref={gridRef} className="relative min-h-0 flex-1" onMouseLeave={() => setHoveredRow(null)}>
        <DataEditor
        ref={dataEditorRef}
        columns={gridColumns}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
        validateCell={validateCell}
        fillHandle
        onFillPattern={onFillPattern}
        customRenderers={[chipCellRenderer, fieldEditorCellRenderer]}
        rows={gridRowCount}
        freezeColumns={Math.min(config.frozenCols, gridColumns.length)}
        rowHeight={ROW_HEIGHTS[config.rowHeight]}
        verticalBorder={config.gridLines}
        onColumnMoved={config.columns.some((column) => column.group) ? undefined : onColumnMoved}
        onColumnResize={onColumnResize}
        rowMarkers="none"
        smoothScrollX
        smoothScrollY
        onVisibleRegionChanged={onGridVisibleRegionChanged}
        onHeaderMenuClick={onHeaderMenuClick}
        onCellClicked={onCellClicked}
        gridSelection={finderSelection ?? gridSelection}
        onGridSelectionChange={setGridSelection}
        onMouseMove={onMouseMove}
        getRowThemeOverride={getRowThemeOverride}
        theme={theme}
        width="100%"
        height="100%"
        />

        {headerMenu && onViewConfigChange && (
          <GridColumnFilterMenu
            attribute={headerMenu.attribute}
            anchor={headerMenu.anchor}
            config={config}
            onConfigChange={onViewConfigChange}
            onOpenChange={(open) => {
              if (!open) setHeaderMenu(null)
            }}
            open
            values={activeHeaderMenuValues}
          />
        )}

        {findOpen && (
          <div className="absolute top-2 right-2 z-20 flex w-80 flex-col gap-2 rounded-md border border-border bg-bg p-2 shadow-md">
            <div className="flex items-center gap-2">
              <Input
                ref={findInputRef}
                type="search"
                aria-label="Find in grid"
                placeholder="Find"
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    selectMatch(currentMatchIndex + (event.shiftKey ? -1 : 1))
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setFindOpen(false)
                    setReplaceOpen(false)
                  }
                }}
                className="h-8 text-sm"
              />
              <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-text-muted">
                {findQuery ? `${matches.length === 0 ? 0 : currentMatchIndex + 1} of ${matches.length}` : '0 of 0'}
              </span>
              <IconButton
                type="button"
                tooltip="Go to the previous match"
                variant="ghost"
                onClick={() => selectMatch(currentMatchIndex - 1)}
                disabled={matches.length === 0}
              >
                <ChevronUp className="size-4" />
              </IconButton>
              <IconButton
                type="button"
                tooltip="Go to the next match"
                variant="ghost"
                onClick={() => selectMatch(currentMatchIndex + 1)}
                disabled={matches.length === 0}
              >
                <ChevronDown className="size-4" />
              </IconButton>
              <IconButton
                type="button"
                tooltip="Close the grid finder"
                variant="ghost"
                onClick={() => {
                  setFindOpen(false)
                  setReplaceOpen(false)
                }}
              >
                <X className="size-4" />
              </IconButton>
            </div>

            {replaceOpen && (
              <>
                <Input
                  aria-label="Replace with"
                  placeholder="Replace with"
                  value={replaceQuery}
                  onChange={(event) => setReplaceQuery(event.target.value)}
                  className="h-8 text-sm"
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label className="flex items-center gap-1 text-xs text-text-muted">
                    <Checkbox checked={matchCase} onCheckedChange={(checked) => setMatchCase(checked === true)} />
                    Match case
                  </label>
                  <label className="flex items-center gap-1 text-xs text-text-muted">
                    <Checkbox checked={wholeCell} onCheckedChange={(checked) => setWholeCell(checked === true)} />
                    Whole cell
                  </label>
                  <label className="flex items-center gap-1 text-xs text-text-muted">
                    <Checkbox checked={useRegex} onCheckedChange={(checked) => setUseRegex(checked === true)} />
                    Use regular expression
                  </label>
                </div>
                <Button type="button" size="sm" onClick={replaceAll} disabled={matches.length === 0}>
                  Replace all
                </Button>
              </>
            )}
          </div>
        )}

        {config.frozenRows > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-10 border-b border-border bg-bg"
            data-row-count={config.frozenRows}
            data-testid="frozen-rows-overlay"
            style={{ top: 36, height: config.frozenRows * ROW_HEIGHTS[config.rowHeight] }}
          >
            <DataEditor
              className="record-grid-frozen-rows"
              columns={gridColumns}
              getCellContent={getCellContent}
              rows={config.frozenRows}
              freezeColumns={Math.min(config.frozenCols, gridColumns.length)}
              rowMarkers="none"
              rowHeight={ROW_HEIGHTS[config.rowHeight]}
              headerHeight={0}
              scrollOffsetX={scrollOffsetX}
              smoothScrollX
              getRowThemeOverride={getRowThemeOverride}
              theme={theme}
              verticalBorder={config.gridLines}
              width="100%"
              height="100%"
            />
          </div>
        )}

        {hoveredRow && (
        <button
          type="button"
          aria-label="Open record"
          title="Open record (Space)"
          className="absolute z-10 flex items-center justify-center rounded-sm border border-border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
          style={{
            top: hoveredRow.y + hoveredRow.height / 2 - 10,
            left: leadingColumnWidth - 26,
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
        onEdit={(attribute, value) => {
          if (peekRecord) commitValue(peekRecord, attribute, value)
        }}
        />
      </div>
    </div>
  )
}
