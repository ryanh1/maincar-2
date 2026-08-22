import { formatDate, formatDateTime } from '@/lib/datetime'
import type { AttributeType } from '@/lib/crmTypes'

/**
 * The raw stored value for one cell, as plain display text. This is the
 * fallback path `cellBuilder.ts`'s `buildGridCell` uses for types with no
 * dedicated `GridCellKind` (text, phone, email, url, record references, …);
 * checkbox/select/number/currency get their own cell shapes there instead.
 * Dates stay handled here regardless: CLAUDE.md's timezone rule is not
 * feature-scoped, so a timestamp never reaches the screen as a bare ISO
 * string.
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
