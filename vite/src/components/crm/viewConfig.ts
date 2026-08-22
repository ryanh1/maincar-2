import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { AttributeDef } from '@/lib/crmTypes'

export type ViewSort = {
  attributeId: string
  direction: 'asc' | 'desc'
}

export type ViewFilterCondition = {
  type: 'condition'
  attributeId: string
  operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'is_not_empty' | 'in'
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
  group?: string
  collapsed?: boolean
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
}

export type RecordListFilter =
  | {
      type: 'condition'
      field: string
      operator: ViewFilterCondition['operator']
      value?: unknown
    }
  | {
      type: 'group'
      op: 'and' | 'or'
      children: RecordListFilter[]
    }

export type RecordListQuery = {
  sort?: { field: string; direction: 'asc' | 'desc' }
  filter?: RecordListFilter
  teamScope?: TeamScope
}

type SharedViewConfig = {
  version: 1
  sorts: ViewSort[]
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

function decodeSharedConfig(encoded: string | null, attributes: AttributeDef[]): SharedViewConfig | null {
  if (!encoded) return null

  try {
    const parsed: unknown = JSON.parse(atob(encoded))
    if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 1) return null
    const knownIds = new Set(attributes.map((attribute) => attribute.id))
    const sorts = Array.isArray((parsed as { sorts?: unknown }).sorts)
      ? (parsed as { sorts: unknown[] }).sorts.filter((sort) => isViewSort(sort, knownIds))
      : []
    const teamScope = parseTeamScope((parsed as { teamScope?: unknown }).teamScope)
    return { version: 1, sorts, ...(teamScope ? { teamScope } : {}) }
  } catch {
    return null
  }
}

function encodeSharedConfig(config: ViewConfig): string | null {
  const teamScope = parseTeamScope(config.teamScope)
  if (config.sorts.length === 0 && !teamScope) return null
  const shared: SharedViewConfig = { version: 1, sorts: config.sorts, ...(teamScope ? { teamScope } : {}) }
  return btoa(JSON.stringify(shared))
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

function toRecordListFilter(node: ViewFilterNode, attributesById: Map<string, AttributeDef>): RecordListFilter | null {
  if (node.type === 'condition') {
    const attribute = attributesById.get(node.attributeId)
    if (!attribute) return null
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
  const firstSort = config.sorts[0]
  const sortAttribute = firstSort ? attributesById.get(firstSort.attributeId) : undefined
  const filter = config.filterTree ? toRecordListFilter(config.filterTree, attributesById) : null

  return {
    ...(sortAttribute && firstSort ? { sort: { field: sortAttribute.slug, direction: firstSort.direction } } : {}),
    ...(filter ? { filter } : {}),
    ...(config.teamScope ? { teamScope: config.teamScope } : {}),
  }
}

/**
 * Route-owned live view state. The `v` parameter holds versioned, allow-listed
 * sort state and Team-scope ids; filter literals and local display controls
 * remain in memory so CRM values and PII never leak into a shared URL.
 */
export function sameViewConfig(left: ViewConfig, right: ViewConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** A saved view establishes the durable baseline; `v` remains a temporary URL overlay. */
export function useViewConfig(
  attributes: AttributeDef[],
  savedConfig?: ViewConfig,
): [ViewConfig, (update: (current: ViewConfig) => ViewConfig) => void, () => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const baseConfig = useMemo(() => {
    const defaults = createViewConfig(attributes)
    const saved = savedConfig ? mergeConfigWithAttributes(defaults, savedConfig) : defaults
    const shared = decodeSharedConfig(searchParams.get('v'), attributes)
    return shared ? { ...saved, sorts: shared.sorts, ...(shared.teamScope ? { teamScope: shared.teamScope } : {}) } : saved
  }, [attributes, savedConfig, searchParams])

  const [localConfig, setLocalConfig] = useState<ViewConfig | null>(null)
  // Attribute data can arrive after the route mounts. Merge it at render time so
  // a newly available field gets a default column without an effect-driven reset
  // of the controls a person has already changed.
  const config = useMemo(
    () => (localConfig ? mergeConfigWithAttributes(baseConfig, localConfig) : baseConfig),
    [baseConfig, localConfig],
  )

  const updateConfig = useCallback(
    (update: (current: ViewConfig) => ViewConfig) => {
      const next = update(config)
      setLocalConfig(next)
      const encoded = encodeSharedConfig(next)
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous)
          if (encoded) params.set('v', encoded)
          else params.delete('v')
          return params
        },
        { replace: true },
      )
    },
    [config, setSearchParams],
  )

  const resetConfig = useCallback(() => {
    setLocalConfig(null)
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        params.delete('v')
        return params
      },
      { replace: true },
    )
  }, [setSearchParams])

  return [config, updateConfig, resetConfig]
}
