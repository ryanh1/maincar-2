import { z } from 'zod'

export const VIEW_CONFIG_VERSION = 1

export type ViewAttribute = {
  id: string
  sortOrder: number
  isArchived?: boolean
  deletedAt?: Date | null
  storage?: string
}

export type ViewLayout = 'list' | 'grid' | 'kanban'
export type ViewSort = { attributeId: string; direction: 'asc' | 'desc' }
export type ViewColumn = { attributeId: string; visible: boolean; order: number; group?: string; collapsed?: boolean }
export type ViewFilter =
  | { type: 'condition'; attributeId: string; operator: FilterOperator; value?: unknown }
  | { type: 'group'; op: 'and' | 'or'; children: ViewFilter[] }
export type TeamScope = { teamIds?: string[]; leadUserIds?: string[] }

type FilterOperator =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'is_not_empty' | 'in' | 'between' | 'not_in'

export type SavedViewConfig = {
  version: typeof VIEW_CONFIG_VERSION
  columns: ViewColumn[]
  sorts: ViewSort[]
  filterTree?: ViewFilter
  teamScope?: TeamScope
  groupBy: ViewSort[]
  rowHeight: 'compact' | 'comfortable' | 'tall'
  gridLines: boolean
  frozenRows: number
  frozenCols: number
  zoom: number
  columnWidths: Record<string, number>
  columnStyles: Array<{ attributeId: string; headerColor?: string; auto?: { kind: 'relation-source'; objectId: string } }>
}

export type UrlViewOverlay = Partial<Pick<SavedViewConfig, 'columns' | 'sorts' | 'teamScope' | 'groupBy' | 'rowHeight' | 'gridLines' | 'frozenRows' | 'frozenCols' | 'zoom'>> & {
  filterTree?: Omit<ViewFilter, 'value'>
  layout?: ViewLayout
}

const directionSchema = z.enum(['asc', 'desc'])
const layoutSchema = z.enum(['list', 'grid', 'kanban'])
const filterOperators = new Set<FilterOperator>([
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty', 'in', 'between', 'not_in',
])

const configShape = z.object({
  version: z.number().int().optional(),
  columns: z.array(z.object({
    attributeId: z.string().min(1),
    visible: z.boolean(),
    order: z.number().int().min(0),
    group: z.string().trim().min(1).max(100).optional(),
    collapsed: z.boolean().optional(),
  })).optional(),
  sorts: z.array(z.object({ attributeId: z.string().min(1), direction: directionSchema })).optional(),
  filterTree: z.unknown().optional(),
  teamScope: z.object({
    teamIds: z.array(z.string().trim().min(1)).optional(),
    leadUserIds: z.array(z.string().trim().min(1)).optional(),
  }).strict().refine((scope) => (scope.teamIds?.length ?? 0) + (scope.leadUserIds?.length ?? 0) > 0).optional(),
  groupBy: z.array(z.object({ attributeId: z.string().min(1), direction: directionSchema })).optional(),
  rowHeight: z.enum(['compact', 'comfortable', 'tall']).optional(),
  gridLines: z.boolean().optional(),
  frozenRows: z.number().int().min(0).max(100).optional(),
  frozenCols: z.number().int().min(0).max(100).optional(),
  zoom: z.number().int().min(50).max(200).optional(),
  columnWidths: z.record(z.string(), z.number().min(40).max(2_000)).optional(),
  columnStyles: z.array(z.object({
    attributeId: z.string().min(1),
    headerColor: z.string().trim().min(1).max(64).optional(),
    auto: z.object({ kind: z.literal('relation-source'), objectId: z.string().min(1) }).optional(),
  })).optional(),
})

function activeAttributes(attributes: ViewAttribute[]): ViewAttribute[] {
  return attributes
    .filter((attribute) => !attribute.isArchived && !attribute.deletedAt && attribute.storage !== 'list')
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
}

function repairFilter(raw: unknown, knownIds: Set<string>, includeValues: boolean): ViewFilter | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const node = raw as Record<string, unknown>
  if (node.type === 'condition') {
    if (typeof node.attributeId !== 'string' || !knownIds.has(node.attributeId)) return undefined
    if (typeof node.operator !== 'string' || !filterOperators.has(node.operator as FilterOperator)) return undefined
    const condition: ViewFilter = { type: 'condition', attributeId: node.attributeId, operator: node.operator as FilterOperator }
    if (includeValues && Object.hasOwn(node, 'value')) condition.value = node.value
    return condition
  }
  if (node.type !== 'group' || (node.op !== 'and' && node.op !== 'or') || !Array.isArray(node.children)) return undefined
  const children = node.children
    .map((child) => repairFilter(child, knownIds, includeValues))
    .filter((child): child is ViewFilter => child !== undefined)
  return children.length ? { type: 'group', op: node.op, children } : undefined
}

function hasLiteralInFilter(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const node = raw as Record<string, unknown>
  return Object.hasOwn(node, 'value') || (Array.isArray(node.children) && node.children.some(hasLiteralInFilter))
}

function uniqueByAttribute<T extends { attributeId: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => !seen.has(item.attributeId) && seen.add(item.attributeId))
}

function repairTeamScope(scope: TeamScope | undefined): TeamScope | undefined {
  if (!scope) return undefined
  const teamIds = [...new Set(scope.teamIds ?? [])]
  const leadUserIds = [...new Set(scope.leadUserIds ?? [])]
  return teamIds.length || leadUserIds.length
    ? { ...(teamIds.length ? { teamIds } : {}), ...(leadUserIds.length ? { leadUserIds } : {}) }
    : undefined
}

/**
 * Migrates any prior config into the current schema and repairs references after
 * fields change. Unknown/stale state is discarded; newly visible attributes are
 * appended with safe defaults so a view remains usable instead of becoming a
 * second schema store.
 */
export function repairSavedViewConfig(raw: unknown, attributes: ViewAttribute[]): SavedViewConfig {
  const parsed = configShape.safeParse(raw)
  const source = parsed.success ? parsed.data : {}
  const active = activeAttributes(attributes)
  const knownIds = new Set(active.map((attribute) => attribute.id))
  const requestedColumns = uniqueByAttribute(
    (source.columns ?? []).filter((column) => knownIds.has(column.attributeId)),
  ).sort((left, right) => left.order - right.order)
  const present = new Set(requestedColumns.map((column) => column.attributeId))
  const columns = [
    ...requestedColumns.map((column, index) => ({ ...column, order: index })),
    ...active.filter((attribute) => !present.has(attribute.id)).map((attribute, index) => ({
      attributeId: attribute.id, visible: true, order: requestedColumns.length + index,
    })),
  ]
  const teamScope = repairTeamScope(source.teamScope)

  return {
    version: VIEW_CONFIG_VERSION,
    columns,
    sorts: uniqueByAttribute((source.sorts ?? []).filter((sort) => knownIds.has(sort.attributeId))),
    ...(repairFilter(source.filterTree, knownIds, true) ? { filterTree: repairFilter(source.filterTree, knownIds, true) } : {}),
    ...(teamScope ? { teamScope } : {}),
    groupBy: uniqueByAttribute((source.groupBy ?? []).filter((group) => knownIds.has(group.attributeId))),
    rowHeight: source.rowHeight ?? 'compact',
    gridLines: source.gridLines ?? true,
    frozenRows: source.frozenRows ?? 0,
    frozenCols: source.frozenCols ?? 1,
    zoom: source.zoom ?? 100,
    columnWidths: Object.fromEntries(Object.entries(source.columnWidths ?? {}).filter(([id]) => knownIds.has(id))),
    columnStyles: uniqueByAttribute((source.columnStyles ?? []).filter((style) => knownIds.has(style.attributeId))),
  }
}

/** A policy seam for this release: any active workspace member can edit a shared view. */
export function canViewSavedView(view: { ownerUserId: string; isShared: boolean }, userId: string): boolean {
  return view.ownerUserId === userId || view.isShared
}

export function canEditSharedView(_view: { ownerUserId: string; isShared: boolean }, _userId: string): boolean {
  return true
}

export function canEditSavedView(view: { ownerUserId: string; isShared: boolean }, userId: string): boolean {
  return view.ownerUserId === userId || (view.isShared && canEditSharedView(view, userId))
}

export function canShareSavedView(view: { ownerUserId: string; isShared: boolean }, userId: string): boolean {
  return canEditSavedView(view, userId)
}

/** Decode a URL overlay without ever accepting CRM values, free text, or PII. */
export function decodeUrlViewOverlay(encoded: string | undefined, attributes: ViewAttribute[]): UrlViewOverlay | undefined {
  if (!encoded || encoded.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = raw as Record<string, unknown>
  if (source.version !== VIEW_CONFIG_VERSION || hasLiteralInFilter(source.filterTree)) return undefined
  const parsed = configShape.safeParse(source)
  if (!parsed.success) return undefined
  const repaired = repairSavedViewConfig(parsed.data, attributes)
  const overlay: UrlViewOverlay = {}
  if (source.columns !== undefined) overlay.columns = repaired.columns
  if (source.sorts !== undefined) overlay.sorts = repaired.sorts
  if (source.teamScope !== undefined && repaired.teamScope) overlay.teamScope = repaired.teamScope
  if (source.groupBy !== undefined) overlay.groupBy = repaired.groupBy
  if (source.rowHeight !== undefined) overlay.rowHeight = repaired.rowHeight
  if (source.gridLines !== undefined) overlay.gridLines = repaired.gridLines
  if (source.frozenRows !== undefined) overlay.frozenRows = repaired.frozenRows
  if (source.frozenCols !== undefined) overlay.frozenCols = repaired.frozenCols
  if (source.zoom !== undefined) overlay.zoom = repaired.zoom
  const filterTree = repairFilter(source.filterTree, new Set(activeAttributes(attributes).map((attribute) => attribute.id)), false)
  if (filterTree) overlay.filterTree = filterTree as UrlViewOverlay['filterTree']
  const layout = layoutSchema.safeParse(source.layout)
  if (layout.success) overlay.layout = layout.data
  return Object.keys(overlay).length ? overlay : undefined
}

export function applyUrlViewOverlay(config: SavedViewConfig, overlay: UrlViewOverlay | undefined): SavedViewConfig {
  if (!overlay) return config
  return {
    ...config,
    ...(overlay.columns ? { columns: overlay.columns } : {}),
    ...(overlay.sorts ? { sorts: overlay.sorts } : {}),
    ...(overlay.teamScope ? { teamScope: overlay.teamScope } : {}),
    ...(overlay.groupBy ? { groupBy: overlay.groupBy } : {}),
    ...(overlay.rowHeight ? { rowHeight: overlay.rowHeight } : {}),
    ...(overlay.gridLines !== undefined ? { gridLines: overlay.gridLines } : {}),
    ...(overlay.frozenRows !== undefined ? { frozenRows: overlay.frozenRows } : {}),
    ...(overlay.frozenCols !== undefined ? { frozenCols: overlay.frozenCols } : {}),
    ...(overlay.zoom !== undefined ? { zoom: overlay.zoom } : {}),
    ...(overlay.filterTree ? { filterTree: overlay.filterTree as ViewFilter } : {}),
  }
}
