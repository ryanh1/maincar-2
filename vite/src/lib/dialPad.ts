/**
 * What the dialer does with what a rep types.
 *
 * The server is the authority on what is dialable: `createCallSchema.toE164` in
 * `server/src/routes/calls.ts` takes E.164 only and deliberately normalises
 * nothing, because reshaping a typo can turn it into a DIFFERENT valid number and
 * then we call that one. That decision assumes somebody upstream did the
 * normalising. This module is that somebody.
 *
 * So the split is: this decides whether the Call button is live and how the number
 * reads on screen; the server's regex stays the last check before a real call.
 *
 * Everything here goes through `libphonenumber-js`, which already ships in
 * `vite/package.json`. Hand-rolled country rules were the old repo's approach and
 * they only ever knew about NANP.
 */

import {
  AsYouType,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js'

/**
 * E.164, strictly — the same pattern `server/src/routes/calls.ts` enforces. Kept
 * here so the button and the server cannot drift about what "dialable" means.
 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/

/** True when the value is already E.164: a `+`, a non-zero country digit, 7–15 digits. */
export function isE164(value: string): boolean {
  return E164_PATTERN.test(value)
}

/**
 * What the current entry is, as far as we can tell.
 *
 * `incomplete` exists so a half-typed number is not called wrong while the rep is
 * still typing — three digits into a ten-digit number is not an error, it is a
 * number in progress. Only `ambiguous` and `invalid` are worth saying out loud.
 */
export type DialEntry =
  | { status: 'empty' }
  /** Too short to be anything yet. Say nothing; the rep is mid-word. */
  | { status: 'incomplete' }
  /** Digits with no country to read them in. Refuse rather than guess. */
  | { status: 'ambiguous' }
  /** Long enough to judge, and it is not a number that exists. */
  | { status: 'invalid' }
  | { status: 'valid'; e164: string }

/**
 * Reduce typed or pasted text to the two things that carry meaning: digits, and a
 * leading `+`.
 *
 * A `+` typed mid-number is a slip, so only the first position keeps one. `00` is
 * how most of the world dials out of its country, so it is folded into the `+` it
 * stands for — no national plan starts a number with `00`, so nothing is lost.
 */
export function sanitizeEntry(raw: string): string {
  const compact = raw.replace(/[^\d+]/g, '')
  const digits = compact.replace(/\+/g, '')
  if (compact.startsWith('+')) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  return digits
}

/**
 * The country to read bare digits in, taken from the number the rep calls out on.
 *
 * A rep whose line is `+14155550100` types ten digits and means a US number. There
 * is no other honest source for this: the browser's locale says where the person
 * is, not which line they dial from.
 */
export function defaultCountryOf(e164: string | null | undefined): CountryCode | undefined {
  if (!e164) return undefined
  return parsePhoneNumberFromString(e164)?.country
}

/**
 * Read the entry. The `e164` on a `valid` result is exactly what gets POSTed.
 *
 * The refusal that matters is `ambiguous`: bare digits with no default country.
 * `442071838750` is a London number, but read as a NANP number it is a real
 * Bermuda one — a wrong call, not a failed one. Without a country to read it in,
 * this returns `ambiguous` and the rep types the `+` themselves.
 */
export function readEntry(raw: string, defaultCountry?: CountryCode): DialEntry {
  const entry = sanitizeEntry(raw)
  if (!entry || entry === '+') return { status: 'empty' }

  if (!entry.startsWith('+') && !defaultCountry) return { status: 'ambiguous' }

  if (validatePhoneNumberLength(entry, defaultCountry) === 'TOO_SHORT') {
    return { status: 'incomplete' }
  }

  const parsed = parsePhoneNumberFromString(entry, defaultCountry)
  // `isValid()` is what catches a foreign number typed without its `+`: prefixing
  // the default country's code produces a number that does not exist.
  if (!parsed || !parsed.isValid() || !isE164(parsed.number)) return { status: 'invalid' }
  return { status: 'valid', e164: parsed.number }
}

/**
 * Format the entry the way the rep would write it — `(202) 555-0123`, `+44 20 7183
 * 8750`.
 *
 * If the formatter would change which digits are on screen, the raw entry wins. A
 * field that silently eats a keystroke is worse than one that shows plain digits.
 */
export function formatEntry(raw: string, defaultCountry?: CountryCode): string {
  const entry = sanitizeEntry(raw)
  if (!entry) return ''
  const formatted = new AsYouType(defaultCountry).input(entry)
  return sanitizeEntry(formatted) === entry ? formatted : entry
}

/**
 * What to say under the field, or null when there is nothing worth saying.
 *
 * Lives beside the statuses it maps from so a new status cannot ship without one.
 */
export function entryMessage(entry: DialEntry): string | null {
  switch (entry.status) {
    case 'ambiguous':
      return 'Start with + and the country code, like +12025550123.'
    case 'invalid':
      return 'That is not a number we can call. Check the digits.'
    default:
      return null
  }
}

/**
 * The keys shown while the rep is entering a number.
 *
 * No `*` or `#`. Those answer a menu on a CONNECTED call; inside a number they
 * make the entry unparseable, so they would be keys that break the thing they are
 * pressed into. `+` takes their place, which is what reaches a number abroad.
 * `0` keeps the middle of the bottom row, where a phone puts it.
 */
export const ENTRY_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0'] as const

/** The keys shown during a live call, where `*` and `#` are real DTMF tones. */
export const IN_CALL_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '*',
  '0',
  '#',
] as const
