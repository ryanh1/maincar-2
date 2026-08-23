import { useCallback, useMemo, useState } from 'react'

import { useWorkspaceUrlState } from '@/hooks/workspaceUrlState'
import type { AttributeDef } from '@/lib/crmTypes'
import type { WorkspaceViewConfig } from '@/lib/workspaceUrlState'

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
  /** Fields shown on compact Kanban cards; omitted views use the first three visible fields. */
  kanbanCardFieldIds?: string[]
  /** Optional numeric or currency field summed in each Kanban column header. */
  kanbanSummaryAttributeId?: string
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

/** Deals normally group by pipeline stage; other objects use their first select-like field. */
export function defaultKanbanGroupBy(attributes: AttributeDef[]): ViewSort[] {
  const eligible = attributes.filter((attribute) => !attribute.isArchived && (attribute.type === 'select' || attribute.type === 'status'))
  const pipelineStage = eligible.find((attribute) => /pipeline.?stage/i.test(attribute.slug) || /pipeline stage/i.test(attribute.name))
  const groupAttribute = pipelineStage ?? eligible[0]
  return groupAttribute ? [{ attributeId: groupAttribute.id, direction: 'asc' }] : []
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

function isViewSort(value: unknown, knownIds: Set<string>): value is ViewSort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { attributeId?: unknown }).attributeId === 'string' &&
    knownIds.has((value as { attributeId: string }).attributeId) &&
    ((value as { direction?: unknown }).direction === 'asc' || (value as { direction?: unknown }).direction === 'desc')
  )
}

function parseTeamScope(value: unknown): TeamScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as { teamIds?: unknown; leadUserIds?: unknown }
  const validIds = (ids: unknown): string[] | undefined =>
    Array.isArray(ids) && ids.every((id) => typeof id === 'string' && id.trim().length > 0)
      ? [...new Set(ids)]
      : undefined
  const teamIds = validIds(source.teamIds)
  const leadUserIds = validIds(source.leadUserIds)
  return teamIds?.length || leadUserIds?.length
    ? { ...(teamIds?.length ? { teamIds } : {}), ...(leadUserIds?.length ? { leadUserIds } : {}) }
    : undefined
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

function configFromWorkspaceState(defaults: ViewConfig, shared: WorkspaceViewConfig | undefined): ViewConfig {
  if (!shared) return defaults
  const knownIds = new Set(defaults.columns.map((column) => column.attributeId))
  const layout = shared.layout
  const retainedColumns = layout?.columns?.filter((column) => knownIds.has(column.attributeId))
  const columnWidths = Object.fromEntries(
    Object.entries(layout?.columnWidths ?? {}).filter(([attributeId]) => knownIds.has(attributeId)),
  )
  const current: ViewConfig = {
    ...defaults,
    ...(shared.sorts ? { sorts: shared.sorts.filter((sort) => isViewSort(sort, knownIds)) } : {}),
    ...(parseTeamScope(shared.teamScope) ? { teamScope: parseTeamScope(shared.teamScope) } : {}),
    ...(retainedColumns ? { columns: retainedColumns } : {}),
    ...(layout?.groupBy ? { groupBy: layout.groupBy.filter((sort) => isViewSort(sort, knownIds)) } : {}),
    ...(layout?.rowHeight ? { rowHeight: layout.rowHeight } : {}),
    ...(layout?.gridLines !== undefined ? { gridLines: layout.gridLines } : {}),
    ...(layout?.frozenRows !== undefined ? { frozenRows: layout.frozenRows } : {}),
    ...(layout?.frozenCols !== undefined ? { frozenCols: layout.frozenCols } : {}),
    ...(layout?.zoom !== undefined ? { zoom: layout.zoom } : {}),
    columnWidths,
  }
  return mergeConfigWithAttributes(defaults, current)
}

function toWorkspaceState(config: ViewConfig): WorkspaceViewConfig {
  const teamScope = parseTeamScope(config.teamScope)
  return {
    ...(config.sorts.length ? { sorts: config.sorts } : {}),
    ...(teamScope ? { teamScope } : {}),
    layout: {
      // Group names and wrapping are free-form local display settings, so they
      // are intentionally excluded from the URL's structural allow-list.
      columns: config.columns.map(({ attributeId, visible, order }) => ({ attributeId, visible, order })),
      groupBy: config.groupBy,
      rowHeight: config.rowHeight,
      gridLines: config.gridLines,
      frozenRows: config.frozenRows,
      frozenCols: config.frozenCols,
      zoom: config.zoom,
      columnWidths: config.columnWidths,
    },
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
  'filterTree' | 'changeHighlight' | 'columnStyles' | 'kanbanCardFieldIds' | 'kanbanSummaryAttributeId'
> & {
  columns: Array<Pick<ViewColumn, 'attributeId' | 'wrap' | 'group' | 'collapsed'>>
}

function localViewState(config: ViewConfig): LocalViewState {
  return {
    filterTree: config.filterTree,
    changeHighlight: config.changeHighlight,
    columnStyles: config.columnStyles,
    kanbanCardFieldIds: config.kanbanCardFieldIds,
    kanbanSummaryAttributeId: config.kanbanSummaryAttributeId,
    columns: config.columns.map(({ attributeId, wrap, group, collapsed }) => ({ attributeId, wrap, group, collapsed })),
  }
}

function mergeLocalViewState(config: ViewConfig, local: LocalViewState | null): ViewConfig {
  if (!local) return config
  const columnsById = new Map(local.columns.map((column) => [column.attributeId, column]))
  return {
    ...config,
    ...(local.filterTree ? { filterTree: local.filterTree } : {}),
    changeHighlight: local.changeHighlight,
    columnStyles: local.columnStyles,
    ...(local.kanbanCardFieldIds ? { kanbanCardFieldIds: local.kanbanCardFieldIds } : {}),
    ...(local.kanbanSummaryAttributeId ? { kanbanSummaryAttributeId: local.kanbanSummaryAttributeId } : {}),
    columns: config.columns.map((column) => ({ ...column, ...columnsById.get(column.attributeId) })),
  }
}

/** A saved view establishes the durable baseline; the workspace codec overlays safe route state. */
export function useViewConfig(
  attributes: AttributeDef[],
  savedConfig?: ViewConfig,
): [ViewConfig, (update: (current: ViewConfig) => ViewConfig) => void, () => void] {
  const [workspaceUrlState, updateWorkspaceUrlState] = useWorkspaceUrlState()
  const sharedConfig = useMemo(() => {
    const defaults = createViewConfig(attributes)
    const saved = savedConfig ? mergeConfigWithAttributes(defaults, savedConfig) : defaults
    return configFromWorkspaceState(saved, workspaceUrlState.viewConfig)
  }, [attributes, savedConfig, workspaceUrlState.viewConfig])

  // Typed values and free-form display labels remain page-local. Navigation
  // state stays responsive to the URL while these settings never leak into it.
  const [localConfig, setLocalConfig] = useState<LocalViewState | null>(null)
  const config = useMemo(() => mergeLocalViewState(sharedConfig, localConfig), [sharedConfig, localConfig])

  const updateConfig = useCallback(
    (update: (current: ViewConfig) => ViewConfig) => {
      const next = update(config)
      setLocalConfig(localViewState(next))
      updateWorkspaceUrlState((current) => ({ ...current, viewConfig: toWorkspaceState(next) }), { replace: true })
    },
    [config, updateWorkspaceUrlState],
  )

  const resetConfig = useCallback(() => {
    setLocalConfig(null)
    updateWorkspaceUrlState((current) => ({ ...current, viewConfig: undefined }), { replace: true })
  }, [updateWorkspaceUrlState])

  return [config, updateConfig, resetConfig]
}
