/**
 * The client's view of the phone numbers an org owns and the numbers Twilio has
 * for sale.
 *
 * These mirror the two mappers in `server/src/routes/phoneNumbers.ts` exactly —
 * the only shapes that ever reach the browser. `orgId` and `assignedUserId` are
 * absent on purpose: the caller is the requester and names the org in the path,
 * so the server leaves both out rather than putting a tenant key in one more
 * place that could drift.
 */

/**
 * The lifecycle of an owned number, mirroring the comments on `PhoneNumber.status`
 * in schema.prisma:
 *  - `searching` — the purchase is queued; the provisioning job has not finished.
 *  - `active` — bought and dialable; the one status you can call from.
 *  - `releasing` — on its way out, still rented until Twilio confirms.
 *  - `failed` — the purchase never happened; a retry is allowed.
 */
export type PhoneNumberStatus = 'searching' | 'active' | 'releasing' | 'failed'

/**
 * One number the org owns (`mapPhoneNumberToApi`). `twilioSid` is null until the
 * provisioning job buys the number, so it is null for every `searching` row.
 */
export interface PhoneNumber {
  id: string
  e164: string
  twilioSid: string | null
  status: PhoneNumberStatus
  isActiveForOutbound: boolean
  createdAt: string
}

/**
 * One row of the search results — a number Twilio will sell. `priceMonthly` is a
 * decimal STRING ("1.15"), the same text Twilio quoted, so nothing rounds it on
 * the way to the browser; it is Twilio's COUNTRY price for a local number, not a
 * per-number quote, and `null` when Twilio quoted nothing.
 */
export interface AvailableNumber {
  e164: string
  friendly: string
  priceMonthly: string | null
}

/** What the list route returns: the org's numbers, active first, plus the totals. */
export interface GetNumbersResponse {
  numbers: PhoneNumber[]
  total: number
  /** How many of the returned rows are active. Normally 0 or 1. */
  activeCount: number
}

/** What POST /search accepts. Only `country` is required; it defaults to US server-side. */
export interface SearchNumbersInput {
  country?: string
  /** Three digits, US/CA only. */
  areaCode?: string
  /** 2–16 letters or digits; `*` stands for any one character. */
  contains?: string
  limit?: number
}

/** What POST /search returns: the numbers for sale and the currency their prices are in. */
export interface SearchNumbersResponse {
  numbers: AvailableNumber[]
  total: number
  /** The currency code the `priceMonthly` amounts are in, e.g. "USD". */
  priceUnit: string
}

/** What POST (buy) and PATCH (set-active) each return: one number, wrapped. */
export interface PhoneNumberResponse {
  number: PhoneNumber
}
