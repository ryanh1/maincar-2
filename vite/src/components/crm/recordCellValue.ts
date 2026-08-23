import { formatDate, formatDateTime } from '@/lib/datetime'
import type { AttributeType, FieldFormat } from '@/lib/crmTypes'

/**
 * The raw stored value for one cell, as plain display text. This is the
 * fallback path `cellBuilder.ts`'s `buildGridCell` uses for types with no
 * dedicated `GridCellKind` (text, phone, email, url, record references, …);
 * checkbox/select/number/currency get their own cell shapes there instead.
 * Dates stay handled here regardless: CLAUDE.md's timezone rule is not
 * feature-scoped, so a timestamp never reaches the screen as a bare ISO
 * string.
 *
 * `formatJson` (MAI-365) is display-only: it changes how a number/currency/date
 * renders, never the stored value, so export and the API stay canonical.
 */

/** Reads the admin's display format, tolerating a malformed or absent blob. */
export function parseFieldFormat(formatJson: unknown): FieldFormat | null {
  if (!formatJson || typeof formatJson !== 'object' || Array.isArray(formatJson)) return null
  const raw = formatJson as Record<string, unknown>
  const format: FieldFormat = {}
  if (raw.number && typeof raw.number === 'object' && !Array.isArray(raw.number)) {
    const number = raw.number as Record<string, unknown>
    const parsed: NonNullable<FieldFormat['number']> = {}
    if (number.style === 'decimal' || number.style === 'currency' || number.style === 'percent') parsed.style = number.style
    if (typeof number.currency === 'string' && number.currency) parsed.currency = number.currency
    if (typeof number.minimumFractionDigits === 'number') parsed.minimumFractionDigits = number.minimumFractionDigits
    if (typeof number.maximumFractionDigits === 'number') parsed.maximumFractionDigits = number.maximumFractionDigits
    if (Object.keys(parsed).length > 0) format.number = parsed
  }
  if (raw.date && typeof raw.date === 'object' && !Array.isArray(raw.date)) {
    const date = raw.date as Record<string, unknown>
    if (date.preset === 'short' || date.preset === 'medium' || date.preset === 'long' || date.preset === 'full') {
      format.date = { preset: date.preset }
    }
  }
  if (typeof raw.mask === 'string' && raw.mask) format.mask = raw.mask
  return Object.keys(format).length > 0 ? format : null
}

function formatNumber(value: number, format: NonNullable<FieldFormat['number']>, currencyCode: string): string {
  const style = format.style ?? 'decimal'
  const options: Intl.NumberFormatOptions = { style }
  if (style === 'currency') options.currency = format.currency ?? currencyCode
  if (format.minimumFractionDigits !== undefined) options.minimumFractionDigits = format.minimumFractionDigits
  if (format.maximumFractionDigits !== undefined) options.maximumFractionDigits = format.maximumFractionDigits
  return new Intl.NumberFormat('en-US', options).format(value)
}

export function formatCellValue(
  value: unknown,
  type: AttributeType,
  timeZone: string | null | undefined,
  currencyCode = 'USD',
  isMinorCurrency = false,
  formatJson?: unknown,
): string {
  if (value === null || value === undefined || value === '') return ''

  const format = parseFieldFormat(formatJson)

  switch (type) {
    case 'timestamp':
      return format?.date?.preset
        ? new Intl.DateTimeFormat('en-US', { dateStyle: format.date.preset, timeStyle: 'short' }).format(new Date(String(value)))
        : formatDateTime(String(value), timeZone)
    case 'date':
      return format?.date?.preset
        ? new Intl.DateTimeFormat('en-US', { dateStyle: format.date.preset }).format(new Date(String(value)))
        : formatDate(String(value), timeZone)
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'currency': {
      const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
      if (!Number.isFinite(numeric)) return String(value)
      const amount = isMinorCurrency ? numeric / 100 : numeric
      if (format?.number) return formatNumber(amount, format.number, currencyCode)
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount)
    }
    case 'number':
    case 'rating': {
      const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
      if (!Number.isFinite(numeric)) return String(value)
      if (format?.number) return formatNumber(numeric, format.number, currencyCode)
      return String(numeric)
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}
