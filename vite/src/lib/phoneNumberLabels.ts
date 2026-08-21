/**
 * Human labels for a phone number's enum fields, and the price string a search
 * result shows.
 *
 * A raw enum value is never shown to a person (frontend.md → Page and section
 * structure: "Never show a raw enum value"), so the status mapping lives here,
 * once, rather than inline in the settings pane.
 */
import type { PhoneNumber } from '@/lib/phoneNumberTypes'

/**
 * The one line the Status column shows. `active` splits in two: the number that
 * is the outbound caller ID reads "Active caller ID", every other dialable number
 * reads "Ready" — the status alone does not say which one calls go out on, so the
 * label says it instead of leaving the reader to guess.
 */
export function getPhoneNumberStatusLabel(
  number: Pick<PhoneNumber, 'status' | 'isActiveForOutbound'>,
): string {
  switch (number.status) {
    case 'searching':
      return 'Provisioning…'
    case 'releasing':
      return 'Releasing…'
    case 'failed':
      return 'Failed'
    case 'active':
      return number.isActiveForOutbound ? 'Active caller ID' : 'Ready'
    default:
      return number.status
  }
}

// Twilio quotes local-number prices in a handful of currencies. A symbol reads
// cleaner than a code where we have one; anything else falls back to the code so
// the amount is never shown bare.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  CAD: '$',
  AUD: '$',
  GBP: '£',
  EUR: '€',
}

/**
 * The monthly price a search result shows, e.g. "$1.15/mo". `priceMonthly` is the
 * exact string Twilio quoted, so it is never parsed or rounded on the way to the
 * screen. A `null` price (Twilio quoted nothing) reads as a dash.
 */
export function formatMonthlyPrice(priceMonthly: string | null, priceUnit: string): string {
  if (priceMonthly === null) return '—'
  const symbol = CURRENCY_SYMBOL[priceUnit]
  return symbol ? `${symbol}${priceMonthly}/mo` : `${priceMonthly} ${priceUnit}/mo`
}
