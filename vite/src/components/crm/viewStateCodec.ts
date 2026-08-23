import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig, ViewFilterNode, ViewFilterOperator, ViewSort } from './viewConfig'

const VERSION = 1

const OPERATORS = new Set<ViewFilterOperator>([
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty', 'in', 'between', 'not_in',
])

export type ViewStateOverlay = Partial<Pick<
  ViewConfig,
  'columns' | 'sorts' | 'filterTree' | 'groupBy' | 'rowHeight' | 'gridLines' | 'frozenRows' | 'frozenCols' | 'zoom'
>>

type EncodedViewState = {
  version: number
  columns?: Array<{ attributeId: string; order: number }>
  sorts?: ViewSort[]
  filterTree?: unknown
  groupBy?: ViewSort[]
  rowHeight?: ViewConfig['rowHeight']
  gridLines?: boolean
  frozenRows?: number
  frozenCols?: number
  zoom?: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function encodeFilterTree(node: ViewFilterNode): unknown {
  if (node.type === 'condition') {
    return { type: 'condition', attributeId: node.attributeId, operator: node.operator }
  }
  return { type: 'group', op: node.op, children: node.children.map(encodeFilterTree) }
}

function decodeFilterTree(value: unknown, knownIds: Set<string>): ViewFilterNode | undefined {
  if (!isObject(value)) return undefined
  if (value.type === 'condition') {
    if (!isIdentifier(value.attributeId) || !knownIds.has(value.attributeId) || typeof value.operator !== 'string' || !OPERATORS.has(value.operator as ViewFilterOperator)) return undefined
    return { type: 'condition', attributeId: value.attributeId, operator: value.operator as ViewFilterOperator }
  }
  if (value.type !== 'group' || (value.op !== 'and' && value.op !== 'or') || !Array.isArray(value.children)) return undefined
  const children = value.children
    .map((child) => decodeFilterTree(child, knownIds))
    .filter((child): child is ViewFilterNode => Boolean(child))
  return children.length > 0 ? { type: 'group', op: value.op, children } : undefined
}

function decodeSorts(value: unknown, knownIds: Set<string>): ViewSort[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => (
    isObject(entry) && isIdentifier(entry.attributeId) && knownIds.has(entry.attributeId) && (entry.direction === 'asc' || entry.direction === 'desc')
      ? [{ attributeId: entry.attributeId, direction: entry.direction }]
      : []
  ))
}

function encode(value: EncodedViewState): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decode(encoded: string): unknown {
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (encoded.length % 4)) % 4)
  return JSON.parse(atob(padded))
}

/** Encodes only durable identifiers and display structure; filter values never enter the URL. */
export function encodeViewState(config: ViewConfig): string {
  return encode({
    version: VERSION,
    columns: config.columns
      .filter((column) => column.visible)
      .sort((left, right) => left.order - right.order)
      .map(({ attributeId, order }) => ({ attributeId, order })),
    sorts: config.sorts,
    ...(config.filterTree ? { filterTree: encodeFilterTree(config.filterTree) } : {}),
    groupBy: config.groupBy,
    rowHeight: config.rowHeight,
    gridLines: config.gridLines,
    frozenRows: config.frozenRows,
    frozenCols: config.frozenCols,
    zoom: config.zoom,
  })
}

/** Decodes a live overlay, dropping malformed, stale, archived, and unsupported fragments. */
export function decodeViewState(encoded: string | null, attributes: AttributeDef[]): ViewStateOverlay {
  if (!encoded) return {}
  try {
    const parsed: unknown = decode(encoded)
    if (!isObject(parsed) || parsed.version !== VERSION) return {}

    const knownIds = new Set(attributes
      .filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived)
      .map((attribute) => attribute.id))
    const overlay: ViewStateOverlay = {}

    if (parsed.columns !== undefined && Array.isArray(parsed.columns)) {
      const seen = new Set<string>()
      overlay.columns = parsed.columns.flatMap((column) => {
        if (!isObject(column) || !isIdentifier(column.attributeId) || !knownIds.has(column.attributeId) || seen.has(column.attributeId) || !isIntegerInRange(column.order, 0, 1000)) return []
        seen.add(column.attributeId)
        return [{ attributeId: column.attributeId, visible: true, order: column.order }]
      })
    }

    const sorts = decodeSorts(parsed.sorts, knownIds)
    if (sorts) overlay.sorts = sorts
    const groupBy = decodeSorts(parsed.groupBy, knownIds)
    if (groupBy) overlay.groupBy = groupBy
    const filterTree = decodeFilterTree(parsed.filterTree, knownIds)
    if (filterTree) overlay.filterTree = filterTree
    if (parsed.rowHeight === 'compact' || parsed.rowHeight === 'comfortable' || parsed.rowHeight === 'tall') overlay.rowHeight = parsed.rowHeight
    if (typeof parsed.gridLines === 'boolean') overlay.gridLines = parsed.gridLines
    if (isIntegerInRange(parsed.frozenRows, 0, 100)) overlay.frozenRows = parsed.frozenRows
    if (isIntegerInRange(parsed.frozenCols, 0, 100)) overlay.frozenCols = parsed.frozenCols
    if (isIntegerInRange(parsed.zoom, 50, 200)) overlay.zoom = parsed.zoom
    return overlay
  } catch {
    return {}
  }
}
