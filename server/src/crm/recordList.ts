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
import { getObjectSurfaceCapabilities, type ObjectSurfaceCapabilitySubject } from './objectCapabilities.js'

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
export interface RecordListSurface {
  mode: 'table' | 'record'
  tableName: string
  jsonColumnName: 'customJson' | 'valuesJson'
}

/** The implementation registry the record-list compiler can actually query. */
export function getRecordListSurface(object: ObjectSurfaceCapabilitySubject): RecordListSurface | null {
  if (object.storage === 'record') {
    return { mode: 'record', tableName: 'Record', jsonColumnName: 'valuesJson' }
  }

  const tableName = TABLE_STORAGE_TABLES[object.slug]
  return tableName ? { mode: 'table', tableName, jsonColumnName: 'customJson' } : null
}

/** True only when the server advertises and can implement the list surface. */
export function isRecordListSupported(object: ObjectSurfaceCapabilitySubject): boolean {
  return getObjectSurfaceCapabilities(object).list && getRecordListSurface(object) !== null
}

// Grid creation is deliberately narrower than listing. Record-backed objects
// use the generic records route, while Person and Company have standalone
// create routes whose identity fields can be collected in a blank grid row.
// Deal creation requires a pipeline and stage picker, and Call rows originate
// from the calling flow, so neither gets a live-looking grid control.
const GRID_CREATE_TABLE_SLUGS = new Set(['person', 'company'])

export function isRecordGridCreateSupported(object: Pick<ObjectDef, 'slug' | 'storage'>): boolean {
  return isRecordListSupported(object) && (object.storage === 'record' || GRID_CREATE_TABLE_SLUGS.has(object.slug))
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
  /** A single sort remains supported for existing callers; new callers send priority-ordered specs. */
  sort?: SortSpec | SortSpec[] | null
  /** One or two field slugs whose full filtered result set is returned as grouped section descriptors. */
  groupBy?: string[] | null
  teamScope?: TeamScope
  cursor?: string | null
  limit?: number
}

export interface GroupDescriptor {
  /** A stable JSON-encoded path of raw grouping values, suitable for collapse state. */
  key: string
  /** The final grouping value in this section, or the explicit label for an empty value. */
  value: string
  count: number
  /** Exact decimal strings, keyed by number/currency attribute slug. */
  sum?: Record<string, string>
  /** Exact decimal strings, keyed by number/currency attribute slug. */
  avg?: Record<string, string>
  children?: GroupDescriptor[]
}

export interface ListResult {
  rows: Record<string, unknown>[]
  nextCursor: string | null
  totalCount: number
  /** Present only for a grouped request; aggregates are over the complete filtered set, not this page. */
  groups?: GroupDescriptor[]
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
const UNFILTERABLE_TYPES = new Set(['multiselect', 'record_reference', 'location', 'ai'])

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

// Grouping deliberately accepts scalar reference fields too. They are excluded
// from filtering and sorting until their comparison semantics are designed, but
// grouping a stored reference id is unambiguous and powers views such as People
// by Company and Companies by Parent company.
function resolveGroupField(ctx: FieldContext, field: string): CompiledField | null {
  const systemKind = SYSTEM_FIELDS[field]
  if (systemKind) {
    const sqlIdent = Prisma.raw(`"${field}"`)
    return { sqlIdent: systemKind === 'text' ? Prisma.sql`NULLIF(${sqlIdent}, '')` : sqlIdent, valueKind: systemKind }
  }
  const attr = ctx.attrsBySlug.get(field)
  if (!attr || attr.storage === 'list' || attr.isMulti || !SAFE_IDENTIFIER.test(attr.slug)) return null

  const valueKind = valueKindForType(attr.type)
  if (attr.storage === 'column') {
    const sqlIdent = Prisma.raw(`"${attr.slug}"`)
    return { sqlIdent: valueKind === 'text' ? Prisma.sql`NULLIF(${sqlIdent}, '')` : sqlIdent, valueKind }
  }
  const base = Prisma.raw(`"${ctx.jsonColumnName}"->>'${attr.slug}'`)
  const sqlIdent = castJsonText(base, valueKind)
  return { sqlIdent: valueKind === 'text' ? Prisma.sql`NULLIF(${sqlIdent}, '')` : sqlIdent, valueKind }
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
  values: unknown[]
  id: string
}

function decodeCursor(cursor: string, sortCount: number): DecodedCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new ListQueryError('Invalid cursor.')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { id?: unknown }).id !== 'string'
  ) {
    throw new ListQueryError('Invalid cursor.')
  }
  const source = parsed as { id: string; v?: unknown; values?: unknown }
  // v is the MAI-163 single-sort cursor shape. Keep it readable so an existing
  // one-level view can finish paging while the list endpoint grows sort[].
  const values = Array.isArray(source.values) ? source.values : 'v' in source ? [source.v] : null
  if (!values || values.length !== sortCount) throw new ListQueryError('Invalid cursor.')
  return { values, id: source.id }
}

function encodeCursor(values: unknown[], id: string): string {
  return Buffer.from(JSON.stringify({ values, id }), 'utf8').toString('base64url')
}

// Builds the lexicographic keyset predicate for "sorts strictly after this
// cursor row". Each level compares only after all earlier levels tie. NULLS
// LAST means a non-null cursor can advance into a null tail, while a null cursor
// can only advance through later priorities (or the id tiebreaker).
function cursorPredicate(sortFields: CompiledField[], sortSpecs: SortSpec[], decoded: DecodedCursor): Prisma.Sql {
  const equalParts: Prisma.Sql[] = []
  const afterParts: Prisma.Sql[] = []

  for (let index = 0; index < sortFields.length; index += 1) {
    const field = sortFields[index]
    const value = decoded.values[index]
    const prefix = equalParts.length ? Prisma.sql`${Prisma.join(equalParts, ' AND ')} AND ` : Prisma.empty

    if (value !== null) {
      const coerced = coerceScalar(field.valueKind, value)
      const cmp = sortSpecs[index].direction === 'asc' ? Prisma.sql`>` : Prisma.sql`<`
      afterParts.push(Prisma.sql`(${prefix}(${field.sqlIdent} ${cmp} ${coerced} OR ${field.sqlIdent} IS NULL))`)
      equalParts.push(Prisma.sql`${field.sqlIdent} IS NOT DISTINCT FROM ${coerced}`)
    } else {
      equalParts.push(Prisma.sql`${field.sqlIdent} IS NULL`)
    }
  }

  afterParts.push(Prisma.sql`(${Prisma.join(equalParts, ' AND ')} AND "id" > ${decoded.id})`)
  return Prisma.sql`(${Prisma.join(afterParts, ' OR ')})`
}

function buildSelectList(
  mode: 'table' | 'record',
  attributes: AttributeDef[],
  jsonColumnName: 'customJson' | 'valuesJson',
  sortFields: CompiledField[],
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
  for (const [index, sortField] of sortFields.entries()) {
    cols.push(Prisma.sql`${sortField.sqlIdent} AS ${Prisma.raw(`"__sortKey${index}"`)}`)
  }
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
      // JSON has no BigInt. Deal.amountMinor is one, and stringifying it keeps
      // exact minor units intact for the CRM grid and report drill-through.
      const value = row[attr.slug]
      out[attr.slug] = typeof value === 'bigint' ? value.toString() : value ?? null
    } else if (attr.storage === 'custom') {
      out[attr.slug] = json[attr.slug] ?? null
    }
    // storage === 'list' fields live on ListEntry, not in this row payload.
  }
  return out
}

function normaliseGroupValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  return String(value)
}

function normaliseAggregateValue(value: unknown): string {
  const text = String(value)
  return text.includes('.') ? text.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1') : text
}

function numericAggregateMap(row: Record<string, unknown>, prefix: '__sum' | '__avg', fields: string[]): Record<string, string> | undefined {
  const entries = fields.flatMap((field, index) => {
    const value = row[`${prefix}${index}`]
    return value === null || value === undefined ? [] : [[field, normaliseAggregateValue(value)] as const]
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

/**
 * Turns raw GROUPING SETS rows into the nested section contract. The SQL returns
 * one row for each requested level (parent before child), never the underlying
 * record rows; this function only arranges those descriptors for the grid.
 */
export function mapGroupRows(rows: Record<string, unknown>[], numericFields: string[]): GroupDescriptor[] {
  const roots: GroupDescriptor[] = []
  const descriptorsByKey = new Map<string, GroupDescriptor>()

  for (const row of rows) {
    const depth = Number(row.__groupDepth)
    const values = Array.from({ length: depth }, (_, index) => normaliseGroupValue(row[`__groupKey${index}`]))
    const key = JSON.stringify(values)
    const descriptor: GroupDescriptor = {
      key,
      value: values[values.length - 1] ?? '(No value)',
      count: Number(row.__groupCount ?? 0),
    }
    const sum = numericAggregateMap(row, '__sum', numericFields)
    const avg = numericAggregateMap(row, '__avg', numericFields)
    if (sum) descriptor.sum = sum
    if (avg) descriptor.avg = avg

    descriptorsByKey.set(key, descriptor)
    if (depth === 1) {
      roots.push(descriptor)
      continue
    }

    const parent = descriptorsByKey.get(JSON.stringify(values.slice(0, -1)))
    if (!parent) throw new Error('Grouped query returned a child before its parent.')
    ;(parent.children ??= []).push(descriptor)
  }

  return roots
}

function buildGroupedSectionsQuery(
  fromTable: Prisma.Sql,
  countWhereSql: Prisma.Sql,
  groupFields: CompiledField[],
  aggregateFields: CompiledField[],
): Prisma.Sql {
  const groupSelects = groupFields.map((field, index) =>
    Prisma.sql`${field.sqlIdent} AS ${Prisma.raw(`"__groupKey${index}"`)}`,
  )
  const aggregateSelects: Prisma.Sql[] = [Prisma.sql`COUNT(*)::text AS "__groupCount"`]
  for (const [index, field] of aggregateFields.entries()) {
    aggregateSelects.push(Prisma.sql`SUM(${field.sqlIdent})::text AS ${Prisma.raw(`"__sum${index}"`)}`)
    aggregateSelects.push(Prisma.sql`AVG(${field.sqlIdent})::text AS ${Prisma.raw(`"__avg${index}"`)}`)
  }

  if (groupFields.length === 1) {
    return Prisma.sql`
      SELECT ${Prisma.join([...groupSelects, Prisma.sql`1 AS "__groupDepth"`, ...aggregateSelects], ', ')}
      FROM ${fromTable}
      WHERE ${countWhereSql}
      GROUP BY ${groupFields[0].sqlIdent}
      ORDER BY ${groupFields[0].sqlIdent} ASC NULLS LAST
    `
  }

  const [first, second] = groupFields
  return Prisma.sql`
    SELECT ${Prisma.join([
      ...groupSelects,
      Prisma.sql`CASE WHEN GROUPING(${second.sqlIdent}) = 1 THEN 1 ELSE 2 END AS "__groupDepth"`,
      ...aggregateSelects,
    ], ', ')}
    FROM ${fromTable}
    WHERE ${countWhereSql}
    GROUP BY GROUPING SETS ((${first.sqlIdent}), (${first.sqlIdent}, ${second.sqlIdent}))
    ORDER BY ${first.sqlIdent} ASC NULLS LAST, GROUPING(${second.sqlIdent}) DESC, ${second.sqlIdent} ASC NULLS LAST
  `
}

export interface ListRecordsArgs {
  orgId: string
  object: Pick<ObjectDef, 'id' | 'slug' | 'storage'>
  attributes: AttributeDef[]
  query: ListQuery
}

export async function listRecords(prisma: PrismaClient, args: ListRecordsArgs): Promise<ListResult> {
  const { orgId, object, attributes, query } = args
  const capabilities = getObjectSurfaceCapabilities(object)
  const surface = getRecordListSurface(object)

  if (!capabilities.list || !surface) {
    throw new ListQueryError(`No list surface is available for object "${object.slug}" yet.`)
  }
  const { mode, tableName, jsonColumnName } = surface

  const attrsBySlug = new Map(attributes.map((a) => [a.slug, a]))
  const ctx: FieldContext = { attrsBySlug, jsonColumnName }

  const sortSpecs = query.sort === undefined || query.sort === null
    ? [DEFAULT_SORT]
    : Array.isArray(query.sort)
      ? query.sort
      : [query.sort]
  if (sortSpecs.length === 0) throw new ListQueryError('At least one sort is required.')
  const seenSortFields = new Set<string>()
  const sortFields = sortSpecs.map((sortSpec) => {
    if (seenSortFields.has(sortSpec.field)) throw new ListQueryError(`Sort field "${sortSpec.field}" appears more than once.`)
    seenSortFields.add(sortSpec.field)
    const sortField = resolveField(ctx, sortSpec.field)
    if (!sortField) throw new ListQueryError(`Unknown or unsortable field: "${sortSpec.field}".`)
    return sortField
  })

  const groupBy = query.groupBy ?? []
  if (groupBy.length > 2) throw new ListQueryError('At most two grouping fields are supported.')
  const seenGroupFields = new Set<string>()
  const groupFields = groupBy.map((field) => {
    if (seenGroupFields.has(field)) throw new ListQueryError(`Grouping field "${field}" appears more than once.`)
    seenGroupFields.add(field)
    const groupField = resolveGroupField(ctx, field)
    if (!groupField) throw new ListQueryError(`Unknown or ungroupable field: "${field}".`)
    return groupField
  })
  const numericAggregateAttributes = attributes.filter(
    (attribute) => !attribute.isMulti && attribute.storage !== 'list' && (attribute.type === 'number' || attribute.type === 'currency'),
  )
  const numericAggregateFields = numericAggregateAttributes.map((attribute) => {
    const field = resolveField(ctx, attribute.slug)
    if (!field) throw new ListQueryError(`Numeric field "${attribute.slug}" cannot be aggregated.`)
    return field
  })

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
    whereParts.push(cursorPredicate(sortFields, sortSpecs, decodeCursor(query.cursor, sortSpecs.length)))
  }
  const rowsWhereSql = Prisma.join(whereParts, ' AND ')

  const orderBy = Prisma.join(sortFields.map((sortField, index) => {
    const direction = sortSpecs[index].direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`
    return Prisma.sql`${sortField.sqlIdent} ${direction} NULLS LAST`
  }), ', ')
  const selectCols = buildSelectList(mode, attributes, jsonColumnName, sortFields)
  const fromTable = Prisma.raw(`"${tableName}"`)

  const rowsQuery = Prisma.sql`
    SELECT ${selectCols}
    FROM ${fromTable}
    WHERE ${rowsWhereSql}
    ORDER BY ${orderBy}, "id" ASC
    LIMIT ${limit + 1}
  `
  const countQuery = Prisma.sql`
    SELECT COUNT(*)::text AS count
    FROM ${fromTable}
    WHERE ${countWhereSql}
  `

  const groupQuery = groupFields.length
    ? buildGroupedSectionsQuery(fromTable, countWhereSql, groupFields, numericAggregateFields)
    : null

  const [rawRows, countRows, groupRows] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>(rowsQuery),
    prisma.$queryRaw<{ count: string }[]>(countQuery),
    groupQuery ? prisma.$queryRaw<Record<string, unknown>[]>(groupQuery) : Promise.resolve(null),
  ])

  const hasMore = rawRows.length > limit
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && lastRow
    ? encodeCursor(sortFields.map((_, index) => lastRow[`__sortKey${index}`]), String(lastRow.id))
    : null

  return {
    rows: pageRows.map((row) => mapRow(mode, attributes, jsonColumnName, row)),
    nextCursor,
    totalCount: Number(countRows[0]?.count ?? 0),
    ...(groupRows ? { groups: mapGroupRows(groupRows, numericAggregateAttributes.map((attribute) => attribute.slug)) } : {}),
  }
}
