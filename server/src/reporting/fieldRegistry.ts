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
      join: 'INNER JOIN "PipelineStage" AS "stage" ON "stage"."id" = "deal"."stageId" AND "stage"."orgId" = "deal"."orgId"',
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
