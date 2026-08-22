import type { CountryCode } from 'libphonenumber-js'
import normalizeUrl from 'normalize-url'

import { defaultCountryOf, formatEntry, readEntry } from '@/lib/dialPad'

/**
 * The result of turning typed or pasted text into a stored value for one cell.
 *
 * `ok: false` means the input didn't parse cleanly — `value` still holds the
 * best-effort result (never the empty/null it would take to silently drop the
 * edit), and `reason` is what to show next to the red-outlined cell.
 */
export interface CoercionResult {
  ok: boolean
  value: unknown
  display: string
  reason?: string
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const SLASHED_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/** `YYYY-MM-DD`, taking the input's own calendar date — never a time zone's. */
function toDateOnlyIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function coerceDate(raw: string): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }

  const isoMatch = DATE_ONLY_PATTERN.exec(trimmed)
  if (isoMatch) {
    const iso = toDateOnlyIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
    return { ok: true, value: iso, display: iso }
  }

  const slashMatch = SLASHED_DATE_PATTERN.exec(trimmed)
  if (slashMatch) {
    const iso = toDateOnlyIso(Number(slashMatch[3]), Number(slashMatch[1]), Number(slashMatch[2]))
    return { ok: true, value: iso, display: iso }
  }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    const iso = toDateOnlyIso(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate())
    return { ok: true, value: iso, display: iso }
  }

  return { ok: false, value: trimmed, display: trimmed, reason: 'Unrecognized date' }
}

export function coerceTimestamp(raw: string): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString()
    return { ok: true, value: iso, display: iso }
  }

  return { ok: false, value: trimmed, display: trimmed, reason: 'Unrecognized date/time' }
}

/**
 * Phone paste coercion: E.164 in storage, national format on screen — the same
 * split `dialPad.ts` uses for the dialer (README at the top of that file).
 * `existingE164` supplies the default country when the pasted text has no `+`.
 */
export function coercePhone(raw: string, existingE164?: string | null): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }

  const defaultCountry: CountryCode | undefined = defaultCountryOf(existingE164)
  const entry = readEntry(trimmed, defaultCountry)

  if (entry.status === 'valid') {
    return { ok: true, value: entry.e164, display: formatEntry(entry.e164, defaultCountry) }
  }

  const reason =
    entry.status === 'ambiguous'
      ? 'Start with + and the country code'
      : entry.status === 'incomplete'
        ? 'Too few digits for a real number'
        : 'Not a number we can call'
  return { ok: false, value: trimmed, display: trimmed, reason }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function coerceEmail(raw: string): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }
  if (EMAIL_PATTERN.test(trimmed)) return { ok: true, value: trimmed, display: trimmed }
  return { ok: false, value: trimmed, display: trimmed, reason: 'Not a valid email address' }
}

/** Normalizes a pasted URL: adds `https://` when missing, lowercases the host. */
export function coerceUrl(raw: string): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }

  try {
    const normalized = normalizeUrl(trimmed, { defaultProtocol: 'https' })
    return { ok: true, value: normalized, display: normalized }
  } catch {
    return { ok: false, value: trimmed, display: trimmed, reason: 'Not a valid URL' }
  }
}

function parseNumericText(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function coerceNumber(raw: string): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }
  const value = parseNumericText(trimmed)
  if (value === null) return { ok: false, value: trimmed, display: trimmed, reason: 'Not a number' }
  return { ok: true, value, display: String(value) }
}

export function coerceCurrency(raw: string): CoercionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null, display: '' }
  const value = parseNumericText(trimmed)
  if (value === null) return { ok: false, value: trimmed, display: trimmed, reason: 'Not a currency amount' }
  return { ok: true, value, display: value.toFixed(2) }
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'x', 'on', 'checked'])
const FALSY = new Set(['false', 'no', 'n', '0', '', 'off', 'unchecked'])

export function coerceCheckbox(raw: string): CoercionResult {
  const normalized = raw.trim().toLowerCase()
  if (TRUTHY.has(normalized)) return { ok: true, value: true, display: 'Yes' }
  if (FALSY.has(normalized)) return { ok: true, value: false, display: 'No' }
  return { ok: false, value: raw, display: raw, reason: 'Not a recognized checkbox value' }
}
