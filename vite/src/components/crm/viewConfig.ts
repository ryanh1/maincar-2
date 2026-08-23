import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { AttributeDef } from '@/lib/crmTypes'
import { PAINT_TOKENS } from '@/lib/paintTokens'
import { decodeViewState, encodeViewState, type ViewStateOverlay } from './viewStateCodec'

export type ViewSort = {
  attributeId: string
  direction: 'asc' | 'desc'
}

export type ViewFilterOperator =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'is_not_empty' | 'in'
  | 'between' | 'not_in'

export type ViewFilterCondition = {
  type: 'condition'
  attributeId: string
  operator: ViewFilterOperator
  value?: unknown
}

export type ViewFilterGroup = {
  type: 'group'
  op: 'and' | 'or'
  children: ViewFilterNode[]
}

export type ViewFilterNode = ViewFilterCondition | ViewFilterGroup

/** A durable selection that the server resolves against the live team roster. */
export type TeamScope = {
  teamIds?: string[]
  leadUserIds?: string[]
}

/** A display column stored with a view. Group state is repeated per member so it survives view persistence. */
export type ViewColumn = {
  attributeId: string
  visible: boolean
  order: number
  /** Omitted values preserve the default clipped cell rendering. */
  wrap?: boolean
  group?: string
  collapsed?: boolean
}

/** The grid's non-destructive recent-change overlay and its optional row scope. */
export type ChangeHighlightConfig = {
  mode: 'off' | 'on'
  days: number
  onlyChangedRows: boolean
}

export type KanbanConfig = {
  groupAttributeId: string
  visibleOptionValues: string[]
  cardAttributeIds: string[]
  hiddenTerminalOptionValues?: string[]
}

/** Sheets-style zoom presets (journey 4b.10.1). Custom values clamp to this range. */
export const ZOOM_PRESETS = [50, 75, 90, 100, 125, 150, 200] as const
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom)))
}

/** Step to the nearest preset above (1) or below (-1) the current zoom. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_PRESETS.find((preset) => preset > current) ?? ZOOM_MAX
  }
  return [...ZOOM_PRESETS].reverse().find((preset) => preset < current) ?? ZOOM_MIN
}

/** A relation column's stable automatic hue, derived from its source object id. */
export function relationSourceHue(refObjectId: string | null): string | undefined {
  if (!refObjectId) return undefined
  let hash = 0
  for (let index = 0; index < refObjectId.length; index += 1) {
    hash = (hash * 31 + refObjectId.charCodeAt(index)) >>> 0
  }
  return PAINT_TOKENS[hash % PAINT_TOKENS.length]
}

/**
 * Resolve a column header's colour (SPEC-CHUNK-2 J2.5 §B): a manual token wins,
 * then a relation column's automatic source hue, then neutral (undefined).
 */
export function resolveHeaderColor(attribute: AttributeDef, columnStyles: ViewConfig['columnStyles']): string | undefined {
  const style = columnStyles.find((candidate) => candidate.attributeId === attribute.id)
  if (style?.headerColor) return style.headerColor
  if (attribute.type === 'record_reference' || attribute.type === 'user_reference') {
    return relationSourceHue(attribute.refObjectId)
  }
  return undefined
}

/** Set or clear a column's manual header colour, dropping the entry when cleared. */
export function setColumnHeaderColor(columnStyles: ViewConfig['columnStyles'], attributeId: string, headerColor: string | undefined): ViewConfig['columnStyles'] {
  const existing = columnStyles.find((candidate) => candidate.attributeId === attributeId)
  if (!headerColor) {
    return existing ? columnStyles.filter((candidate) => candidate.attributeId !== attributeId) : columnStyles
  }
  if (existing) {
    return columnStyles.map((candidate) => candidate.attributeId === attributeId ? { ...candidate, headerColor } : candidate)
  }
  return [...columnStyles, { attributeId, headerColor }]
}

/**
 * The live counterpart of SavedView.configJson. This route keeps the current
 * view state locally and uses the same shape the saved-view contract persists.
 */
export type ViewConfig = {
  columns: ViewColumn[]
  sorts: ViewSort[]
  filterTree?: ViewFilterNode
  teamScope?: TeamScope
  groupBy: ViewSort[]
  rowHeight: 'compact' | 'comfortable' | 'tall'
  gridLines: boolean
  frozenRows: number
  frozenCols: number
  zoom: number
  columnWidths: Record<string, number>
  columnStyles: Array<{ attributeId: string; headerColor?: string }>
  kanban?: KanbanConfig
  changeHighlight: ChangeHighlightConfig
}

export type RecordListFilter =
  | {
      type: 'condition'
      field: string
      operator: Exclude<ViewFilterOperator, 'between' | 'not_in'>
      value?: unknown
    }
  | {
      type: 'group'
      op: 'and' | 'or'
      children: RecordListFilter[]
    }

export type RecordListQuery = {
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>
  filter?: RecordListFilter
  teamScope?: TeamScope
}

const EMPTY_CONFIG: Omit<ViewConfig, 'columns'> = {
  sorts: [],
  groupBy: [],
  rowHeight: 'compact',
  gridLines: true,
  frozenRows: 0,
  frozenCols: 1,
  zoom: 100,
  columnWidths: {},
  columnStyles: [],
  changeHighlight: { mode: 'off', days: 7, onlyChangedRows: false },
}

export function createViewConfig(attributes: AttributeDef[]): ViewConfig {
  return {
    ...EMPTY_CONFIG,
    columns: attributes
      .filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((attribute, index) => ({ attributeId: attribute.id, visible: true, order: index })),
  }
}

function activeOptionValues(attribute: AttributeDef): string[] {
  if (!Array.isArray(attribute.optionsJson)) return []
  return attribute.optionsJson
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => Boolean(option) && typeof option === 'object')
    .map(({ option, index }) => {
      const candidate = option as { value?: unknown; order?: unknown; isArchived?: unknown }
      return typeof candidate.value === 'string' && !candidate.isArchived
        ? { value: candidate.value, order: typeof candidate.order === 'number' ? candidate.order : index }
        : null
    })
    .filter((option): option is { value: string; order: number } => option !== null)
    .sort((left, right) => left.order - right.order)
    .map((option) => option.value)
}

export function isKanbanGroupAttribute(attribute: AttributeDef): boolean {
  return !attribute.isArchived && (attribute.type === 'select' || attribute.type === 'status') && activeOptionValues(attribute).length > 0
}

/** Deals normally group by pipeline stage; other objects use their first selectable field. */
export function createKanbanConfig(attributes: AttributeDef[], groupAttributeId?: string): KanbanConfig | undefined {
  const eligible = attributes.filter(isKanbanGroupAttribute)
  const pipelineStage = eligible.find((attribute) => /pipeline.?stage/i.test(attribute.slug) || /pipeline stage/i.test(attribute.name))
  const groupAttribute = eligible.find((attribute) => attribute.id === groupAttributeId) ?? pipelineStage ?? eligible[0]
  return groupAttribute
    ? {
        groupAttributeId: groupAttribute.id,
        visibleOptionValues: activeOptionValues(groupAttribute),
        cardAttributeIds: attributes
          .filter((attribute) => attribute.id !== groupAttribute.id && !attribute.isIdentity && !attribute.isArchived && attribute.storage !== 'list')
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .slice(0, 3)
          .map((attribute) => attribute.id),
      }
    : undefined
}

/** Reorder whole groups so their member columns always remain adjacent. */
export function reorderColumnGroup(columns: ViewColumn[], activeGroup: string, overGroup: string): ViewColumn[] {
  if (activeGroup === overGroup) return columns

  const units: Array<{ id: string; columns: ViewColumn[] }> = []
  const unitsById = new Map<string, { id: string; columns: ViewColumn[] }>()
  for (const column of columns.slice().sort((left, right) => left.order - right.order)) {
    const id = column.group ? `group:${column.group}` : `column:${column.attributeId}`
    const unit = unitsById.get(id) ?? { id, columns: [] }
    if (!unitsById.has(id)) {
      unitsById.set(id, unit)
      units.push(unit)
    }
    unit.columns.push(column)
  }

  const activeIndex = units.findIndex((unit) => unit.id === `group:${activeGroup}`)
  const overIndex = units.findIndex((unit) => unit.id === `group:${overGroup}`)
  if (activeIndex < 0 || overIndex < 0) return columns

  const [active] = units.splice(activeIndex, 1)
  units.splice(overIndex, 0, active)
  return units.flatMap((unit) => unit.columns).map((column, order) => ({ ...column, order }))
}

function mergeConfigWithAttributes(defaults: ViewConfig, current: ViewConfig): ViewConfig {
  const knownAttributeIds = new Set(defaults.columns.map((column) => column.attributeId))
  const retainedColumns = current.columns.filter((column) => knownAttributeIds.has(column.attributeId))
  const retainedIds = new Set(retainedColumns.map((column) => column.attributeId))
  const newColumns = defaults.columns.filter((column) => !retainedIds.has(column.attributeId))

  return {
    ...defaults,
    ...current,
    columns: [...retainedColumns, ...newColumns],
  }
}

function applyViewStateOverlay(config: ViewConfig, overlay: ViewStateOverlay): ViewConfig {
  const visibleColumns = overlay.columns ? new Map(overlay.columns.map((column) => [column.attributeId, column])) : null
  return {
    ...config,
    ...(visibleColumns ? {
      columns: config.columns.map((column) => {
        const shared = visibleColumns.get(column.attributeId)
        return shared ? { ...column, visible: true, order: shared.order } : { ...column, visible: false }
      }),
    } : {}),
    ...(overlay.sorts ? { sorts: overlay.sorts } : {}),
    ...(overlay.filterTree ? { filterTree: overlay.filterTree } : {}),
    ...(overlay.groupBy ? { groupBy: overlay.groupBy } : {}),
    ...(overlay.rowHeight ? { rowHeight: overlay.rowHeight } : {}),
    ...(overlay.gridLines !== undefined ? { gridLines: overlay.gridLines } : {}),
    ...(overlay.frozenRows !== undefined ? { frozenRows: overlay.frozenRows } : {}),
    ...(overlay.frozenCols !== undefined ? { frozenCols: overlay.frozenCols } : {}),
    ...(overlay.zoom !== undefined ? { zoom: overlay.zoom } : {}),
  }
}

function toRecordListFilter(node: ViewFilterNode, attributesById: Map<string, AttributeDef>): RecordListFilter | null {
  if (node.type === 'condition') {
    const attribute = attributesById.get(node.attributeId)
    if (!attribute) return null
    if (node.operator === 'between') {
      const [lower, upper] = Array.isArray(node.value) ? node.value : []
      if (lower === undefined || upper === undefined || lower === '' || upper === '') return null
      return {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', field: attribute.slug, operator: 'gte', value: lower },
          { type: 'condition', field: attribute.slug, operator: 'lte', value: upper },
        ],
      }
    }
    if (node.operator === 'not_in') {
      const values = Array.isArray(node.value) ? node.value.filter((value) => value !== '') : []
      if (values.length === 0) return null
      return {
        type: 'group',
        op: 'and',
        children: values.map((value) => ({ type: 'condition', field: attribute.slug, operator: 'neq', value })),
      }
    }
    if (node.operator === 'in' && (!Array.isArray(node.value) || node.value.length === 0)) return null
    if (!['is_empty', 'is_not_empty'].includes(node.operator) && (node.value === undefined || node.value === '')) return null
    return { type: 'condition', field: attribute.slug, operator: node.operator, ...(node.value === undefined ? {} : { value: node.value }) }
  }

  const children = node.children
    .map((child) => toRecordListFilter(child, attributesById))
    .filter((child): child is RecordListFilter => child !== null)
  return children.length > 0 ? { type: 'group', op: node.op, children } : null
}

/** Translate durable view-config attribute ids into the API's current slugs. */
export function toRecordListQuery(config: ViewConfig, attributes: AttributeDef[]): RecordListQuery {
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const sorts = config.sorts.flatMap((sort) => {
    const attribute = attributesById.get(sort.attributeId)
    return attribute ? [{ field: attribute.slug, direction: sort.direction }] : []
  })
  const filter = config.filterTree ? toRecordListFilter(config.filterTree, attributesById) : null

  return {
    ...(sorts.length ? { sort: sorts } : {}),
    ...(filter ? { filter } : {}),
    ...(config.teamScope ? { teamScope: config.teamScope } : {}),
  }
}

/**
 * Route-owned live view state. The workspace codec holds versioned,
 * allow-listed structure and layout; filter literals remain in memory so CRM
 * values and PII never leak into a shared URL.
 */
export function sameViewConfig(left: ViewConfig, right: ViewConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

type LocalViewState = Pick<
  ViewConfig,
  'filterTree' | 'teamScope' | 'changeHighlight' | 'columnWidths' | 'columnStyles' | 'kanban'
> & {
  columns: Array<Pick<ViewColumn, 'attributeId' | 'visible' | 'order' | 'wrap' | 'group' | 'collapsed'>>
}

function localViewState(config: ViewConfig): LocalViewState {
  return {
    filterTree: config.filterTree,
    teamScope: config.teamScope,
    changeHighlight: config.changeHighlight,
    columnWidths: config.columnWidths,
    columnStyles: config.columnStyles,
    kanban: config.kanban,
    columns: config.columns.map(({ attributeId, visible, order, wrap, group, collapsed }) => ({
      attributeId,
      visible,
      order,
      ...(wrap !== undefined ? { wrap } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(collapsed !== undefined ? { collapsed } : {}),
    })),
  }
}

function mergeLocalViewState(config: ViewConfig, local: LocalViewState | null): ViewConfig {
  if (!local) return config
  const columnsById = new Map(local.columns.map((column) => [column.attributeId, column]))
  return {
    ...config,
    filterTree: local.filterTree,
    teamScope: local.teamScope,
    changeHighlight: local.changeHighlight,
    columnWidths: local.columnWidths,
    columnStyles: local.columnStyles,
    kanban: local.kanban,
    columns: config.columns
      .map((column) => ({ ...column, ...columnsById.get(column.attributeId) }))
      .sort((left, right) => left.order - right.order),
  }
}

/** A saved view establishes the durable baseline; `v` overlays safe route state for this session only. */
export function useViewConfig(
  attributes: AttributeDef[],
  savedConfig?: ViewConfig,
): [ViewConfig, (update: (current: ViewConfig) => ViewConfig) => void, () => void, () => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const sharedConfig = useMemo(() => {
    const defaults = createViewConfig(attributes)
    const saved = savedConfig ? mergeConfigWithAttributes(defaults, savedConfig) : defaults
    return applyViewStateOverlay(saved, decodeViewState(searchParams.get('v'), attributes))
  }, [attributes, savedConfig, searchParams])

  // Typed values and free-form display labels remain page-local. Navigation
  // state stays responsive to the URL while these settings never leak into it.
  const [localConfig, setLocalConfig] = useState<LocalViewState | null>(null)
  const config = useMemo(() => mergeLocalViewState(sharedConfig, localConfig), [sharedConfig, localConfig])

  const updateConfig = useCallback(
    (update: (current: ViewConfig) => ViewConfig) => {
      const next = update(config)
      setLocalConfig(localViewState(next))
      setSearchParams((current) => {
        const params = new URLSearchParams(current)
        params.set('v', encodeViewState(next))
        return params
      }, { replace: true })
    },
    [config, setSearchParams],
  )

  const resetConfig = useCallback(() => {
    setLocalConfig(null)
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      params.delete('v')
      return params
    }, { replace: true })
  }, [setSearchParams])

  const clearLocalConfig = useCallback(() => setLocalConfig(null), [])

  return [config, updateConfig, resetConfig, clearLocalConfig]
}
