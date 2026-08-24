/**
 * Atomic migrations for AttributeDef values across column, custom JSON, record
 * JSON, and list-entry JSON storage. Routes own authorization and response
 * semantics; this module owns locating and rewriting the persisted values.
 */
import { Prisma } from '../generated/prisma/client.js'
import type { AttributeDef } from '../generated/prisma/client.js'
import { TABLE_STORAGE_TABLES } from './recordList.js'

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

interface AttributeValueLocation {
  tableName: string
  kind: 'column' | 'json'
  columnName?: string
  jsonColumn?: string
  objectId?: string
  objectSlug?: string
  hasDeletedAt: boolean
}

export interface MultiValueRow {
  recordId: string
  value: unknown
}

function resolveAttributeValueLocation(
  object: { id: string; slug: string; storage: string },
  attribute: { slug: string; storage: string },
): AttributeValueLocation | null {
  if (!SAFE_IDENTIFIER.test(attribute.slug)) return null
  if (attribute.storage === 'column') {
    const tableName = TABLE_STORAGE_TABLES[object.slug]
    if (!tableName) return null
    return { tableName, kind: 'column', columnName: attribute.slug, hasDeletedAt: true }
  }
  if (attribute.storage === 'list') {
    return { tableName: 'ListEntry', kind: 'json', jsonColumn: 'valuesJson', objectSlug: object.slug, hasDeletedAt: false }
  }
  const isRecord = object.storage === 'record'
  const tableName = isRecord ? 'Record' : TABLE_STORAGE_TABLES[object.slug]
  if (!tableName) return null
  return {
    tableName,
    kind: 'json',
    jsonColumn: isRecord ? 'valuesJson' : 'customJson',
    ...(isRecord ? { objectId: object.id } : {}),
    hasDeletedAt: true,
  }
}

function jsonLocationFilters(location: AttributeValueLocation): {
  objectFilter: Prisma.Sql
  deletedAtFilter: Prisma.Sql
} {
  const objectFilter = location.objectId
    ? Prisma.sql`AND "objectId" = ${location.objectId}`
    : location.objectSlug
      ? Prisma.sql`AND "objectSlug" = ${location.objectSlug}`
      : Prisma.empty
  const deletedAtFilter = location.hasDeletedAt ? Prisma.sql`AND "deletedAt" IS NULL` : Prisma.empty
  return { objectFilter, deletedAtFilter }
}

// Lock every live row whose stored value is an array. The attribute PATCH uses
// this snapshot both to count risky (>1) rows and to perform the conversion.
export async function lockMultiValueRows(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string }
  },
): Promise<MultiValueRow[]> {
  const location = resolveAttributeValueLocation(args.object, args.attribute)
  if (!location || location.kind === 'column') return []
  const { objectFilter, deletedAtFilter } = jsonLocationFilters(location)
  return client.$queryRaw<MultiValueRow[]>`
    SELECT "id" AS "recordId", ${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug} AS value
    FROM ${Prisma.raw(`"${location.tableName}"`)}
    WHERE "orgId" = ${args.orgId}
      ${objectFilter}
      AND jsonb_typeof(${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug}) = 'array'
      ${deletedAtFilter}
    FOR UPDATE
  `
}

// Convert arrays to their ordered first item and remove defensive legacy empty
// arrays. The route archives the returned snapshot before its transaction commits.
export async function collapseMultiValueRows(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string }
  },
): Promise<number> {
  const location = resolveAttributeValueLocation(args.object, args.attribute)
  if (!location || location.kind === 'column') return 0
  const { objectFilter, deletedAtFilter } = jsonLocationFilters(location)
  return client.$executeRaw`
    UPDATE ${Prisma.raw(`"${location.tableName}"`)}
    SET ${Prisma.raw(`"${location.jsonColumn!}"`)} = CASE
      WHEN jsonb_array_length(${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug}) = 0
        THEN ${Prisma.raw(`"${location.jsonColumn!}"`)} - ${args.attribute.slug}
      ELSE jsonb_set(
        ${Prisma.raw(`"${location.jsonColumn!}"`)},
        ARRAY[${args.attribute.slug}],
        ${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug} -> 0
      )
    END
    WHERE "orgId" = ${args.orgId}
      ${objectFilter}
      AND jsonb_typeof(${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug}) = 'array'
      ${deletedAtFilter}
  `
}

export async function archiveCollapsedMultiValues(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    userId: string
    object: { slug: string; storage: string }
    attribute: AttributeDef
    rows: MultiValueRow[]
  },
): Promise<void> {
  const changedRows = args.rows.filter((row): row is MultiValueRow & { value: unknown[] } => Array.isArray(row.value))
  if (changedRows.length === 0) return

  await client.fieldHistory.createMany({
    data: changedRows.map((row) => ({
      orgId: args.orgId,
      objectSlug: args.object.slug,
      recordId: row.recordId,
      attribute: args.attribute.slug,
      oldJson: row.value as Prisma.InputJsonValue,
      newJson: row.value[0] === undefined ? Prisma.DbNull : row.value[0] as Prisma.InputJsonValue,
      changedByUserId: args.userId,
      changeSource: 'user',
      reason: 'Field changed from multiple values to single; prior ordered values archived.',
    })),
  })

  // RecordLink is a derived index for record-backed references. Rewrite affected
  // rows in bulk to the retained primary so reverse-reference reads stay aligned.
  if (args.object.storage === 'record' && args.attribute.type === 'record_reference') {
    await client.recordLink.deleteMany({
      where: {
        orgId: args.orgId,
        fromObject: 'record',
        fromId: { in: changedRows.map((row) => row.recordId) },
        attribute: args.attribute.slug,
      },
    })
    const primaryRows = changedRows.filter(
      (row): row is MultiValueRow & { value: [string, ...unknown[]] } => typeof row.value[0] === 'string',
    )
    if (primaryRows.length > 0) {
      const target = args.attribute.refObjectId
        ? await client.objectDef.findFirst({
            where: { id: args.attribute.refObjectId, orgId: args.orgId, deletedAt: null },
            select: { slug: true },
          })
        : null
      await client.recordLink.createMany({
        data: primaryRows.map((row) => ({
          orgId: args.orgId,
          fromObject: 'record',
          fromId: row.recordId,
          attribute: args.attribute.slug,
          toObject: target?.slug ?? 'unknown',
          toId: row.value[0],
        })),
      })
    }
  }
}

export async function countOptionValue(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string; isMulti?: boolean }
    value: string
  },
): Promise<number> {
  const location = resolveAttributeValueLocation(args.object, args.attribute)
  if (!location) return 0
  const { orgId, value } = args

  if (location.kind === 'column') {
    const rows = await client.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM ${Prisma.raw(`"${location.tableName}"`)}
      WHERE "orgId" = ${orgId}
        AND ${Prisma.raw(`"${location.columnName!}"`)} = ${value}
        AND "deletedAt" IS NULL
    `
    return Number(rows[0]?.count ?? 0)
  }

  const { objectFilter, deletedAtFilter } = jsonLocationFilters(location)
  const valueFilter = args.attribute.isMulti
    ? Prisma.sql`${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug} ? ${value}`
    : Prisma.sql`${Prisma.raw(`"${location.jsonColumn!}"`)} ->> ${args.attribute.slug} = ${value}`
  const rows = await client.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
    FROM ${Prisma.raw(`"${location.tableName}"`)}
    WHERE "orgId" = ${orgId}
      ${objectFilter}
      AND ${valueFilter}
      ${deletedAtFilter}
  `
  return Number(rows[0]?.count ?? 0)
}

export async function migrateOptionValue(
  client: Prisma.TransactionClient,
  args: {
    orgId: string
    object: { id: string; slug: string; storage: string }
    attribute: { slug: string; storage: string; isMulti?: boolean }
    oldValue: string
    newValue: string
  },
): Promise<number> {
  const location = resolveAttributeValueLocation(args.object, args.attribute)
  if (!location) return 0
  const { orgId, oldValue, newValue } = args

  if (location.kind === 'column') {
    return client.$executeRaw`
      UPDATE ${Prisma.raw(`"${location.tableName}"`)}
      SET ${Prisma.raw(`"${location.columnName!}"`)} = ${newValue}
      WHERE "orgId" = ${orgId}
        AND ${Prisma.raw(`"${location.columnName!}"`)} = ${oldValue}
        AND "deletedAt" IS NULL
    `
  }

  const { objectFilter, deletedAtFilter } = jsonLocationFilters(location)
  if (args.attribute.isMulti) {
    return client.$executeRaw`
      UPDATE ${Prisma.raw(`"${location.tableName}"`)}
      SET ${Prisma.raw(`"${location.jsonColumn!}"`)} = jsonb_set(
        ${Prisma.raw(`"${location.jsonColumn!}"`)},
        ARRAY[${args.attribute.slug}],
        (
          SELECT jsonb_agg(
            CASE WHEN option_value = to_jsonb(${oldValue}::text) THEN to_jsonb(${newValue}::text) ELSE option_value END
          )
          FROM jsonb_array_elements(${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug}) AS option_values(option_value)
        )
      )
      WHERE "orgId" = ${orgId}
        ${objectFilter}
        AND ${Prisma.raw(`"${location.jsonColumn!}"`)} -> ${args.attribute.slug} ? ${oldValue}
        ${deletedAtFilter}
    `
  }

  return client.$executeRaw`
    UPDATE ${Prisma.raw(`"${location.tableName}"`)}
    SET ${Prisma.raw(`"${location.jsonColumn!}"`)} = jsonb_set(
      ${Prisma.raw(`"${location.jsonColumn!}"`)},
      ARRAY[${args.attribute.slug}],
      to_jsonb(${newValue}::text)
    )
    WHERE "orgId" = ${orgId}
      ${objectFilter}
      AND ${Prisma.raw(`"${location.jsonColumn!}"`)} ->> ${args.attribute.slug} = ${oldValue}
      ${deletedAtFilter}
  `
}
