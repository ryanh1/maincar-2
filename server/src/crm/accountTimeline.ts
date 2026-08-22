/**
 * Smart range selection for the read-time account timeline (MAI-274).
 *
 * It is deliberately pure: route code supplies the account and open-deal facts,
 * while these rules remain deterministic and directly testable.
 */
export const DENSE_TIMELINE_EVENT_COUNT = 12
export const DENSE_TIMELINE_LOOKBACK_DAYS = 30
export const OPEN_DEAL_LOOKBACK_DAYS = 90
export const MINIMUM_FUTURE_FRAME_DAYS = 7

export interface SmartTimelineRangeInput {
  accountCreatedAt: Date
  activeDealCreatedAt: Date | null
  farthestCommitmentAt: Date | null
  recentEventCount: number
  now: Date
}

export interface SmartTimelineRange {
  from: Date
  to: Date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * Keeps an account's current working context legible without silently clipping a
 * real future commitment. Dense history gets a focused recent frame; sparse
 * history keeps the creation marker. Open deals get a wider recent context and
 * always include their creation event.
 */
export function resolveSmartTimelineRange(input: SmartTimelineRangeInput): SmartTimelineRange {
  const minimumFutureEdge = addDays(input.now, MINIMUM_FUTURE_FRAME_DAYS)
  const commitmentEdge = input.farthestCommitmentAt ? addDays(input.farthestCommitmentAt, 1) : null
  const to = commitmentEdge && commitmentEdge > minimumFutureEdge ? commitmentEdge : minimumFutureEdge

  if (input.activeDealCreatedAt) {
    const recentContext = addDays(input.now, -OPEN_DEAL_LOOKBACK_DAYS)
    return {
      from: input.activeDealCreatedAt < recentContext ? input.activeDealCreatedAt : recentContext,
      to,
    }
  }

  if (input.recentEventCount >= DENSE_TIMELINE_EVENT_COUNT) {
    return { from: addDays(input.now, -DENSE_TIMELINE_LOOKBACK_DAYS), to }
  }

  return { from: input.accountCreatedAt, to }
}
