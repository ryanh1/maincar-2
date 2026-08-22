/**
 * The reporting engine's server-owned vocabulary. A report config can name a
 * field from this registry; it can never supply a table, column, or SQL token.
 *
 * MAI-143 deliberately starts with the one useful Deal query. Later reporting
 * slices extend this registry rather than interpolating new client input into
 * SQL at a call site.
 */
export const DEAL_FIELD_REGISTRY = {
  table: 'Deal',
  dimensions: {
    stage: {
      field: 'stage',
      select: '"stage"."id" AS "stageId", "stage"."name" AS "stageName"',
      groupBy: '"stage"."id", "stage"."name"',
      orderBy: '"stage"."name" ASC',
      join: 'INNER JOIN "PipelineStage" AS "stage" ON "stage"."id" = "deal"."stageId" AND "stage"."orgId" = "deal"."orgId"',
    },
    owner: {
      field: 'owner',
      select: `COALESCE("owner"."id", 'unassigned') AS "ownerId", COALESCE(NULLIF(TRIM(CONCAT_WS(' ', "owner"."firstName", "owner"."lastName")), ''), "owner"."email", 'Unassigned') AS "ownerName"`,
      groupBy: `COALESCE("owner"."id", 'unassigned'), COALESCE(NULLIF(TRIM(CONCAT_WS(' ', "owner"."firstName", "owner"."lastName")), ''), "owner"."email", 'Unassigned')`,
      orderBy: '"ownerName" ASC',
      join: 'LEFT JOIN "User" AS "owner" ON "owner"."id" = "deal"."ownerUserId"',
    },
    segment: {
      field: 'segment',
      // `segment` is the system-owned AttributeDef slug seeded for every Deal
      // object. This key lives only in the registry, never in report config.
      select: `COALESCE(NULLIF("deal"."customJson" ->> 'segment', ''), 'unspecified') AS "segmentId", COALESCE(NULLIF("deal"."customJson" ->> 'segment', ''), 'Unspecified') AS "segmentName"`,
      groupBy: `COALESCE(NULLIF("deal"."customJson" ->> 'segment', ''), 'unspecified'), COALESCE(NULLIF("deal"."customJson" ->> 'segment', ''), 'Unspecified')`,
      orderBy: '"segmentName" ASC',
      join: '',
    },
  },
  measures: {
    amountMinor: {
      field: 'amountMinor',
      aggregation: 'sum',
      select: 'COALESCE(SUM("deal"."amountMinor")::text, \'0\') AS "amountMinor"',
      additive: true,
    },
  },
} as const

/**
 * The first predefined rows in R4's activity grid. The compiler owns this
 * allowlist so a report request cannot turn a source type into SQL input.
 */
export const ACTIVITY_EVENT_COUNT_FIELD_REGISTRY = {
  table: 'ActivityEntry',
  eventSourceTypes: ['call', 'email', 'meeting'],
} as const
