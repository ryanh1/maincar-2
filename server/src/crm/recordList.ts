/**
 * The generic list endpoint's data plane (MAI-163, plan T0.1; spec CHUNK-1 §A):
 * server-side sort/filter/count over an ObjectDef's rows, windowed by a keyset
 * cursor. Works over both storage kinds through ONE compiler so the grid never
 * cares which one it's looking at:
 *   - "table"  — a real Postgres table (Person/Company/Deal/Call) with typed
 *                 columns for "column" attributes plus a customJson bag.
 *   - "record" — the generic Record table; every attribute lives in valuesJson.
 *
 * Filtering compiles a filter tree (AND/OR groups of { field, operator, value })
 * straight to parameterized SQL rather than going through Prisma's typed
 * where-builder, because the set of fields is only known at request time — it's
 * read from AttributeDef rows, not from the Prisma schema (spec CHUNK-1 §A:
 * "compiles to parameterized SQL over typed columns + customJson").
 *
 * Pagination is keyset (cursor), not OFFSET: ORDER BY the sort field (NULLS LAST)
 * with "id" as a stable tiebreaker, so a 50k-row object pages in ~150-row chunks
 * without re-scanning everything already seen, and a sort change simply starts a
 * fresh cursor rather than reloading anything.
 */
import { Prisma } from '../generated/prisma/client.js'
import type { PrismaClient, ObjectDef, AttributeDef } from '../generated/prisma/client.js'
import { InvalidTeamScopeError, resolveOwnerTeamScope, type TeamScope } from '../lib/teamScope.js'

// storage="table" ObjectDefs whose real Postgres table this endpoint knows how to
// query. Every standard object that has landed a table (standardObjects.ts) goes
// here. An object not in this map (storage="table" but no table yet, e.g. email/sms
// before Phase 3/4) is a server misconfiguration, not a caller error.
//
// Keep the raw-SQL fields beside the table mapping. The static Prisma contract and
// migrated-Postgres contract tests consume this same definition, so deleting or
// renaming a required list field cannot leave this compiler pointing at a phantom
// column.
const RAW_LIST_REQUIRED_COLUMNS = [
  { name: 'id', prismaType: 'String' },
  { name: 'orgId', prismaType: 'String' },
  { name: 'customJson', prismaType: 'Json' },
  { name: 'deletedAt', prismaType: 'DateTime' },
  { name: 'createdAt', prismaType: 'DateTime' },
  { name: 'updatedAt', prismaType: 'DateTime' },
] as const

export const TABLE_STORAGE_LIST_CONTRACT = {
  person: {
    tableName: 'Person',
    requiredColumns: RAW_LIST_REQUIRED_COLUMNS,
  },
  company: {
    tableName: 'Company',
    requiredColumns: RAW_LIST_REQUIRED_COLUMNS,
  },
  deal: {
    tableName: 'Deal',
    requiredColumns: RAW_LIST_REQUIRED_COLUMNS,
  },
  call: {
    tableName: 'Call',
    requiredColumns: RAW_LIST_REQUIRED_COLUMNS,
  },
} as const

export const TABLE_STORAGE_TABLES: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE_STORAGE_LIST_CONTRACT).map(([objectSlug, { tableName }]) => [objectSlug, tableName]),
)

// This is the one capability policy for generic record-list surfaces. Table-backed
// objects are supported only after their table is registered above; generic-record
// objects are supported by the Record table. Routes expose this result so a client
// never needs a second, stale allow-list to decide what it can navigate to.
export function isRecordListSupported(object: Pick<ObjectDef, 'slug' | 'storage'>): boolean {
  return object.storage === 'record' || object.slug in TABLE_STORAGE_TABLES
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'

export interface FilterCondition {
  type: 'condition'
  field: string // an AttributeDef slug, or a system field: id | createdAt | updatedAt
  operator: FilterOperator
  value?: unknown
}

export interface FilterGroup {
  type: 'group'
  op: 'and' | 'or'
  children: FilterNode[]
}

export type FilterNode = FilterCondition | FilterGroup

export interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
}

export interface ListQuery {
  filter?: FilterNode | null
  sort?: SortSpec | null
  teamScope?: TeamScope
  cursor?: string | null
  limit?: number
}

export interface ListResult {
  rows: Record<string, unknown>[]
  nextCursor: string | null
  totalCount: number
}

const DEFAULT_LIMIT = 150
const MIN_LIMIT = 50
const MAX_LIMIT = 500

const DEFAULT_SORT: SortSpec = { field: 'createdAt', direction: 'desc' }

// AttributeDef.slug is already constrained to this shape at creation time
// (objects.ts SLUG_ERROR / the attribute editor). Re-checked here as
// defense-in-depth before a slug is interpolated as a bare SQL identifier.
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// Field types this endpoint does not yet filter/sort on: their values are JSON
// arrays or nested objects, and a raw text comparison over their serialized form
// would silently return wrong matches rather than a clear error. They still come
// back in row data — just not as a filter/sort target — until the query semantics
// for them are designed (spec CHUNK-1 §A only scopes typed-column + customJson
// scalar filtering).
const UNFILTERABLE_TYPES = new Set(['multiselect', 'record_reference', 'user_reference', 'location', 'ai'])

type ValueKind = 'text' | 'number' | 'boolean' | 'date' | 'timestamp'

const OPERATORS_BY_KIND: Record<ValueKind, ReadonlySet<FilterOperator>> = {
  text: new Set(['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'in']),
  number: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty', 'in']),
  boolean: new Set(['eq', 'is_empty', 'is_not_empty']),
  date: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']),
  timestamp: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']),
}

export class ListQueryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function valueKindForType(type: string): ValueKind {
  switch (type) {
    case 'number':
    case 'currency':
    case 'rating':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamp'
    default:
      // text, email, url, domain, phone, select, status, person_name
      return 'text'
  }
}

interface CompiledField {
  sqlIdent: Prisma.Sql
  valueKind: ValueKind
}

interface FieldContext {
  attrsBySlug: Map<string, AttributeDef>
  jsonColumnName: 'customJson' | 'valuesJson'
}

const SYSTEM_FIELDS: Record<string, ValueKind> = {
  id: 'text',
  createdAt: 'timestamp',
  updatedAt: 'timestamp',
}

function castJsonText(base: Prisma.Sql, kind: ValueKind): Prisma.Sql {
  switch (kind) {
    case 'number':
      return Prisma.sql`(${base})::numeric`
    case 'boolean':
      return Prisma.sql`(${base})::boolean`
    case 'date':
      return Prisma.sql`(${base})::date`
    case 'timestamp':
      return Prisma.sql`(${base})::timestamptz`
    default:
      return base
  }
}

function resolveField(ctx: FieldContext, field: string): CompiledField | null {
  const systemKind = SYSTEM_FIELDS[field]
  if (systemKind) {
    return { sqlIdent: Prisma.raw(`"${field}"`), valueKind: systemKind }
  }
  const attr = ctx.attrsBySlug.get(field)
  if (!attr) return null
  if (attr.storage === 'list') return null // ListEntry-scoped; not in this row payload
  if (attr.isMulti || UNFILTERABLE_TYPES.has(attr.type)) return null
  if (!SAFE_IDENTIFIER.test(attr.slug)) return null

  const valueKind = valueKindForType(attr.type)
  if (attr.storage === 'column') {
    return { sqlIdent: Prisma.raw(`"${attr.slug}"`), valueKind }
  }
  const base = Prisma.raw(`"${ctx.jsonColumnName}"->>'${attr.slug}'`)
  return { sqlIdent: castJsonText(base, valueKind), valueKind }
}

// Escapes ILIKE wildcard characters in a user-supplied substring so `%`/`_` in the
// value are matched literally, not as SQL wildcards.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function coerceScalar(kind: ValueKind, value: unknown): unknown {
  switch (kind) {
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new ListQueryError(`Expected a number, got ${JSON.stringify(value)}.`)
      return n
    }
    case 'boolean':
      return value === true || value === 'true'
    case 'date':
    case 'timestamp': {
      const d = value instanceof Date ? value : new Date(String(value))
      if (Number.isNaN(d.getTime())) throw new ListQueryError(`Expected a date, got ${JSON.stringify(value)}.`)
      return d
    }
    default:
      return String(value)
  }
}

function compileCondition(field: CompiledField, operator: FilterOperator, rawValue: unknown): Prisma.Sql {
  const col = field.sqlIdent
  const isEmptyExpr =
    field.valueKind === 'text' ? Prisma.sql`(${col} IS NULL OR ${col} = '')` : Prisma.sql`${col} IS NULL`
  const isNotEmptyExpr =
    field.valueKind === 'text' ? Prisma.sql`(${col} IS NOT NULL AND ${col} <> '')` : Prisma.sql`${col} IS NOT NULL`

  switch (operator) {
    case 'is_empty':
      return isEmptyExpr
    case 'is_not_empty':
      return isNotEmptyExpr
    case 'eq':
      return Prisma.sql`${col} = ${coerceScalar(field.valueKind, rawValue)}`
    case 'neq':
      return Prisma.sql`${col} <> ${coerceScalar(field.valueKind, rawValue)}`
    case 'gt':
      return Prisma.sql`${col} > ${coerceScalar(field.valueKind, rawValue)}`
    case 'gte':
      return Prisma.sql`${col} >= ${coerceScalar(field.valueKind, rawValue)}`
    case 'lt':
      return Prisma.sql`${col} < ${coerceScalar(field.valueKind, rawValue)}`
    case 'lte':
      return Prisma.sql`${col} <= ${coerceScalar(field.valueKind, rawValue)}`
    case 'contains':
      return Prisma.sql`${col} ILIKE ${'%' + escapeLike(String(rawValue)) + '%'}`
    case 'not_contains':
      return Prisma.sql`(${col} IS NULL OR ${col} NOT ILIKE ${'%' + escapeLike(String(rawValue)) + '%'})`
    case 'starts_with':
      return Prisma.sql`${col} ILIKE ${escapeLike(String(rawValue)) + '%'}`
    case 'ends_with':
      return Prisma.sql`${col} ILIKE ${'%' + escapeLike(String(rawValue))}`
    case 'in': {
      if (!Array.isArray(rawValue) || rawValue.length === 0) {
        throw new ListQueryError('The "in" operator needs a non-empty array value.')
      }
      const values = rawValue.map((v) => coerceScalar(field.valueKind, v))
      return Prisma.sql`${col} IN (${Prisma.join(values)})`
    }
    default: {
      const _exhaustive: never = operator
      throw new ListQueryError(`Unsupported operator: ${String(_exhaustive)}`)
    }
  }
}

function compileFilterNode(node: FilterNode, ctx: FieldContext): Prisma.Sql {
  if (node.type === 'group') {
    if (!Array.isArray(node.children) || node.children.length === 0) return Prisma.sql`TRUE`
    const parts = node.children.map((child) => compileFilterNode(child, ctx))
    const joiner = node.op === 'or' ? ' OR ' : ' AND '
    return Prisma.sql`(${Prisma.join(parts, joiner)})`
  }

  const field = resolveField(ctx, node.field)
  if (!field) throw new ListQueryError(`Unknown or unfilterable field: "${node.field}".`)
  if (!OPERATORS_BY_KIND[field.valueKind].has(node.operator)) {
    throw new ListQueryError(`Operator "${node.operator}" is not supported on field "${node.field}".`)
  }
  return compileCondition(field, node.operator, node.value)
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)))
}

interface DecodedCursor {
  v: unknown
  id: string
}

function decodeCursor(cursor: string): DecodedCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new ListQueryError('Invalid cursor.')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { id?: unknown }).id !== 'string' ||
    !('v' in (parsed as object))
  ) {
    throw new ListQueryError('Invalid cursor.')
  }
  return parsed as DecodedCursor
}

function encodeCursor(v: unknown, id: string): string {
  return Buffer.from(JSON.stringify({ v, id }), 'utf8').toString('base64url')
}

// Builds the keyset predicate for "sorts strictly after this cursor row", given
// ORDER BY <sortField> <direction> NULLS LAST, "id" ASC. NULLS LAST puts every null
// row after every non-null row regardless of direction, so the predicate branches
// on whether the cursor itself sits in the null tail.
function cursorPredicate(sortField: CompiledField, direction: 'asc' | 'desc', decoded: DecodedCursor): Prisma.Sql {
  const col = sortField.sqlIdent
  if (decoded.v === null) {
    return Prisma.sql`(${col} IS NULL AND "id" > ${decoded.id})`
  }
  const val = coerceScalar(sortField.valueKind, decoded.v)
  const cmp = direction === 'asc' ? Prisma.sql`>` : Prisma.sql`<`
  return Prisma.sql`((${col} ${cmp} ${val}) OR (${col} = ${val} AND "id" > ${decoded.id}) OR (${col} IS NULL))`
}

function buildSelectList(
  mode: 'table' | 'record',
  attributes: AttributeDef[],
  jsonColumnName: 'customJson' | 'valuesJson',
  sortField: CompiledField,
): Prisma.Sql {
  const cols: Prisma.Sql[] = [Prisma.raw('"id"'), Prisma.raw('"createdAt"'), Prisma.raw('"updatedAt"')]
  if (mode === 'table') {
    for (const attr of attributes) {
      if (attr.storage === 'column' && SAFE_IDENTIFIER.test(attr.slug)) {
        cols.push(Prisma.raw(`"${attr.slug}"`))
      }
    }
  }
  cols.push(Prisma.raw(`"${jsonColumnName}"`))
  cols.push(Prisma.sql`${sortField.sqlIdent} AS "__sortKey"`)
  return Prisma.join(cols, ', ')
}

function mapRow(
  mode: 'table' | 'record',
  attributes: AttributeDef[],
  jsonColumnName: 'customJson' | 'valuesJson',
  row: Record<string, unknown>,
): Record<string, unknown> {
  const json = (row[jsonColumnName] ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  for (const attr of attributes) {
    if (attr.storage === 'column' && mode === 'table') {
      out[attr.slug] = row[attr.slug] ?? null
    } else if (attr.storage === 'custom') {
      out[attr.slug] = json[attr.slug] ?? null
    }
    // storage === 'list' fields live on ListEntry, not in this row payload.
  }
  return out
}

export interface ListRecordsArgs {
  orgId: string
  object: Pick<ObjectDef, 'id' | 'slug' | 'storage'>
  attributes: AttributeDef[]
  query: ListQuery
}

export async function listRecords(prisma: PrismaClient, args: ListRecordsArgs): Promise<ListResult> {
  const { orgId, object, attributes, query } = args
  const mode: 'table' | 'record' = object.storage === 'table' ? 'table' : 'record'

  if (!isRecordListSupported(object)) {
    throw new ListQueryError(`No list surface is available for object "${object.slug}" yet.`)
  }
  const tableName = mode === 'table' ? TABLE_STORAGE_TABLES[object.slug]! : 'Record'
  const jsonColumnName: 'customJson' | 'valuesJson' = mode === 'table' ? 'customJson' : 'valuesJson'

  const attrsBySlug = new Map(attributes.map((a) => [a.slug, a]))
  const ctx: FieldContext = { attrsBySlug, jsonColumnName }

  const sortSpec = query.sort ?? DEFAULT_SORT
  const sortField = resolveField(ctx, sortSpec.field)
  if (!sortField) throw new ListQueryError(`Unknown or unsortable field: "${sortSpec.field}".`)

  const limit = clampLimit(query.limit)

  const whereParts: Prisma.Sql[] = [Prisma.sql`"orgId" = ${orgId}`, Prisma.sql`"deletedAt" IS NULL`]
  if (mode === 'record') whereParts.push(Prisma.sql`"objectId" = ${object.id}`)
  if (query.filter) whereParts.push(compileFilterNode(query.filter, ctx))
  if (query.teamScope) {
    const ownerAttribute = attributes.find(
      (attribute) => attribute.slug === 'ownerUserId' && attribute.storage === 'column' && attribute.type === 'user_reference',
    )
    if (mode !== 'table' || !ownerAttribute) {
      throw new ListQueryError('Team filtering is available only for objects with an owner field.')
    }
    try {
      const scope = await resolveOwnerTeamScope(prisma, orgId, query.teamScope)
      const ownerUserIds = scope?.ownerUserId.in ?? []
      whereParts.push(ownerUserIds.length ? Prisma.sql`"ownerUserId" IN (${Prisma.join(ownerUserIds)})` : Prisma.sql`FALSE`)
    } catch (error) {
      if (error instanceof InvalidTeamScopeError) throw new ListQueryError(error.message, error.status)
      throw error
    }
  }

  const countWhereSql = Prisma.join(whereParts, ' AND ')

  if (query.cursor) {
    whereParts.push(cursorPredicate(sortField, sortSpec.direction, decodeCursor(query.cursor)))
  }
  const rowsWhereSql = Prisma.join(whereParts, ' AND ')

  const orderDir = sortSpec.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`
  const selectCols = buildSelectList(mode, attributes, jsonColumnName, sortField)
  const fromTable = Prisma.raw(`"${tableName}"`)

  const rowsQuery = Prisma.sql`
    SELECT ${selectCols}
    FROM ${fromTable}
    WHERE ${rowsWhereSql}
    ORDER BY ${sortField.sqlIdent} ${orderDir} NULLS LAST, "id" ASC
    LIMIT ${limit + 1}
  `
  const countQuery = Prisma.sql`
    SELECT COUNT(*)::text AS count
    FROM ${fromTable}
    WHERE ${countWhereSql}
  `

  const [rawRows, countRows] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(rowsQuery),
    prisma.$queryRaw<{ count: string }[]>(countQuery),
  ])

  const hasMore = rawRows.length > limit
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.__sortKey, String(lastRow.id)) : null

  return {
    rows: pageRows.map((row) => mapRow(mode, attributes, jsonColumnName, row)),
    nextCursor,
    totalCount: Number(countRows[0]?.count ?? 0),
  }
}
