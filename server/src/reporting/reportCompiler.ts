import { Prisma } from '../generated/prisma/client.js'

import { DEAL_FIELD_REGISTRY } from './fieldRegistry.js'

export interface ReportConfig {
  baseObject: 'deal'
  rows: [{ field: 'stage' }]
  values: [{ field: 'amountMinor'; aggregation: 'sum' }]
}

export const DEAL_STAGE_AMOUNT_REPORT: ReportConfig = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
}

export class InvalidReportConfigError extends Error {
  status = 400
}

/**
 * Compiles MAI-143's initial structured config into a parameterized query.
 * SQL identifiers come only from DEAL_FIELD_REGISTRY; orgId is the sole value
 * parameter and is supplied by the authenticated route, not the report config.
 */
export function compileReport(config: ReportConfig, orgId: string): Prisma.Sql {
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
