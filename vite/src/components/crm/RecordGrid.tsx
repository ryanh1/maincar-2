import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DataEditor, GridCellKind, emptyGridSelection } from '@glideapps/glide-data-grid'
import type {
  DataEditorRef,
  DataEditorProps,
  DrawCellCallback,
  DrawHeaderCallback,
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
import { ChevronDown, ChevronUp, CornerRightUp, Ellipsis, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { useCreateRecord, useGetFieldChanges, useRecordWindow, useUpdateRecordValue } from '@/hooks/crm'
import { useGetCellStyles, useSetCellStyle } from '@/hooks/cellStyles'
import { useGetColorRules, type ColorRule } from '@/hooks/colorRules'
import { isStoredScalarCell } from '@/lib/paintTokens'
import { colorRuleThemeOverride, matchColorRule } from '@/lib/colorRule'
import { useWorkspaceUrlState } from '@/hooks/workspaceUrlState'
import { useAuth } from '@/providers/useAuth'
import { useDialer } from '@/components/dialer/dialerContext'
import type { AttributeDef, ObjectDef, RecordRow } from '@/lib/crmTypes'
import { buildGridCell, coerceForType, FLAGGED_THEME, parseOptions } from './cellBuilder'
import { chipCellRenderer, type ChipCellData } from './chipCell'
import { fieldEditorCellRenderer, type FieldEditorCellData } from './fieldEditorCell'
import { GridViewToolbar } from './GridViewToolbar'
import { GridColumnFilterMenu } from './GridColumnFilterMenu'
import { filterForAttribute, type GridFilterValue, type GridMenuAnchor } from './gridFilterMenu'
import { AppliedGridConstraints } from './AppliedGridConstraints'
import { useGridColors } from './useGridColors'
import { RecordPeekDrawer } from './RecordPeekDrawer'
import { RecordGridCreateRow } from './RecordGrid_CreateRow'
import { GridRowFreezeMenu } from './GridRowFreezeMenu'
import { CellPaintMenu } from './CellPaintMenu'
import { ConditionalFormatPanel } from './ConditionalFormatPanel'
import { CellExpandOverlay } from './CellExpandOverlay'
import { CellCopyMenu } from './CellCopyMenu'
import { GridAutocompleteOverlay } from './GridAutocompleteOverlay'
import { supportsGridAutocomplete } from './gridAutocomplete'
import { formatCellValue } from './recordCellValue'
import { ColumnGroupHeaders } from './ColumnGroupHeaders'
import { createKanbanConfig, createViewConfig, reorderColumnGroup, resolveHeaderColor, stepZoom, toRecordListQuery, type ViewConfig } from './viewConfig'
import { parseGridCommand } from './gridCommands'
import { coerceCurrency, coerceNumber } from './cellCoercion'
import { formatEntry } from '@/lib/dialPad'
import { KanbanBoard } from './KanbanBoard'
import { ChangeHighlightOverlay, type ChangeHighlightTarget } from './ChangeHighlightOverlay'
import { FieldHistoryPopover } from './FieldHistoryPopover'
import { drawChangeDots, drawColorRuleDot } from './changeHighlightCanvas'
import { useRowSelection } from './useRowSelection'
import { SelectionBanner } from './SelectionBanner'
import { BulkActionBar } from './BulkActionBar'
import { RecordCount } from './RecordCount'

const LEADING_COLUMN_WIDTH = 220
const DEFAULT_COLUMN_WIDTH = 160
const ROW_HEIGHTS = { compact: 34, comfortable: 44, tall: 56 } as const
const GRID_HEADER_HEIGHT = 36
const ROW_MARKER_WIDTH = 32
// Glide's default base/header font size, scaled by the per-view zoom factor.
const BASE_FONT_SIZE = 13
// Glide asks for the next window once the reader has scrolled within this many
// rows of the end of what is loaded, so the fetch lands before blank rows do.
const PREFETCH_MARGIN = 60
const JUST_CALLED_MARKER_MS = 5_000
const GRID_HEADER_ICONS: NonNullable<DataEditorProps['headerIcons']> = {
  activeFilter: ({ fgColor }) => `<svg width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h12l-4.5 5v4l-3 1v-5L4 5Z" stroke="${fgColor}" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
}
const SEARCH_DEBOUNCE_MS = 300

function drawFiniteCellBorders(
  ctx: CanvasRenderingContext2D,
  rect: Rectangle,
  rightColor: string | undefined,
  bottomColor: string | undefined,
  extendBottomThroughRowMarker: boolean,
) {
  if (rightColor) {
    const right = rect.x + rect.width - 0.5
    ctx.beginPath()
    ctx.moveTo(right, rect.y)
    ctx.lineTo(right, rect.y + rect.height)
    ctx.strokeStyle = rightColor
    ctx.stroke()
  }
  if (bottomColor) {
    const bottom = rect.y + rect.height - 0.5
    ctx.beginPath()
    ctx.moveTo(extendBottomThroughRowMarker ? 0 : rect.x, bottom)
    ctx.lineTo(rect.x + rect.width, bottom)
    ctx.strokeStyle = bottomColor
    ctx.stroke()
  }
}

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
  /** The active saved view, when one is selected; scopes manual cell paint. */
  viewId?: string | null
  /** Opens the named loaded record once, used by trusted inbox deep links. */
  initialRecordId?: string | null
  viewConfig?: ViewConfig
  onViewConfigChange?: (update: (current: ViewConfig) => ViewConfig) => void
  toolbarLeading?: ReactNode
  includeArchived?: boolean
  /** Increments when the page-level New action should open this grid's create flow. */
  createRequestToken?: number
  layout?: 'grid' | 'kanban'
  onLayoutChange?: (layout: 'grid' | 'kanban') => void
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

function textOverflowsCell(value: string, width: number): boolean {
  const availableWidth = Math.max(0, width - 16)
  const context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  if (!context) return value.length * 7 > availableWidth
  context.font = '14px Inter'
  return value.split('\n').some((line) => context.measureText(line).width > availableWidth)
}

function selectedGridRows(selection: GridSelection): number[] | null {
  // Glide always supplies CompactSelection at runtime. The lightweight grid test
  // double only exercises cell selection, however, and omits its row helpers.
  const rows = selection.rows as unknown as { toArray?: () => number[] }
  return typeof rows.toArray === 'function' ? rows.toArray() : null
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
function createdRecordId(response: unknown, object: ObjectDef): string | null {
  if (!response || typeof response !== 'object') return null
  const keyed = response as Record<string, unknown>
  const value = object.storage === 'record' ? keyed.record : keyed[object.slug]
  return value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : null
}

export function RecordGrid({ orgId, object, attributes, viewId, initialRecordId, viewConfig, onViewConfigChange, toolbarLeading, includeArchived = false, createRequestToken, layout = 'grid', onLayoutChange }: RecordGridProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { activeCall, dialing } = useDialer()
  const [workspaceUrlState, updateWorkspaceUrlState] = useWorkspaceUrlState()
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
  const sortActive = config.sorts.length > 0
  // Per-view zoom (journey 4b.10.1): scales font, row height, and column widths
  // together. Stored as a percentage in ViewConfig.zoom; 100 is identity.
  const zoomFactor = config.zoom / 100
  const rowHeightPx = Math.round(ROW_HEIGHTS[config.rowHeight] * zoomFactor)
  const headerHeightPx = Math.round(GRID_HEADER_HEIGHT * zoomFactor)
  const scaledFontSize = Math.round(BASE_FONT_SIZE * zoomFactor)
  const [gridSelection, setGridSelection] = useState<GridSelection>(emptyGridSelection)
  const [headerMenu, setHeaderMenu] = useState<{ attribute: AttributeDef; anchor: GridMenuAnchor; columnIndex: number } | null>(null)
  const [rowFreezeMenu, setRowFreezeMenu] = useState<{ anchor: GridMenuAnchor; row: number } | null>(null)
  const [expandedCell, setExpandedCell] = useState<{ column: number; row: number; anchor: GridMenuAnchor; value: string } | null>(null)
  const [paintMenu, setPaintMenu] = useState<{ anchor: GridMenuAnchor; recordId: string; attribute: AttributeDef } | null>(null)
  const [formatPanel, setFormatPanel] = useState<{ anchor: GridMenuAnchor; attributeId: string | null } | null>(null)
  const [copyMenu, setCopyMenu] = useState<{ anchor: GridMenuAnchor; rawValue: string; displayValue: string } | null>(null)
  const [autocomplete, setAutocomplete] = useState<{
    anchor: GridMenuAnchor
    attribute: AttributeDef
    record: RecordRow
    trigger: '@' | '/'
  } | null>(null)

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
        const headerColor = resolveHeaderColor(attr, config.columnStyles)
        const sort = config.sorts.find((candidate) => candidate.attributeId === attr.id)
        const filterActive = Boolean(filterForAttribute(config, attr.id))
        const title = collapsedGroup ? `${collapsedGroup} (${config.columns.filter((candidate) => candidate.group === collapsedGroup).length})` : attr.name
        return {
          id: attr.slug,
          title: `${title}${sort ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}`,
          width: Math.round((config.columnWidths[attr.id] ?? (index === 0 ? LEADING_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH)) * zoomFactor),
          hasMenu: headerMenuSupported(attr),
          ...(sort || filterActive ? { style: 'highlight' as const } : {}),
          ...(filterActive ? { indicatorIcon: 'activeFilter' } : {}),
          ...(headerColor
            ? { themeOverride: { bgHeader: colors.headerTintColors[headerColor], headerBottomBorderColor: colors.paintColors[headerColor] } }
            : {}),
        }
      }),
    [visibleColumns, config, configuredColumns, zoomFactor, colors],
  )
  const listQuery = useMemo(() => toRecordListQuery(config, attributes), [config, attributes])
  const [searchValue, setSearchValue] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const search = searchValue.trim()
    if (!search) return
    const timeout = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [searchValue])
  const updateSearchValue = (value: string) => {
    setSearchValue(value)
    if (!value.trim()) setDebouncedSearch('')
  }
  const { rows, totalCount, totalCountBeforeSearch, isPending, isFetching, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useRecordWindow(orgId, object.id, { ...listQuery, ...(debouncedSearch ? { search: debouncedSearch } : {}), includeArchived })
  const cellStylesQuery = useGetCellStyles(orgId, viewId ?? null)
  const setCellStyle = useSetCellStyle()
  const paintByCell = useMemo(
    () => new Map((cellStylesQuery.data?.cellStyles ?? []).map((style) => [`${style.recordId}:${style.fieldId}`, style])),
    [cellStylesQuery.data?.cellStyles],
  )
  const colorRulesQuery = useGetColorRules(orgId, viewId ?? null)
  const rulesByAttribute = useMemo(() => {
    const map = new Map<string, ColorRule[]>()
    for (const rule of colorRulesQuery.data?.colorRules ?? []) {
      const list = map.get(rule.attribute) ?? []
      list.push(rule)
      map.set(rule.attribute, list)
    }
    return map
  }, [colorRulesQuery.data?.colorRules])
  const changeHighlightEnabled = config.changeHighlight.mode === 'on'
  const fieldChangesQuery = useGetFieldChanges(orgId, object.id, config.changeHighlight.days, changeHighlightEnabled)
  const changesByCell = useMemo(
    () => new Map((changeHighlightEnabled ? fieldChangesQuery.data?.changes ?? [] : []).map((change) => [`${change.recordId}:${change.attributeId}`, change])),
    [changeHighlightEnabled, fieldChangesQuery.data?.changes],
  )
  const changedRecordIds = useMemo(
    () => new Set((changeHighlightEnabled ? fieldChangesQuery.data?.changes ?? [] : []).map((change) => change.recordId)),
    [changeHighlightEnabled, fieldChangesQuery.data?.changes],
  )
  const visibleRows = useMemo(
    () => changeHighlightEnabled && config.changeHighlight.onlyChangedRows
      ? rows.filter((record) => changedRecordIds.has(record.id))
      : rows,
    [changeHighlightEnabled, config.changeHighlight.onlyChangedRows, rows, changedRecordIds],
  )
  const updateRecordValue = useUpdateRecordValue()
  const createRecord = useCreateRecord()
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdRecordIdToFocus, setCreatedRecordIdToFocus] = useState<string | null>(null)
  const previousCreateRequestToken = useRef(createRequestToken)
  const createAttributes = columns.filter((attribute) => !attribute.isReadOnly && (attribute.isIdentity || attribute.isRequired))
  if (createAttributes.length === 0) {
    const firstEditable = columns.find((attribute) => !attribute.isReadOnly)
    if (firstEditable) createAttributes.push(firstEditable)
  }

  const saveNewRecord = useCallback(async (values: Record<string, unknown>) => {
    setCreateError(null)
    try {
      const response = await createRecord.mutateAsync({ orgId, object, values })
      setCreatedRecordIdToFocus(createdRecordId(response, object))
      setIsCreating(false)
    } catch (error) {
      setCreateError(error instanceof Error && error.message ? error.message : `Could not save this ${object.name.toLowerCase()}. Try again.`)
    }
  }, [createRecord, object, orgId])

  useEffect(() => {
    if (createRequestToken === undefined || createRequestToken === previousCreateRequestToken.current) return
    previousCreateRequestToken.current = createRequestToken
    setCreateError(null)
    setIsCreating(true)
  }, [createRequestToken])

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const groupAttribute = config.groupBy[0] ? columns.find((attribute) => attribute.id === config.groupBy[0]?.attributeId) : undefined
  const kanbanGroupAttribute = config.kanban
    ? columns.find((attribute) => attribute.id === config.kanban?.groupAttributeId)
    : undefined
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!groupAttribute) return visibleRows.map((record) => ({ kind: 'record', record }))

    const groups = new Map<string, { label: string; records: RecordRow[] }>()
    for (const record of visibleRows) {
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
  }, [visibleRows, groupAttribute, collapsedGroups])

  const recordAtRow = useCallback((row: number) => {
    const displayRow = displayRows[row]
    return displayRow?.kind === 'record' ? displayRow.record : null
  }, [displayRows])
  const loadedRecordIds = useMemo(() => displayRows.flatMap((row) => row.kind === 'record' ? [row.record.id] : []), [displayRows])
  const rowSelection = useRowSelection(loadedRecordIds, totalCount)
  const bulkSelection = useMemo(() => rowSelection.allInFilter
    ? { mode: 'filter' as const, filter: listQuery.filter, teamScope: listQuery.teamScope }
    : { mode: 'ids' as const, ids: [...rowSelection.selectedIds] }, [listQuery.filter, listQuery.teamScope, rowSelection.allInFilter, rowSelection.selectedIds])
  const canChangeOwner = columns.some((attribute) => attribute.slug === 'ownerUserId' && attribute.type === 'user_reference')

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
      const cell = buildGridCell(attr, value, {
        orgId,
        timeZone: user?.timeZone,
        currencyCode: typeof record.currency === 'string' ? record.currency : undefined,
        flagged,
        wrap: configuredColumns.get(attr.id)?.wrap === true,
        paintColors: colors.paintColors,
      })
      const change = changesByCell.get(`${record.id}:${attr.id}`)
      const paint = paintByCell.get(`${record.id}:${attr.id}`)
      const paintOverride = paint
        ? {
            ...(paint.backgroundToken ? { bgCell: colors.paintColors[paint.backgroundToken] } : {}),
            ...(paint.textToken ? { textDark: colors.paintColors[paint.textToken] } : {}),
          }
        : undefined
      const rule = matchColorRule(rulesByAttribute.get(attr.id) ?? [], value)
      const ruleOverride = rule ? colorRuleThemeOverride(rule, colors.paintColors) : undefined
      const override = change
        ? { ...cell.themeOverride, ...ruleOverride, ...paintOverride, bgCell: colors.changeHighlightTint }
        : paintOverride
          ? { ...cell.themeOverride, ...ruleOverride, ...paintOverride }
          : ruleOverride
            ? { ...cell.themeOverride, ...ruleOverride }
            : cell.themeOverride
      return override ? { ...cell, themeOverride: override } : cell
    },
    [displayRows, visibleColumns, user?.timeZone, cellValue, flaggedCells, collapsedGroups, orgId, configuredColumns, changesByCell, colors.changeHighlightTint, paintByCell, colors.paintColors, rulesByAttribute],
  )

  const drawCell = useCallback<DrawCellCallback>((args, drawContent) => {
    drawContent()
    if (config.gridLines) {
      drawFiniteCellBorders(args.ctx, args.rect, colors.border, colors.border, args.col === 0)
    }
    const record = recordAtRow(args.row)
    const attribute = visibleColumns[args.col]
    if (!record || !attribute) return
    const change = changesByCell.get(`${record.id}:${attribute.id}`)
    if (change) drawChangeDots(args.ctx, args.rect, change.changeCount, colors.changeHighlightDot)
    const rule = matchColorRule(rulesByAttribute.get(attribute.id) ?? [], cellValue(record, attribute))
    if (rule && rule.target === 'dot') drawColorRuleDot(args.ctx, args.rect, colors.paintColors[rule.color] ?? rule.color)
  }, [config.gridLines, recordAtRow, visibleColumns, changesByCell, colors.border, colors.changeHighlightDot, rulesByAttribute, cellValue, colors.paintColors])

  const drawHeader = useCallback<DrawHeaderCallback>((args, drawContent) => {
    drawContent()
    const headerAccent = args.theme.headerBottomBorderColor
    const bottomColor = headerAccent && headerAccent !== 'transparent'
      ? headerAccent
      : config.gridLines ? colors.border : undefined
    drawFiniteCellBorders(
      args.ctx,
      args.rect,
      config.gridLines ? colors.border : undefined,
      bottomColor,
      args.columnIndex === 0,
    )
  }, [config.gridLines, colors.border])

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

  const kanbanRows = useMemo(
    () => visibleRows.map((record) => ({ ...record, ...edits.get(record.id) })),
    [edits, visibleRows],
  )
  const moveKanbanRecord = useCallback((record: RecordRow, value: string | null) => {
    if (!kanbanGroupAttribute || kanbanGroupAttribute.isReadOnly) return
    commitValue(record, kanbanGroupAttribute, value)
  }, [commitValue, kanbanGroupAttribute])

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

  const onGridKeyDown = useCallback((event: Parameters<NonNullable<DataEditorProps['onKeyDown']>>[0]) => {
    if (event.key !== '@' && event.key !== '/') return
    if (event.altKey || event.ctrlKey || event.metaKey || !event.location || !event.bounds) return

    const [column, row] = event.location
    const record = recordAtRow(row)
    const attribute = visibleColumns[column]
    if (!record || !attribute || attribute.isReadOnly || !supportsGridAutocomplete(attribute.type, event.key)) return

    event.cancel()
    event.preventDefault()
    event.stopPropagation()
    setAutocomplete({
      record,
      attribute,
      trigger: event.key,
      anchor: {
        x: event.bounds.x,
        y: event.bounds.y,
        width: event.bounds.width,
        height: event.bounds.height,
      },
    })
  }, [recordAtRow, visibleColumns])

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
        columnIndex,
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
    if (!onViewConfigChange || sortActive) return
    onViewConfigChange((current) => ({ ...current, columns: reorderColumnGroup(current.columns, activeGroup, overGroup) }))
  }, [onViewConfigChange, sortActive])

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
      const storedWidth = Math.round(width / zoomFactor)
      onViewConfigChange((current) => ({
        ...current,
        columnWidths: { ...current.columnWidths, ...Object.fromEntries(attributeIds.map((id) => [id, storedWidth])) },
      }))
    },
    [gridSelection.columns.items, onViewConfigChange, visibleColumns, zoomFactor],
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
      horizontalBorderColor: 'transparent',
      headerBottomBorderColor: 'transparent',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      baseFontStyle: `${scaledFontSize}px`,
      headerFontStyle: `600 ${scaledFontSize}px`,
    }),
    [colors, scaledFontSize],
  )

  // --- Row focus (controlled selection) + the peek drawer (MAI-167) ---

  const focusedRow = gridSelection.current?.cell[1] ?? null
  const dataEditorRef = useRef<DataEditorRef>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const freezeLineDrag = useRef<{ axis: 'columns' | 'rows'; value: number } | null>(null)

  const getRowThemeOverride = useCallback((row: number): Partial<Theme> | undefined => {
    const record = recordAtRow(row)
    if (!record) return undefined
    if (record.isArchived) return { textDark: colors.mutedText, bgCell: colors.background }
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

  useEffect(() => {
    if (!createdRecordIdToFocus) return
    const row = displayRows.findIndex((displayRow) => displayRow.kind === 'record' && displayRow.record.id === createdRecordIdToFocus)
    if (row < 0) return
    const frame = window.requestAnimationFrame(() => {
      focusCell(0, row)
      dataEditorRef.current?.scrollTo(0, row, 'both', 0, 0, {
        hAlign: 'center',
        vAlign: 'center',
        behavior: 'smooth',
      })
      setCreatedRecordIdToFocus(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [createdRecordIdToFocus, displayRows, focusCell])

  const peekIndex = useMemo(() => {
    const selectedRecordId = workspaceUrlState.selectedRecordId
    if (!selectedRecordId) return null
    const index = displayRows.findIndex((row) => row.kind === 'record' && row.record.id === selectedRecordId)
    return index >= 0 ? index : null
  }, [displayRows, workspaceUrlState.selectedRecordId])
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

  // Cmd/Ctrl +/–/0 zoom the grid in-app (journey 4b.10.1), never the browser.
  useEffect(() => {
    function onZoomShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || isTypingTarget(document.activeElement)) return
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        onViewConfigChange?.((current) => ({ ...current, zoom: stepZoom(current.zoom, 1) }))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        onViewConfigChange?.((current) => ({ ...current, zoom: stepZoom(current.zoom, -1) }))
      } else if (event.key === '0') {
        event.preventDefault()
        onViewConfigChange?.((current) => ({ ...current, zoom: 100 }))
      }
    }
    document.addEventListener('keydown', onZoomShortcut, true)
    return () => document.removeEventListener('keydown', onZoomShortcut, true)
  }, [onViewConfigChange])

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
      const record = recordAtRow(row)
      if (record) updateWorkspaceUrlState((current) => ({ ...current, selectedRecordId: record.id }))
    },
    [recordAtRow, focusRow, updateWorkspaceUrlState],
  )

  const closePeek = useCallback(() => {
    updateWorkspaceUrlState((current) => ({ ...current, selectedRecordId: undefined }))
  }, [updateWorkspaceUrlState])

  const openedInitialRecordRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialRecordId || openedInitialRecordRef.current === initialRecordId) return
    const row = displayRows.findIndex(
      (displayRow) => displayRow.kind === 'record' && displayRow.record.id === initialRecordId,
    )
    // The grid window may not have reached this row yet. Do not mark it handled
    // until it is actually present, otherwise a deep link silently loses its
    // drawer on the first loading render.
    if (row < 0) return
    openedInitialRecordRef.current = initialRecordId
    // Let this render commit before asking the grid to select a row and open a
    // sheet. This is an external deep-link synchronization, not derived state.
    const timer = window.setTimeout(() => openPeek(row), 0)
    return () => window.clearTimeout(timer)
  }, [displayRows, initialRecordId, openPeek])

  const step = useCallback(
    (delta: 1 | -1) => {
      if (peekIndex === null) return
      let next = peekIndex + delta
      while (next >= 0 && next < displayRows.length && !recordAtRow(next)) next += delta
      const record = recordAtRow(next)
      if (!record) return
      focusRow(next)
      updateWorkspaceUrlState((current) => ({ ...current, selectedRecordId: record.id }))
    },
    [displayRows.length, peekIndex, recordAtRow, focusRow, updateWorkspaceUrlState],
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

  // Keep row actions anchored to the row marker while the open-record action
  // follows the hovered cell, so each affordance stays attached to its target.
  const [hoveredCell, setHoveredCell] = useState<{ row: number; x: number; y: number; width: number; height: number } | null>(null)
  const [changeHighlightHover, setChangeHighlightHover] = useState<ChangeHighlightTarget | null>(null)
  const [historyTarget, setHistoryTarget] = useState<ChangeHighlightTarget | null>(null)
  const gridRowCount = displayRows.length

  const onMouseMove = useCallback((args: GridMouseEventArgs) => {
    setExpandedCell((current) => {
      if (!current || args.kind !== 'cell') return null
      return args.location[0] === current.column && args.location[1] === current.row ? current : null
    })
    if (args.kind !== 'cell') {
      setHoveredCell(null)
      setChangeHighlightHover(null)
      return
    }
    const [col, row] = args.location
    setHoveredCell({ row, x: args.bounds.x, y: args.bounds.y, width: args.bounds.width, height: args.bounds.height })
    const record = recordAtRow(row)
    const attribute = visibleColumns[col]
    const change = record && attribute ? changesByCell.get(`${record.id}:${attribute.id}`) : undefined
    setChangeHighlightHover(change && record && attribute
      ? { recordId: record.id, attribute, change, bounds: args.bounds }
      : null)
  }, [recordAtRow, visibleColumns, changesByCell])

  const frozenColumnBoundary = useMemo(
    () => ROW_MARKER_WIDTH + gridColumns
      .slice(0, Math.min(config.frozenCols, gridColumns.length))
      .reduce((total, column) => total + ('width' in column && typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH), 0),
    [config.frozenCols, gridColumns],
  )
  const frozenRowBoundary = headerHeightPx + config.frozenRows * rowHeightPx

  const freezeColumnsAt = useCallback((x: number) => {
    const gridX = Math.max(0, x - ROW_MARKER_WIDTH)
    let width = 0
    for (let index = 0; index < gridColumns.length; index += 1) {
      const column = gridColumns[index]
      const nextWidth = width + ('width' in column && typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH)
      if (gridX < nextWidth - (nextWidth - width) / 2) return index
      width = nextWidth
    }
    return gridColumns.length
  }, [gridColumns])

  const freezeRowsAt = useCallback((y: number) => {
    const count = Math.round((y - headerHeightPx) / rowHeightPx)
    return Math.max(0, Math.min(gridRowCount, count))
  }, [headerHeightPx, rowHeightPx, gridRowCount])

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = freezeLineDrag.current
      const rect = gridRef.current?.getBoundingClientRect()
      if (!drag || !rect || !onViewConfigChange) return
      const value = drag.axis === 'columns'
        ? freezeColumnsAt(event.clientX - rect.left)
        : freezeRowsAt(event.clientY - rect.top)
      if (value === drag.value) return
      freezeLineDrag.current = { ...drag, value }
      onViewConfigChange((current) => ({ ...current, [drag.axis === 'columns' ? 'frozenCols' : 'frozenRows']: value }))
    }

    function onPointerUp() {
      freezeLineDrag.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [freezeColumnsAt, freezeRowsAt, onViewConfigChange])

  const onCellClicked = useCallback(([_column, row]: Item, event: { bounds: Rectangle; preventDefault: () => void }) => {
    const displayRow = displayRows[row]
    if (displayRow?.kind === 'group') {
      setCollapsedGroups((previous) => {
        const next = new Set(previous)
        if (next.has(displayRow.key)) next.delete(displayRow.key)
        else next.add(displayRow.key)
        return next
      })
      return
    }

    const attribute = visibleColumns[_column]
    if (!displayRow || !attribute || configuredColumns.get(attribute.id)?.wrap === true) return
    const record = displayRow.record
    const value = formatCellValue(
      cellValue(record, attribute),
      attribute.type,
      user?.timeZone,
      typeof record.currency === 'string' ? record.currency : undefined,
      attribute.slug === 'amountMinor',
    )
    if (!textOverflowsCell(value, event.bounds.width)) return
    event.preventDefault()
    setExpandedCell({
      column: _column,
      row,
      anchor: {
        x: event.bounds.x - window.scrollX,
        y: event.bounds.y - window.scrollY,
        width: event.bounds.width,
        height: event.bounds.height,
      },
      value,
    })
  }, [displayRows, visibleColumns, configuredColumns, cellValue, user?.timeZone])

// Right-click on a phone cell offers Copy raw (E.164) vs Copy formatted (MAI-365);
  // on any other stored scalar cell it offers manual paint (MAI-354).
  const onCellContextMenu = useCallback(
    ([col, row]: Item, event: { bounds: Rectangle; preventDefault: () => void }) => {
      const displayRow = displayRows[row]
      const attribute = visibleColumns[col]
      if (!displayRow || displayRow.kind !== 'record' || !attribute) return
      const anchor = {
        x: event.bounds.x - window.scrollX,
        y: event.bounds.y - window.scrollY,
        width: event.bounds.width,
        height: event.bounds.height,
      }
      if (attribute.type === 'phone') {
        const raw = cellValue(displayRow.record, attribute)
        if (typeof raw !== 'string' || raw === '') return
        event.preventDefault()
        setCopyMenu({ anchor, rawValue: raw, displayValue: formatEntry(raw) })
        return
      }
      if (!viewId || !isStoredScalarCell(attribute)) return
      event.preventDefault()
      setPaintMenu({ recordId: displayRow.record.id, attribute, anchor })
    },
    [displayRows, visibleColumns, cellValue, viewId],
  )

  const applyPaint = useCallback((recordId: string, attribute: AttributeDef, backgroundToken: string | null, textToken: string | null) => {
    if (!viewId) return
    void setCellStyle.mutateAsync({ orgId, viewId, recordId, fieldId: attribute.id, backgroundToken, textToken }).catch(() => {
      toast.error('Could not save the paint. Try again.')
    })
  }, [orgId, viewId, setCellStyle])

  const [scrollOffsetX, setScrollOffsetX] = useState(0)
  const onGridVisibleRegionChanged = useCallback((range: Rectangle, tx: number) => {
    onVisibleRegionChanged(range)
    const widthBeforeVisibleColumn = gridColumns
      .slice(config.frozenCols, Math.max(config.frozenCols, range.x))
      .reduce((total, column) => total + ('width' in column && typeof column.width === 'number' ? column.width : 0), 0)
    setScrollOffsetX(Math.max(0, widthBeforeVisibleColumn - tx))
  }, [onVisibleRegionChanged, gridColumns, config.frozenCols])

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
  const setLayout = (nextLayout: 'grid' | 'kanban') => {
    if (nextLayout === 'kanban' && !columns.some((attribute) => attribute.id === config.kanban?.groupAttributeId && (attribute.type === 'select' || attribute.type === 'status'))) {
      const kanban = createKanbanConfig(columns)
      onViewConfigChange?.((current) => kanban ? { ...current, kanban } : current)
    }
    onLayoutChange?.(nextLayout)
  }
  const searchPending = searchValue.trim() !== debouncedSearch || (Boolean(debouncedSearch) && isFetching)
  const searchEmpty = Boolean(debouncedSearch) && !isFetching && totalCount === 0
  const searchCount = (
    <RecordCount filteredCount={totalCount} isFiltered={Boolean(debouncedSearch)} totalCount={totalCountBeforeSearch ?? totalCount} />
  )
  const searchEmptyState = (
    <div className="flex min-h-0 flex-1 items-start justify-center p-6">
      <EmptyState title="No records match this search.">
        <Button type="button" variant="secondary" size="sm" onClick={() => updateSearchValue('')}>Clear search</Button>
      </EmptyState>
    </div>
  )

  if (layout === 'kanban') {
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
            layout={layout}
            onLayoutChange={setLayout}
            searchValue={searchValue}
            searchPending={searchPending}
            onSearchChange={updateSearchValue}
            onFindInGrid={() => { setFindOpen(true); setReplaceOpen(false) }}
            onFormat={(anchor) => setFormatPanel({ anchor, attributeId: null })}
            trailing={searchCount}
          />
        )}
        {onViewConfigChange && <AppliedGridConstraints attributes={columns} config={config} onConfigChange={onViewConfigChange} />}
        {searchEmpty ? searchEmptyState : (
          <KanbanBoard
            attributes={columns}
            config={config}
            rows={kanbanRows}
            onRecordMove={kanbanGroupAttribute?.isReadOnly ? undefined : moveKanbanRecord}
            selectedRecordIds={rowSelection.selectedIds}
            onToggleRecordSelection={rowSelection.toggle}
          />
        )}
      </div>
    )
  }

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
          selectedColumnIds={selectedColumnIds}
          layout={layout}
          onLayoutChange={setLayout}
          searchValue={searchValue}
          searchPending={searchPending}
          onSearchChange={updateSearchValue}
          onFindInGrid={() => { setFindOpen(true); setReplaceOpen(false) }}
          onFormat={(anchor) => setFormatPanel({ anchor, attributeId: null })}
          trailing={searchCount}
        />
      )}
      {onViewConfigChange && <AppliedGridConstraints attributes={columns} config={config} onConfigChange={onViewConfigChange} />}
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
      {rowSelection.selectedCount > 0 && (
        <BulkActionBar
          orgId={orgId}
          object={object}
          attributes={columns}
          selection={bulkSelection}
          selectedCount={rowSelection.selectedCount}
          canChangeOwner={canChangeOwner}
          onClear={rowSelection.clear}
        />
      )}
      {rowSelection.shouldOfferSelectAll && (
        <SelectionBanner
          loadedCount={loadedRecordIds.length}
          totalCount={totalCount}
          onSelectAll={rowSelection.selectAllInFilter}
          onClear={rowSelection.clear}
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
          reorderDisabled={sortActive}
        />
      )}
      <div ref={gridRef} className="relative min-h-0 flex-1" onMouseLeave={() => { setHoveredCell(null); setExpandedCell(null); setChangeHighlightHover(null) }}>
        <DataEditor
        ref={dataEditorRef}
        columns={gridColumns}
        getCellContent={getCellContent}
        getCellsForSelection
        onPaste
        onCellEdited={onCellEdited}
        validateCell={validateCell}
        fillHandle
        onFillPattern={onFillPattern}
        customRenderers={[chipCellRenderer, fieldEditorCellRenderer]}
        drawCell={drawCell}
        drawHeader={drawHeader}
        rows={gridRowCount}
        freezeColumns={Math.min(config.frozenCols, gridColumns.length)}
        rowHeight={rowHeightPx}
        headerHeight={headerHeightPx}
        verticalBorder={false}
        onColumnMoved={sortActive || config.columns.some((column) => column.group) ? undefined : onColumnMoved}
        onColumnResize={onColumnResize}
        rowMarkers={{ kind: 'checkbox-visible', width: ROW_MARKER_WIDTH }}
        rowSelect="multi"
        smoothScrollX
        smoothScrollY
        onVisibleRegionChanged={onGridVisibleRegionChanged}
        headerIcons={GRID_HEADER_ICONS}
        onHeaderMenuClick={onHeaderMenuClick}
        onCellClicked={onCellClicked}
        onCellContextMenu={onCellContextMenu}
        onKeyDown={onGridKeyDown}
        gridSelection={finderSelection ?? gridSelection}
        onGridSelectionChange={(nextSelection) => {
          setGridSelection(nextSelection)
          const selectedRows = selectedGridRows(nextSelection)
          if (!finderSelection && selectedRows) rowSelection.setLoadedSelection(selectedRows.flatMap((row) => recordAtRow(row)?.id ?? []))
        }}
        onMouseMove={onMouseMove}
        getRowThemeOverride={getRowThemeOverride}
        theme={theme}
        width="100%"
        height="100%"
        />

        {searchEmpty && <div className="absolute inset-0 z-10 bg-bg">{searchEmptyState}</div>}

        <ChangeHighlightOverlay
          hover={changeHighlightHover}
          timeZone={user?.timeZone}
          onShowFullHistory={setHistoryTarget}
        />
        {autocomplete && (
          <GridAutocompleteOverlay
            anchor={autocomplete.anchor}
            attribute={autocomplete.attribute}
            orgId={orgId}
            trigger={autocomplete.trigger}
            onCommit={(value) => {
              commitValue(autocomplete.record, autocomplete.attribute, value)
              setAutocomplete(null)
              dataEditorRef.current?.focus()
            }}
            onClose={() => {
              setAutocomplete(null)
              dataEditorRef.current?.focus()
            }}
          />
        )}
        {historyTarget && (
          <FieldHistoryPopover
            key={`${historyTarget.recordId}:${historyTarget.attribute.id}`}
            orgId={orgId}
            recordId={historyTarget.recordId}
            attribute={historyTarget.attribute}
            timeZone={user?.timeZone}
            open
            onOpenChange={(nextOpen) => { if (!nextOpen) setHistoryTarget(null) }}
            anchor={historyTarget.bounds}
          />
        )}

        {headerMenu && onViewConfigChange && (
          <GridColumnFilterMenu
            attribute={headerMenu.attribute}
            anchor={headerMenu.anchor}
            config={config}
            onConfigChange={onViewConfigChange}
            onToggleWrap={() => onViewConfigChange((current) => ({
              ...current,
              columns: current.columns.map((column) => column.attributeId === headerMenu.attribute.id ? { ...column, wrap: column.wrap !== true } : column),
            }))}
            freezeActions={{
              freezeLabel: 'Freeze up to this column',
              onFreeze: () => onViewConfigChange((current) => ({ ...current, frozenCols: headerMenu.columnIndex + 1 })),
              onUnfreeze: () => onViewConfigChange((current) => ({ ...current, frozenCols: 0 })),
              unfreezeLabel: 'Unfreeze columns',
            }}
            onConditionalFormat={() => {
              setFormatPanel({ anchor: headerMenu.anchor, attributeId: headerMenu.attribute.id })
              setHeaderMenu(null)
            }}
            onOpenChange={(open) => {
              if (!open) setHeaderMenu(null)
            }}
            open
            values={activeHeaderMenuValues}
            wrap={configuredColumns.get(headerMenu.attribute.id)?.wrap === true}
          />
        )}

        {expandedCell && (
          <CellExpandOverlay
            anchor={expandedCell.anchor}
            onClose={() => setExpandedCell(null)}
            open
            value={expandedCell.value}
          />
        )}

        {copyMenu && (
          <CellCopyMenu
            anchor={copyMenu.anchor}
            rawValue={copyMenu.rawValue}
            displayValue={copyMenu.displayValue}
            onClose={() => setCopyMenu(null)}
          />
        )}

        {onViewConfigChange && (
          <>
            <div
              aria-label="Drag to freeze columns"
              className="absolute top-9 bottom-0 z-20 w-3 -translate-x-1/2 touch-none cursor-col-resize"
              data-testid="column-freeze-line"
              onPointerDown={(event) => {
                event.preventDefault()
                freezeLineDrag.current = { axis: 'columns', value: config.frozenCols }
              }}
              style={{ left: frozenColumnBoundary }}
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 border-l-2 border-primary" />
            </div>
            <div
              aria-label="Drag to freeze rows"
              className="absolute right-0 left-0 z-20 h-3 -translate-y-1/2 touch-none cursor-row-resize"
              data-testid="row-freeze-line"
              onPointerDown={(event) => {
                event.preventDefault()
                freezeLineDrag.current = { axis: 'rows', value: config.frozenRows }
              }}
              style={{ top: frozenRowBoundary }}
            >
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-0 left-0 border-t-2 border-primary" />
            </div>
          </>
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
            style={{ top: headerHeightPx, height: config.frozenRows * rowHeightPx }}
          >
            <DataEditor
              className="record-grid-frozen-rows"
              columns={gridColumns}
              getCellContent={getCellContent}
              drawCell={drawCell}
              rows={config.frozenRows}
              freezeColumns={Math.min(config.frozenCols, gridColumns.length)}
              rowMarkers={{ kind: 'clickable-number', width: ROW_MARKER_WIDTH }}
              rowHeight={rowHeightPx}
              headerHeight={0}
              scrollOffsetX={scrollOffsetX}
              smoothScrollX
              getRowThemeOverride={getRowThemeOverride}
              theme={theme}
              verticalBorder={false}
              width="100%"
              height="100%"
            />
          </div>
        )}

        {hoveredCell && (
        <IconButton
          type="button"
          tooltip={`Show actions for row ${hoveredCell.row + 1}`}
          variant="ghost"
          className="absolute z-20 size-5 p-0"
          style={{ top: hoveredCell.y + hoveredCell.height / 2 - 10, left: 4 }}
          onClick={() => {
            const bounds = gridRef.current?.getBoundingClientRect()
            setRowFreezeMenu({
              row: hoveredCell.row,
              anchor: { x: bounds?.left ?? 0, y: (bounds?.top ?? 0) + hoveredCell.y, width: ROW_MARKER_WIDTH, height: hoveredCell.height },
            })
          }}
        >
          <Ellipsis className="size-4" />
        </IconButton>
        )}

        {rowFreezeMenu && onViewConfigChange && (
          <GridRowFreezeMenu
            anchor={rowFreezeMenu.anchor}
            open
            row={rowFreezeMenu.row}
            onFreeze={() => onViewConfigChange((current) => ({ ...current, frozenRows: rowFreezeMenu.row + 1 }))}
            onOpenChange={(open) => {
              if (!open) setRowFreezeMenu(null)
            }}
            onUnfreeze={() => onViewConfigChange((current) => ({ ...current, frozenRows: 0 }))}
          />
        )}

        {paintMenu && (
          <CellPaintMenu
            anchor={paintMenu.anchor}
            open
            backgroundToken={paintByCell.get(`${paintMenu.recordId}:${paintMenu.attribute.id}`)?.backgroundToken ?? null}
            textToken={paintByCell.get(`${paintMenu.recordId}:${paintMenu.attribute.id}`)?.textToken ?? null}
            colors={colors.paintColors}
            onPaint={(backgroundToken, textToken) => applyPaint(paintMenu.recordId, paintMenu.attribute, backgroundToken, textToken)}
            onOpenChange={(open) => {
              if (!open) setPaintMenu(null)
            }}
          />
        )}

        {formatPanel && viewId && (
          <ConditionalFormatPanel
            anchor={formatPanel.anchor}
            open
            onOpenChange={(open) => {
              if (!open) setFormatPanel(null)
            }}
            orgId={orgId}
            viewId={viewId}
            attributes={columns}
            colors={colors.paintColors}
            initialAttributeId={formatPanel.attributeId}
          />
        )}

        {hoveredCell && (
        <IconButton
          type="button"
          tooltip={`Open ${object.name.toLowerCase()} on row ${hoveredCell.row + 1}`}
          variant="ghost"
          className="absolute z-20 size-5 p-0"
          style={{
            top: hoveredCell.y + hoveredCell.height / 2 - 10,
            left: hoveredCell.x + hoveredCell.width - 26,
          }}
          onClick={() => openPeek(hoveredCell.row)}
        >
          <CornerRightUp className="size-4" />
        </IconButton>
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
        onOpenFullPage={peekRecord ? () => {
          closePeek()
          navigate(`/records/${object.slug}/${peekRecord.id}`)
        } : undefined}
        onLifecycleChanged={() => void refetch()}
        />
      </div>
    </div>
  )
}
