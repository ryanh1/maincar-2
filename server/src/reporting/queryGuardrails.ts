import type { Prisma } from '../generated/prisma/client.js'
import prisma from '../db.js'

// A report result larger than this is unusable in the browser. The compiler must
// estimate its grouped result before running the full pivot and offer top-N
// instead when this limit would be exceeded.
export const DEFAULT_REPORT_MAX_GROUPS = 10_000
export const DEFAULT_REPORT_QUERY_TIMEOUT_MS = 5_000

export class ReportGroupLimitError extends Error {
  readonly code = 'REPORT_GROUP_LIMIT_EXCEEDED'

  constructor(
    readonly groupCount: number,
    readonly maxGroups: number,
  ) {
    super(
      `This report would create ${groupCount} groups, which exceeds the ${maxGroups}-group limit. Narrow the fields or filters, or choose top-N.`,
    )
    this.name = 'ReportGroupLimitError'
  }
}

export class ReportQueryTimeoutError extends Error {
  readonly code = 'REPORT_QUERY_TIMEOUT'

  constructor() {
    super('This report took too long to run. Narrow the filters or try a smaller grouping.')
    this.name = 'ReportQueryTimeoutError'
  }
}

type ReportQueryOptions<T> = {
  estimateGroups: (tx: Prisma.TransactionClient) => Promise<number>
  execute: (tx: Prisma.TransactionClient) => Promise<T>
  maxGroups?: number
  timeoutMs?: number
}

/**
 * Runs a live report query under the reporting safety limits.
 *
 * Both callbacks share one interactive transaction, so PostgreSQL's local
 * statement timeout covers the group estimate and the pivot itself. Estimate
 * group cardinality before the pivot: an over-cap report must never begin the
 * expensive aggregation that would render an unusable result.
 */
export async function executeGuardedReportQuery<T>({
  estimateGroups,
  execute,
  maxGroups = DEFAULT_REPORT_MAX_GROUPS,
  timeoutMs = DEFAULT_REPORT_QUERY_TIMEOUT_MS,
}: ReportQueryOptions<T>): Promise<T> {
  assertPositiveInteger(maxGroups, 'maxGroups')
  assertPositiveInteger(timeoutMs, 'timeoutMs')

  try {
    return await prisma.$transaction(async (tx) => {
      // set_config(..., true) is the parameterized equivalent of SET LOCAL. It
      // expires with this transaction and cannot leak a report timeout to OLTP.
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`

      const groupCount = await estimateGroups(tx)
      assertNonNegativeInteger(groupCount, 'estimateGroups')
      if (groupCount > maxGroups) {
        throw new ReportGroupLimitError(groupCount, maxGroups)
      }

      return execute(tx)
    })
  } catch (error) {
    if (isPostgresStatementTimeout(error)) {
      throw new ReportQueryTimeoutError()
    }
    throw error
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must resolve to a non-negative integer`)
  }
}

function isPostgresStatementTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '57014'
  )
}
