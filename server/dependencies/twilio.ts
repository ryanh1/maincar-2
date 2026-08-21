import twilio, { type Twilio } from 'twilio'

import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from '../src/config.js'

// The Twilio SDK is constructed HERE and nowhere else
// (CLAUDE.md → Third-party APIs / SDKs). Route and service code calls the
// functions below; it never touches the SDK, and never sees an SDK shape.
//
// Everything here is translation: SDK call in, plain object out. No business
// logic, no org lookups, no HTTP status decisions — those belong to the route.

let client: Twilio | null = null

/**
 * The shared client, built on first use.
 *
 * Lazy on purpose. The credentials are read as `?? ''` in config rather than
 * `required()`, because `/api/health` and the whole unit suite have to boot on a
 * machine with no Twilio account. Constructing at import time would take the
 * process down instead. So the failure lands at CALL time, on the one request
 * that actually needed Twilio, and names the vars that are missing.
 */
function getTwilioClient(): Twilio {
  if (client) return client

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error(
      'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env ' +
        '(see .env.example).',
    )
  }

  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  return client
}

/** One number Twilio is offering for sale. */
export interface AvailableNumber {
  /** E.164, e.g. "+14155550123". Twilio's `phoneNumber`. */
  e164: string
  /** Twilio's own display form, e.g. "(415) 555-0123". */
  friendly: string
}

/**
 * What Twilio charges per month to rent a local number in a country.
 *
 * `amount` is a decimal STRING ("1.15"), not a float. Money crosses this
 * boundary as text so nothing between Twilio and the browser can round it, and
 * so the value we show is byte-for-byte the value Twilio quoted.
 *
 * `amount` is null when Twilio's pricing response carries no `local` entry for
 * the country. Null means "Twilio did not quote one" — never a stand-in price.
 */
export interface LocalNumberMonthlyPrice {
  amount: string | null
  /** Twilio's `priceUnit`, e.g. "USD". Uppercased. */
  currency: string
}

export interface AvailableNumberSearch {
  /** ISO-3166-1 alpha-2, e.g. "US". */
  country: string
  /** NANP area code as three digits. Twilio applies it to US and CA only. */
  areaCode?: string
  /** Digits/letters the number must contain; `*` is Twilio's single-char wildcard. */
  contains?: string
  limit: number
}

/**
 * Local numbers Twilio currently has for sale in a country.
 *
 * Note what this does NOT return: a price. Twilio's available-numbers API
 * quotes no per-number figure, so none is invented here — the monthly rental
 * comes from `getLocalNumberMonthlyPrice` below, which is a separate Twilio API.
 */
export async function listAvailableLocalNumbers(
  search: AvailableNumberSearch,
): Promise<AvailableNumber[]> {
  const numbers = await getTwilioClient()
    .availablePhoneNumbers(search.country)
    .local.list({
      ...(search.areaCode ? { areaCode: Number(search.areaCode) } : {}),
      ...(search.contains ? { contains: search.contains } : {}),
      limit: search.limit,
    })

  return numbers.map((n) => ({ e164: n.phoneNumber, friendly: n.friendlyName }))
}

/**
 * The list price to rent one local number in a country, for a month.
 *
 * This is Twilio's COUNTRY-level price for the `local` number type — the only
 * monthly figure Twilio publishes. It is the same for every number in a search
 * result, which is exactly why it is fetched once here rather than pretended to
 * be a property of each number.
 */
export async function getLocalNumberMonthlyPrice(
  country: string,
): Promise<LocalNumberMonthlyPrice> {
  const pricing = await getTwilioClient().pricing.v1.phoneNumbers.countries(country).fetch()

  const local = pricing.phoneNumberPrices?.find((p) => p.numberType === 'local')
  // currentPrice is what the account pays today; basePrice is list. Twilio types
  // both as number but sends them as JSON strings, so String() normalizes either.
  const raw = local?.currentPrice ?? local?.basePrice

  return {
    amount: raw === undefined || raw === null ? null : String(raw),
    currency: (pricing.priceUnit ?? 'USD').toUpperCase(),
  }
}

/**
 * The HTTP status Twilio attached to a failure, or null if it was not a Twilio
 * REST error at all.
 *
 * Exported so a route can tell "you asked for a country Twilio does not sell in"
 * (a 404 from Twilio, which is the caller's mistake) from "Twilio is down"
 * (everything else) WITHOUT importing the SDK's exception class.
 */
export function twilioErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}
