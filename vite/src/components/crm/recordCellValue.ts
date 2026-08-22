import { formatDate, formatDateTime } from '@/lib/datetime'
import type { AttributeType } from '@/lib/crmTypes'

/**
 * The raw stored value for one cell, as plain display text. Cell types (a
 * select's option label, a phone's E.164 formatting, a select-chip renderer)
 * are CHUNK-1 §C / T2.1 — out of scope for the read-only grid shell. Dates are
 * the one exception: CLAUDE.md's timezone rule is not feature-scoped, so a
 * timestamp never reaches the screen as a bare ISO string.
 */
export function formatCellValue(
  value: unknown,
  type: AttributeType,
  timeZone: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return ''

  switch (type) {
    case 'timestamp':
      return formatDateTime(String(value), timeZone)
    case 'date':
      return formatDate(String(value), timeZone)
    case 'checkbox':
      return value ? 'Yes' : 'No'
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}
