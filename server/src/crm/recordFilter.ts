/**
 * The GIN-indexed filter for custom-object records (MAI-135 T7, spec §5.1).
 *
 * Record.valuesJson carries a native GIN index built with jsonb_path_ops (see the
 * schema and the migration). That operator class accelerates ONE operator:
 * containment, `@>`. Prisma's own JSON path filters compile to `->>` comparisons,
 * which that index cannot serve — so the filter is written as a parameterized raw
 * containment query here, and every caller (the route and the integration test)
 * goes through this one function so they all exercise the same indexed path.
 *
 * `match` is a plain { attributeSlug: value } object; a row matches when its
 * valuesJson CONTAINS all of those pairs. orgId and objectId are always applied so
 * the tenant boundary and the object scope hold even on the raw path.
 */
import { Prisma } from '../generated/prisma/client.js'
import type { PrismaClient } from '../generated/prisma/client.js'

// Either the process client or an interactive-transaction client can run this.
type RawClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient

// The row shape the raw query returns — the Record columns, quoted so their
// camelCase names survive Postgres folding.
export interface RecordRow {
  id: string
  orgId: string
  objectId: string
  valuesJson: Prisma.JsonValue
  isArchived: boolean
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface FilterArgs {
  orgId: string
  objectId: string
  // { slug: value } — a row matches when valuesJson @> this object.
  match: Record<string, unknown>
  limit?: number
  includeArchived?: boolean
}

export async function filterRecordsByContainment(
  client: RawClient,
  { orgId, objectId, match, limit = 200, includeArchived = false }: FilterArgs,
): Promise<RecordRow[]> {
  // The containment value is bound as one jsonb parameter, never string-built, so
  // there is no SQL injection surface even though this is a raw query.
  const matchJson = JSON.stringify(match)

  const rows = await client.$queryRaw<RecordRow[]>(Prisma.sql`
    SELECT "id", "orgId", "objectId", "valuesJson", "isArchived",
           "deletedAt", "createdAt", "updatedAt"
    FROM "Record"
    WHERE "orgId" = ${orgId}
      AND "objectId" = ${objectId}
      AND "deletedAt" IS NULL
      ${includeArchived ? Prisma.empty : Prisma.sql`AND "isArchived" = FALSE`}
      AND "valuesJson" @> ${matchJson}::jsonb
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `)

  return rows
}
