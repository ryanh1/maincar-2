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
  currencyCode = 'USD',
  isMinorCurrency = false,
): string {
  if (value === null || value === undefined || value === '') return ''

  switch (type) {
    case 'timestamp':
      return formatDateTime(String(value), timeZone)
    case 'date':
      return formatDate(String(value), timeZone)
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'currency': {
      const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
      if (!Number.isFinite(numeric)) return String(value)
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(
        isMinorCurrency ? numeric / 100 : numeric,
      )
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}
