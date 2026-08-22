import { Prisma } from '../generated/prisma/client.js'

import { DEAL_FIELD_REGISTRY } from './fieldRegistry.js'

export interface ReportConfig {
  baseObject: 'deal'
  rows: [{ field: 'stage' }]
  values: [{ field: 'amountMinor'; aggregation: 'sum' }]
  timeZone: ReportTimeZone
  timeBucket?: { field: 'createdAt'; grain: 'day' }
}

export type ReportTimeZone =
  | { mode: 'pinned'; displayZone: string }
  | { mode: 'viewer' }
  | { mode: 'subject'; subjectUserId: string }

export interface ReportExecutionContext {
  viewerTimeZone?: string | null
  subjectTimeZone?: string | null
}

export const DEAL_STAGE_AMOUNT_REPORT: ReportConfig = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  // The first report has no date bucket, but every saved report must still
  // declare an explicit zone before a later config adds one.
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

export class InvalidReportConfigError extends Error {
  status = 400
}

function requireIanaTimeZone(timeZone: string | null | undefined, message: string): string {
  const zone = timeZone?.trim()
  if (!zone) throw new InvalidReportConfigError(message)

  // Intl accepts aliases such as EST. Require an IANA region/name pair (or UTC)
  // and reject Etc/GMT's numeric offsets so a fixed offset cannot silently
  // mis-bucket a DST transition. Intl remains the runtime validity check because
  // its canonical-zone list varies with the ICU version bundled with Node.
  if (zone !== 'UTC' && (!zone.includes('/') || /^Etc\/GMT(?:[+-]\d+)?$/i.test(zone))) {
    throw new InvalidReportConfigError('Report time zones must be valid IANA time zones.')
  }

  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    throw new InvalidReportConfigError('Report time zones must be valid IANA time zones.')
  }

  return zone
}

/** Resolves the report's declared zone from trusted execution context. */
export function resolveReportTimeZone(
  timeZone: ReportTimeZone,
  context: ReportExecutionContext,
): string {
  if (timeZone.mode === 'pinned') {
    return requireIanaTimeZone(timeZone.displayZone, 'A pinned time zone is required for this report.')
  }
  if (timeZone.mode === 'viewer') {
    return requireIanaTimeZone(context.viewerTimeZone, 'A viewer time zone is required for this report.')
  }
  if (timeZone.mode === 'subject') {
    return requireIanaTimeZone(context.subjectTimeZone, 'A subject time zone is required for this report.')
  }
  throw new InvalidReportConfigError('Report time zone mode must be pinned, viewer, or subject.')
}

/**
 * Compiles MAI-143's initial structured config into a parameterized query.
 * SQL identifiers come only from DEAL_FIELD_REGISTRY. Org and timezone values
 * are bound parameters supplied from authenticated server context, not config.
 */
export function compileReport(
  config: ReportConfig,
  orgId: string,
  context: ReportExecutionContext = {},
): Prisma.Sql {
  const dimension = DEAL_FIELD_REGISTRY.dimensions.stage
  const measure = DEAL_FIELD_REGISTRY.measures.amountMinor

  if (
    config.baseObject !== 'deal' ||
    config.rows.length !== 1 ||
    config.rows[0]?.field !== dimension.field ||
    config.values.length !== 1 ||
    config.values[0]?.field !== measure.field ||
    config.values[0]?.aggregation !== measure.aggregation
  ) {
    throw new InvalidReportConfigError('Only Deals grouped by Stage with summed amountMinor is available yet.')
  }

  const timeZone = resolveReportTimeZone(config.timeZone, context)
  if (config.timeBucket && (config.timeBucket.field !== 'createdAt' || config.timeBucket.grain !== 'day')) {
    throw new InvalidReportConfigError('Only Deal created-at day buckets are available yet.')
  }

  if (config.timeBucket) {
    return Prisma.sql([
      // Prisma maps DateTime to `timestamp without time zone`; it stores UTC
      // wall-clock values. First restore the UTC instant, then render it in the
      // resolved IANA zone before truncating. A single AT TIME ZONE would treat
      // the stored UTC wall clock as local and mis-bucket DST-boundary records.
      `SELECT date_trunc('day', "deal"."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE `,
      `)::date::text AS "createdDay", ${dimension.select}, ${measure.select}
FROM "${DEAL_FIELD_REGISTRY.table}" AS "deal"
${dimension.join}
WHERE "deal"."orgId" = `,
      `
  AND "deal"."deletedAt" IS NULL
GROUP BY 1, ${dimension.groupBy}
ORDER BY "createdDay" ASC, "stage"."name" ASC`,
    ], timeZone, orgId)
  }

  return Prisma.sql([
    `SELECT ${dimension.select}, ${measure.select}
FROM "${DEAL_FIELD_REGISTRY.table}" AS "deal"
${dimension.join}
WHERE "deal"."orgId" = `,
    `
  AND "deal"."deletedAt" IS NULL
GROUP BY ${dimension.groupBy}
ORDER BY "stage"."name" ASC`,
  ], orgId)
}
