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

/**
 * The live counterpart of SavedView.configJson. Saved views have not landed
 * yet (MAI-176), so this state belongs to the current route and is ready to be
 * persisted unchanged when that slice adds the server contract.
 */
export type ViewConfig = {
  columns: Array<{ attributeId: string; visible: boolean; order: number }>
  sorts: ViewSort[]
  filterTree?: ViewFilterNode
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
}

type SharedViewConfig = {
  version: 1
  sorts: ViewSort[]
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

function isViewSort(value: unknown, knownIds: Set<string>): value is ViewSort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { attributeId?: unknown }).attributeId === 'string' &&
    knownIds.has((value as { attributeId: string }).attributeId) &&
    ((value as { direction?: unknown }).direction === 'asc' || (value as { direction?: unknown }).direction === 'desc')
  )
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
    return { version: 1, sorts }
  } catch {
    return null
  }
}

function encodeSharedConfig(config: ViewConfig): string | null {
  if (config.sorts.length === 0) return null
  const shared: SharedViewConfig = { version: 1, sorts: config.sorts }
  return btoa(JSON.stringify(shared))
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
  }
}

/**
 * Route-owned live view state. The `v` parameter holds only versioned,
 * allow-listed display state; filter literals remain in memory so PII never
 * leaks into a shared URL.
 */
export function useViewConfig(attributes: AttributeDef[]): [ViewConfig, (update: (current: ViewConfig) => ViewConfig) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterTree, setFilterTree] = useState<ViewFilterNode | undefined>()
  const baseConfig = useMemo(() => {
    const defaults = createViewConfig(attributes)
    const shared = decodeSharedConfig(searchParams.get('v'), attributes)
    return shared ? { ...defaults, sorts: shared.sorts } : defaults
  }, [attributes, searchParams])

  const config = useMemo(() => ({ ...baseConfig, ...(filterTree ? { filterTree } : {}) }), [baseConfig, filterTree])

  const updateConfig = useCallback(
    (update: (current: ViewConfig) => ViewConfig) => {
      const next = update(config)
      setFilterTree(next.filterTree)
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

  return [config, updateConfig]
}
