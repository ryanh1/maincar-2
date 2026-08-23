/**
 * Smart range selection for the read-time account timeline (MAI-274).
 *
 * It is deliberately pure: route code supplies the account and open-deal facts,
 * while these rules remain deterministic and directly testable.
 */
export const DENSE_TIMELINE_EVENT_COUNT = 10
export const MINIMUM_FUTURE_FRAME_DAYS = 14

const DENSE_PRESET_DAYS = [7, 30, 90, 365] as const
const OPEN_DEAL_PRESET_DAYS = [1, ...DENSE_PRESET_DAYS, 365 * 5] as const

export interface SmartTimelineRangeInput {
  accountCreatedAt: Date
  activeDealCreatedAt: Date | null
  farthestScheduledAt: Date | null
  recentEventOccurredAt: Date[]
  now: Date
}

export interface SmartTimelineRange {
  from: Date
  to: Date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function laterOf(first: Date, second: Date): Date {
  return first > second ? first : second
}

function earliestPresetStart(
  end: Date,
  earliestIncludedAt: Date,
  presets: readonly number[],
): Date | null {
  for (const days of presets) {
    const start = addDays(end, -days)
    if (start <= earliestIncludedAt) return start
  }
  return null
}

/**
 * Journey 6.9 keeps an open deal's lifecycle and scheduled work in one frame.
 * Other accounts default to the smallest recent window with enough activity;
 * every default still starts no earlier than the account itself.
 */
export function resolveSmartTimelineRange(input: SmartTimelineRangeInput): SmartTimelineRange {
  const scheduledEdge = input.farthestScheduledAt ? addDays(input.farthestScheduledAt, 1) : input.now

  if (input.activeDealCreatedAt) {
    const to = laterOf(addDays(input.now, MINIMUM_FUTURE_FRAME_DAYS), scheduledEdge)
    const dealCreatedAt = laterOf(input.accountCreatedAt, input.activeDealCreatedAt)
    const presetStart = earliestPresetStart(to, dealCreatedAt, OPEN_DEAL_PRESET_DAYS)
    return {
      from: laterOf(input.accountCreatedAt, presetStart ?? input.accountCreatedAt),
      to,
    }
  }

  const to = laterOf(input.now, scheduledEdge)
  for (const days of DENSE_PRESET_DAYS) {
    const from = laterOf(input.accountCreatedAt, addDays(input.now, -days))
    const eventCount = input.recentEventOccurredAt.filter((occurredAt) => occurredAt >= from && occurredAt <= input.now).length
    if (eventCount >= DENSE_TIMELINE_EVENT_COUNT) return { from, to }
  }

  return { from: input.accountCreatedAt, to }
}
