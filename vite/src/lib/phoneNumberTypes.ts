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

/** The carrier-facing lifecycle for a requested caller-ID name. */
export type CallerNameStatus = 'not_requested' | 'pending' | 'active' | 'failed' | 'unsupported'

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
  /** The desired CNAM value. It remains saved when the request is disabled. */
  callerName?: string | null
  /** The carrier-facing state, never a guarantee about a recipient display. */
  callerNameStatus?: CallerNameStatus
  /** Actionable carrier explanation when registration failed or is unsupported. */
  callerNameFailureReason?: string | null
  /** Whether this number is currently queued for caller-name registration. */
  isCallerNameRequested?: boolean
  createdAt: string
}

/** The server fields each Numbers table may sort by. */
export const PHONE_NUMBER_SORT_COLUMNS = ['e164', 'status', 'createdAt'] as const
export type PhoneNumberSortColumn = (typeof PHONE_NUMBER_SORT_COLUMNS)[number]

/** A server-backed Numbers table request. Omit it to read the complete caller-ID list. */
export interface GetPhoneNumbersParams {
  page?: number
  limit?: number
  sort?: PhoneNumberSortColumn
  dir?: 'asc' | 'desc'
  /** A partial E.164 number, such as "201" or "+1201". */
  q?: string
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
  /** How many matching numbers are dialable, including rows outside the current page. */
  readyCount: number
  /** Present when this is a server-backed table response. */
  page?: number
  /** Present when this is a server-backed table response. */
  limit?: number
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

/**
 * The holder of a number, as the admin view shows it — enough to tell two reps
 * apart by name or by email. Mirrors `ASSIGNEE_SELECT` in
 * `server/src/routes/phoneNumbers.ts`.
 */
export interface PhoneNumberAssignee {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
}

/**
 * One number the org owns, from the admin-only org-wide view
 * (`mapOrgPhoneNumberToApi`). `assignedUser` is `null` when the org holds the
 * number and nobody has it yet — a real state since MAI-197, not a missing
 * lookup.
 */
export interface OrgPhoneNumber extends PhoneNumber {
  assignedUser: PhoneNumberAssignee | null
}

/** What GET .../phone-numbers/all returns: every number in the org, plus totals. */
export interface GetOrgNumbersResponse {
  numbers: OrgPhoneNumber[]
  total: number
  /** How many of the returned rows nobody holds. */
  unassignedCount: number
  /** Present when this is a server-backed table response. */
  page?: number
  /** Present when this is a server-backed table response. */
  limit?: number
}

/** What PATCH .../assignment returns: the number, with its new holder. */
export interface OrgPhoneNumberResponse {
  number: OrgPhoneNumber
}
