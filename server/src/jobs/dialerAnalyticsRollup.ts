import { Prisma } from '../generated/prisma/client.js'
import prisma from '../db.js'
import { JOB_DIALER_ANALYTICS_ROLLUP, scheduleJob, sendJob, workJob } from './queue.js'

export const DIALER_ANALYTICS_ROLLUP_CRON = '0 * * * *'

export interface DialerAnalyticsRollupResult {
  dials: number
  connects: number
  rows: number
}

interface RollupRow {
  day: Date
  numberE164: string
  areaCode: string | null
  dials: number | bigint | string
  connects: number | bigint | string
}

function toCount(value: RollupRow['dials']): number {
  return Number(value)
}

/**
 * Rebuild one organization's number/area aggregate from its outbound call log.
 * Replacing the org's rows is safe under the per-org singleton queue key and
 * makes retry delivery idempotent instead of accumulating duplicate counts.
 */
export async function rollupDialerAnalyticsForOrg(orgId: string): Promise<DialerAnalyticsRollupResult> {
  // Let Postgres group the whole call log. Pulling it into Node each hour would
  // make memory and runtime grow with every historical call. The NPA expression
  // deliberately leaves non-NANP targets null instead of inventing an area code.
  const rows = await prisma.$queryRaw<RollupRow[]>(Prisma.sql([
    `SELECT date_trunc('day', COALESCE("startedAt", "createdAt")) AS "day",
  "fromE164" AS "numberE164",
  CASE WHEN "toE164" ~ '^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$' THEN substring("toE164" from 3 for 3) END AS "areaCode",
  COUNT(*)::text AS "dials",
  COUNT(*) FILTER (WHERE "status" = 'completed')::text AS "connects"
FROM "Call"
WHERE "orgId" = `,
    `
  AND "direction" = 'outbound'
GROUP BY 1, 2, 3`,
  ], orgId))

  await prisma.$transaction(async (tx) => {
    await tx.analyticsRollup.deleteMany({ where: { orgId } })
    if (rows.length > 0) {
      await tx.analyticsRollup.createMany({
        data: rows.map((row) => ({
          orgId,
          day: row.day,
          hourOfDay: null,
          numberE164: row.numberE164,
          areaCode: row.areaCode,
          dials: toCount(row.dials),
          connects: toCount(row.connects),
        })),
      })
    }
  })

  return {
    dials: rows.reduce((total, row) => total + toCount(row.dials), 0),
    connects: rows.reduce((total, row) => total + toCount(row.connects), 0),
    rows: rows.length,
  }
}

/** Queue a single organization, coalescing overlapping report opens and cron runs. */
export function queueDialerAnalyticsRollup(orgId: string): Promise<string | null> {
  return sendJob(JOB_DIALER_ANALYTICS_ROLLUP, { orgId }, { singletonKey: orgId })
}

/** Attach the worker. A cron dispatch fans out so every actual aggregate is per-org. */
export async function registerDialerAnalyticsRollupWorker(): Promise<string> {
  return workJob<{ orgId?: string }>(JOB_DIALER_ANALYTICS_ROLLUP, { batchSize: 1 }, async (job) => {
    if (job.data.orgId) {
      await rollupDialerAnalyticsForOrg(job.data.orgId)
      return
    }

    const orgs = await prisma.org.findMany({ select: { id: true } })
    await Promise.all(orgs.map(({ id }) => queueDialerAnalyticsRollup(id)))
  })
}

/** Run the lightweight organization dispatcher once per hour. */
export function scheduleDialerAnalyticsRollup(): Promise<void> {
  return scheduleJob(JOB_DIALER_ANALYTICS_ROLLUP, DIALER_ANALYTICS_ROLLUP_CRON)
}
