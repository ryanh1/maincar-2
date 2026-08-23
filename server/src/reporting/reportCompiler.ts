import { Prisma } from '../generated/prisma/client.js'

import { ACTIVITY_EVENT_COUNT_FIELD_REGISTRY, DEAL_FIELD_REGISTRY, DEAL_PIVOT_MEASURES } from './fieldRegistry.js'

export type DealPivotDimension = 'owner' | 'stage' | 'segment' | 'createdAt'
export type DealPivotValue =
  | { field: 'id'; aggregation: 'count' }
  | { field: 'amountMinor'; aggregation: 'sum'; showAs?: PivotValueTransform }
  | { field: 'amountMinor'; aggregation: 'average' | 'distinctCount' | 'median' | 'percentile' }

export interface ReportChartConfig {
  type: 'bar' | 'line' | 'area' | 'pie' | 'funnel' | 'heatmap' | 'scatter' | 'kpi'
  color: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4'
  labels: boolean
  yAxisMax?: number
}

export interface DealPivotReportConfig {
  baseObject: 'deal'
  rows: Array<{ field: DealPivotDimension }>
  columns: Array<{ field: DealPivotDimension }>
  values: [DealPivotValue]
  timeZone: ReportTimeZone
  timeBucket?: { field: 'createdAt'; grain: 'day' }
  filters?: { ownerTeam: OwnerTeamScope }
  compareTo?: PeriodComparison
  summaryRows?: Array<{ rowKey: string; showAs: 'percentOfGrandTotal' | 'percentOfParent' | 'samePeriodLastYear' }>
  /** Display settings persist with the report but do not affect its SQL query. */
  chart?: ReportChartConfig
}

export type PivotValueTransform = 'none' | 'percentOfGrandTotal' | 'percentOfColumn' | 'percentOfRow' | 'percentOfParent' | 'runningTotal' | 'rankLargestToSmallest'
export type PeriodComparison = 'previousPeriod' | 'samePeriodLastYear'

export interface ActivityEventCountsGridReportConfig {
  baseObject: 'activity'
  rows: [{ field: 'sourceType' }]
  values: [{ field: 'id'; aggregation: 'count' }]
  timeZone: ReportTimeZone
  timeBucket: { field: 'occurredAt'; grain: 'week' }
}

export interface DialerConnectRateReportConfig {
  baseObject: 'dialer'
  rows: [{ field: 'numberE164' | 'areaCode' }]
  values: [
    { field: 'dials'; aggregation: 'sum' },
    { field: 'connects'; aggregation: 'sum' },
  ]
  timeZone: ReportTimeZone
}

export type ActivityGridMetric =
  | { key: string; type: 'event_count'; sourceType: 'call' | 'email' | 'meeting' }
  | { key: string; type: 'stage_entry'; stageId: string }
  | { key: string; type: 'conversion'; numeratorKey: string; denominatorKey: string }

/**
 * The next R4 slice: explicitly named metric rows so values sourced from
 * ActivityEntry and FieldHistory can share one weekly grid. Conversion rows are
 * calculated from the two named count rows after the database aggregation.
 */
export interface ActivityMetricsGridReportConfig {
  baseObject: 'activityGrid'
  metrics: readonly ActivityGridMetric[]
  timeZone: ReportTimeZone
  timeBucket: { field: 'occurredAt'; grain: 'week' }
}

/** A persisted selection resolved by the shared Team scope at query time. */
export interface OwnerTeamScope {
  teamIds?: readonly string[]
  leadUserIds?: readonly string[]
}

export type ReportConfig =
  | DealPivotReportConfig
  | ActivityEventCountsGridReportConfig
  | ActivityMetricsGridReportConfig
  | DialerConnectRateReportConfig

export type ReportTimeZone =
  | { mode: 'pinned'; displayZone: string }
  | { mode: 'viewer' }
  | { mode: 'subject'; subjectUserId: string }

export interface ReportExecutionContext {
  viewerTimeZone?: string | null
  subjectTimeZone?: string | null
  /** Owner ids returned by resolveOwnerTeamScope; reports never expand teams themselves. */
  ownerTeamUserIds?: readonly string[]
}

export const DEAL_STAGE_AMOUNT_REPORT: DealPivotReportConfig = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  columns: [],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  // The first report has no date bucket, but every saved report must still
  // declare an explicit zone before a later config adds one.
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

export const ACTIVITY_EVENT_COUNTS_GRID_REPORT: ActivityEventCountsGridReportConfig = {
  baseObject: 'activity',
  rows: [{ field: 'sourceType' }],
  values: [{ field: 'id', aggregation: 'count' }],
  timeZone: { mode: 'viewer' },
  timeBucket: { field: 'occurredAt', grain: 'week' },
}

export const DIALER_CONNECT_RATE_BY_NUMBER_REPORT: DialerConnectRateReportConfig = {
  baseObject: 'dialer',
  rows: [{ field: 'numberE164' }],
  values: [
    { field: 'dials', aggregation: 'sum' },
    { field: 'connects', aggregation: 'sum' },
  ],
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

export const DIALER_CONNECT_RATE_BY_AREA_REPORT: DialerConnectRateReportConfig = {
  ...DIALER_CONNECT_RATE_BY_NUMBER_REPORT,
  rows: [{ field: 'areaCode' }],
}

export interface RawActivityGridCount {
  weekStart: string
  metricKey: string
  metricType: 'event_count' | 'stage_entry'
  count: string | number | bigint
}

export type ActivityGridResultRow =
  | {
    weekStart: string
    metricKey: string
    metricType: 'event_count' | 'stage_entry'
    count: string
  }
  | {
    weekStart: string
    metricKey: string
    metricType: 'conversion'
    ratio: number | null
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
  if (config.baseObject === 'dialer') {
    return compileDialerConnectRateReport(config, orgId, context)
  }
  if (config.baseObject === 'activityGrid') {
    return compileActivityMetricsGrid(config, orgId, context)
  }
  if (config.baseObject === 'activity') {
    return compileActivityEventCountsGrid(config, orgId, context)
  }

  return compileDealStageAmountReport(config, orgId, context)
}

/** Builds every configured source and conversion row for each observed week. */
export function buildActivityGridRows(
  config: ActivityMetricsGridReportConfig,
  sourceRows: readonly RawActivityGridCount[],
): ActivityGridResultRow[] {
  validateActivityMetricsGrid(config)

  const valuesByWeek = new Map<string, Map<string, bigint>>()
  for (const row of sourceRows) {
    let counts = valuesByWeek.get(row.weekStart)
    if (!counts) {
      counts = new Map()
      valuesByWeek.set(row.weekStart, counts)
    }
    counts.set(row.metricKey, BigInt(row.count))
  }

  return [...valuesByWeek.keys()].sort().flatMap((weekStart) => {
    const counts = valuesByWeek.get(weekStart)!
    return config.metrics.map((metric): ActivityGridResultRow => {
      if (metric.type !== 'conversion') {
        return {
          weekStart,
          metricKey: metric.key,
          metricType: metric.type,
          count: (counts.get(metric.key) ?? 0n).toString(),
        }
      }

      const numerator = counts.get(metric.numeratorKey) ?? 0n
      const denominator = counts.get(metric.denominatorKey) ?? 0n
      return {
        weekStart,
        metricKey: metric.key,
        metricType: 'conversion',
        // A missing denominator is not 0%; it is an unavailable ratio. The
        // renderer can present this as an em dash rather than NaN or Infinity.
        ratio: denominator === 0n ? null : Number(numerator) / Number(denominator),
      }
    })
  })
}

function compileDialerConnectRateReport(
  config: DialerConnectRateReportConfig,
  orgId: string,
  context: ReportExecutionContext,
): Prisma.Sql {
  if (
    config.rows.length !== 1 ||
    !['numberE164', 'areaCode'].includes(config.rows[0]?.field) ||
    config.values.length !== 2 ||
    config.values[0]?.field !== 'dials' ||
    config.values[0]?.aggregation !== 'sum' ||
    config.values[1]?.field !== 'connects' ||
    config.values[1]?.aggregation !== 'sum'
  ) {
    throw new InvalidReportConfigError('Only dialer connect rates grouped by number or area code are available yet.')
  }

  resolveReportTimeZone(config.timeZone, context)
  const dimension = config.rows[0].field
  const select = dimension === 'numberE164'
    ? '"rollup"."numberE164" AS "numberE164"'
    : '"rollup"."areaCode" AS "areaCode"'
  const groupBy = dimension === 'numberE164' ? '"rollup"."numberE164"' : '"rollup"."areaCode"'

  return Prisma.sql([
    `SELECT ${select}, SUM("rollup"."dials")::text AS "dials", SUM("rollup"."connects")::text AS "connects"
FROM "AnalyticsRollup" AS "rollup"
WHERE "rollup"."orgId" = `,
    `
  AND ${groupBy} IS NOT NULL
GROUP BY ${groupBy}
ORDER BY ${groupBy} ASC`,
  ], orgId)
}

function compileDealStageAmountReport(
  config: DealPivotReportConfig,
  orgId: string,
  context: ReportExecutionContext,
): Prisma.Sql {
  const measure = DEAL_PIVOT_MEASURES.find((candidate) =>
    candidate.field === config.values[0]?.field && candidate.aggregation === config.values[0]?.aggregation,
  )

  if (
    config.baseObject !== 'deal' ||
    config.rows.length + config.columns.length === 0 ||
    config.rows.length + config.columns.length > 2 ||
    config.values.length !== 1 ||
    !measure
  ) {
    throw new InvalidReportConfigError('Add up to two unique Owner, Stage, Segment, or Created date groups and one supported measure.')
  }

  const selectedDimensions = [...config.rows, ...config.columns]
  if (new Set(selectedDimensions.map((dimension) => dimension.field)).size !== selectedDimensions.length) {
    throw new InvalidReportConfigError('A field can appear in only one pivot zone.')
  }

  const usesCreatedDate = selectedDimensions.some((dimension) => dimension.field === 'createdAt')
  if (usesCreatedDate && !config.timeBucket) {
    throw new InvalidReportConfigError('Created date needs a day bucket before it can be used in a pivot.')
  }
  const dimensions = selectedDimensions
    .filter((dimension): dimension is { field: 'owner' | 'stage' | 'segment' } => dimension.field !== 'createdAt')
    .map(({ field }) => DEAL_FIELD_REGISTRY.dimensions[field])

  const timeZone = resolveReportTimeZone(config.timeZone, context)
  if (config.timeBucket && (config.timeBucket.field !== 'createdAt' || config.timeBucket.grain !== 'day')) {
    throw new InvalidReportConfigError('Only Deal created-at day buckets are available yet.')
  }

  const ownerTeamPredicate = compileOwnerTeamPredicate(context.ownerTeamUserIds)
  const select = dimensions.map((dimension) => dimension.select).join(', ')
  const joins = dimensions.map((dimension) => dimension.join).join('\n')
  // Each registry dimension can contain more than one SQL expression (for
  // example, an id and its display label). Treat those expressions as one
  // grouping element: CUBE(exprA, exprB) would otherwise emit invalid partial
  // rows where an id survives but its label is grouped away.
  const dimensionGroupBy = dimensions
    .map((dimension) => dimension.groupBy.startsWith('(') ? dimension.groupBy : `(${dimension.groupBy})`)
    .join(', ')
  const orderBy = dimensions.map((dimension) => dimension.orderBy).join(', ')
  const grouping = dimensions.map((dimension) => `GROUPING(${dimension.grouping})::int AS "${dimension.field}Grouped"`).join(', ')
  const timeBucketGroupBy = usesCreatedDate
    ? `CUBE (1${dimensionGroupBy ? `, ${dimensionGroupBy}` : ''})`
    : `1, CUBE (${dimensionGroupBy})`

  if (config.timeBucket) {
    return Prisma.sql([
      // Prisma maps DateTime to `timestamp without time zone`; it stores UTC
      // wall-clock values. First restore the UTC instant, then render it in the
      // resolved IANA zone before truncating. A single AT TIME ZONE would treat
      // the stored UTC wall clock as local and mis-bucket DST-boundary records.
      `SELECT date_trunc('day', "deal"."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE `,
      `)::date::text AS "createdDay"${select ? `, ${select}` : ''}${grouping ? `, ${grouping}` : ''}, ${measure.select}
FROM "${DEAL_FIELD_REGISTRY.table}" AS "deal"
${joins}
WHERE "deal"."orgId" = `,
      `
  AND "deal"."deletedAt" IS NULL
`,
      `
GROUP BY ${timeBucketGroupBy}
ORDER BY "createdDay" ASC${orderBy ? `, ${orderBy}` : ''}`,
    ], timeZone, orgId, ownerTeamPredicate)
  }

  return Prisma.sql([
    `SELECT ${select}, ${grouping}, ${measure.select}
FROM "${DEAL_FIELD_REGISTRY.table}" AS "deal"
${joins}
WHERE "deal"."orgId" = `,
    `
  AND "deal"."deletedAt" IS NULL
`,
    `
GROUP BY CUBE (${dimensionGroupBy})
ORDER BY ${orderBy}`,
  ], orgId, ownerTeamPredicate)
}

/** Adds a deduplicated owner predicate returned by the shared Team scope. */
function compileOwnerTeamPredicate(ownerUserIds: readonly string[] | undefined): Prisma.Sql {
  if (ownerUserIds === undefined) return Prisma.empty
  if (ownerUserIds.length === 0) return Prisma.sql` AND FALSE`
  return Prisma.sql` AND "deal"."ownerUserId" IN (${Prisma.join(ownerUserIds)})`
}

function compileActivityEventCountsGrid(
  config: ActivityEventCountsGridReportConfig,
  orgId: string,
  context: ReportExecutionContext,
): Prisma.Sql {
  if (
    config.rows.length !== 1 ||
    config.rows[0]?.field !== 'sourceType' ||
    config.values.length !== 1 ||
    config.values[0]?.field !== 'id' ||
    config.values[0]?.aggregation !== 'count' ||
    config.timeBucket.field !== 'occurredAt' ||
    config.timeBucket.grain !== 'week'
  ) {
    throw new InvalidReportConfigError('Only activity event counts grouped by week are available yet.')
  }

  const timeZone = resolveReportTimeZone(config.timeZone, context)
  const sourceTypes = ACTIVITY_EVENT_COUNT_FIELD_REGISTRY.eventSourceTypes
    .map((sourceType) => `'${sourceType}'`)
    .join(', ')

  return Prisma.sql([
    // PostgreSQL weeks start on Monday. As with Deal day buckets, restore the
    // UTC instant before deriving the viewer's local calendar week.
    `SELECT date_trunc('week', "activity"."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE `,
    `)::date::text AS "weekStart", "activity"."sourceType" AS "sourceType", COUNT(*)::text AS "count"
FROM "${ACTIVITY_EVENT_COUNT_FIELD_REGISTRY.table}" AS "activity"
WHERE "activity"."orgId" = `,
    `
  AND "activity"."sourceType" IN (${sourceTypes})
GROUP BY 1, 2
ORDER BY "weekStart" ASC, "sourceType" ASC`,
  ], timeZone, orgId)
}

function compileActivityMetricsGrid(
  config: ActivityMetricsGridReportConfig,
  orgId: string,
  context: ReportExecutionContext,
): Prisma.Sql {
  validateActivityMetricsGrid(config)
  const timeZone = resolveReportTimeZone(config.timeZone, context)

  const sourceQueries = config.metrics.flatMap((metric): Prisma.Sql[] => {
    if (metric.type === 'event_count') {
      return [Prisma.sql`
SELECT date_trunc('week', "activity"."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date::text AS "weekStart",
  ${metric.key}::text AS "metricKey",
  'event_count'::text AS "metricType",
  COUNT(*)::text AS "count"
FROM "ActivityEntry" AS "activity"
WHERE "activity"."orgId" = ${orgId}
  AND "activity"."sourceType" = ${metric.sourceType}
GROUP BY 1`]
    }
    if (metric.type === 'stage_entry') {
      return [Prisma.sql`
SELECT date_trunc('week', "history"."changedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date::text AS "weekStart",
  ${metric.key}::text AS "metricKey",
  'stage_entry'::text AS "metricType",
  COUNT(*)::text AS "count"
FROM "FieldHistory" AS "history"
WHERE "history"."orgId" = ${orgId}
  AND "history"."objectSlug" = 'deal'
  AND "history"."attribute" = 'stageId'
  AND "history"."newJson" = to_jsonb(${metric.stageId}::text)
GROUP BY 1`]
    }
    return []
  })

  return Prisma.sql`
SELECT "weekStart", "metricKey", "metricType", "count"
FROM (${Prisma.join(sourceQueries, ' UNION ALL ')}) AS "metric"
ORDER BY "weekStart" ASC, "metricKey" ASC`
}

function validateActivityMetricsGrid(config: ActivityMetricsGridReportConfig): void {
  if (config.timeBucket.field !== 'occurredAt' || config.timeBucket.grain !== 'week') {
    throw new InvalidReportConfigError('Only activity occurred-at week buckets are available yet.')
  }
  if (config.metrics.length === 0) {
    throw new InvalidReportConfigError('An activity grid needs at least one metric row.')
  }

  const metricByKey = new Map<string, ActivityGridMetric>()
  for (const metric of config.metrics) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(metric.key)) {
      throw new InvalidReportConfigError('Activity grid metric keys must be lowercase letters, numbers, hyphens, or underscores.')
    }
    if (metricByKey.has(metric.key)) {
      throw new InvalidReportConfigError(`Activity grid metric key "${metric.key}" is duplicated.`)
    }
    metricByKey.set(metric.key, metric)
  }

  for (const metric of config.metrics) {
    if (metric.type !== 'conversion') continue
    const numerator = metricByKey.get(metric.numeratorKey)
    const denominator = metricByKey.get(metric.denominatorKey)
    if (!numerator || !denominator || numerator.type === 'conversion' || denominator.type === 'conversion') {
      throw new InvalidReportConfigError('A conversion row must reference two count metric rows.')
    }
    if (metric.numeratorKey === metric.denominatorKey) {
      throw new InvalidReportConfigError('A conversion row needs two different metric rows.')
    }
  }

  if (!config.metrics.some((metric) => metric.type !== 'conversion')) {
    throw new InvalidReportConfigError('An activity grid needs at least one count metric row.')
  }
}
