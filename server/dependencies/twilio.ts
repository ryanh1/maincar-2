import twilio, { type Twilio } from 'twilio'

import { PUBLIC_BASE_URL, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from '../src/config.js'

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

/** What to buy, and how the number should be wired once Twilio owns it for us. */
export interface NumberPurchase {
  /** E.164, exactly as it came back from `listAvailableLocalNumbers`. */
  e164: string
  /** Absolute URL Twilio POSTs to when a call comes in. Built from PUBLIC_BASE_URL. */
  voiceUrl: string
  /** Optional label shown in the Twilio console. Twilio formats the number if omitted. */
  friendlyName?: string
}

/** A number Twilio has actually sold us, echoed back from its own response. */
export interface PurchasedNumber {
  /** Twilio's `PN…` SID for the number. The only proof the purchase happened. */
  sid: string
  /** E.164, as Twilio recorded it — not as we asked for it. */
  e164: string
  /** The voice webhook Twilio confirmed it saved. */
  voiceUrl: string
}

/**
 * Buy one number and configure it for voice, in a single Twilio call.
 *
 * Twilio's create-incoming-number API sets the webhooks at purchase time, so the
 * number is never live-but-unrouted the way a buy-then-configure pair would leave
 * it if the second call failed.
 *
 * `voiceReceiveMode: "voice"` tells Twilio to answer calls to this number as
 * calls rather than as inbound faxes. Capabilities themselves (voice/SMS/MMS) are
 * a property of the number Twilio sold, not something a caller can turn on.
 *
 * THIS COSTS MONEY. Every successful call rents a number for a month. The caller
 * is responsible for making sure it only ever runs once per row.
 *
 * Returns only what Twilio echoed back, so nothing downstream can persist an
 * optimistic value that Twilio never confirmed.
 */
export async function buyPhoneNumber(purchase: NumberPurchase): Promise<PurchasedNumber> {
  const bought = await getTwilioClient().incomingPhoneNumbers.create({
    phoneNumber: purchase.e164,
    voiceUrl: purchase.voiceUrl,
    voiceMethod: 'POST',
    voiceReceiveMode: 'voice',
    ...(purchase.friendlyName ? { friendlyName: purchase.friendlyName } : {}),
  })

  return { sid: bought.sid, e164: bought.phoneNumber, voiceUrl: bought.voiceUrl }
}

// --- Outbound dialing ---------------------------------------------------------

/**
 * The path Twilio fetches for TwiML once it has our outbound call in hand — the
 * same voice webhook a purchased number points its inbound calls at. The handler
 * branches on `Direction` to tell the two apart. That handler is a later issue
 * (POST /api/twilio/voice); this constant is where its outbound leg is wired in
 * from, so the two names cannot drift.
 */
export const OUTBOUND_VOICE_WEBHOOK_PATH = '/api/twilio/voice'

/**
 * The path Twilio POSTs call-progress events to (initiated → ringing → answered
 * → completed). Its handler — POST /api/twilio/voice/status — is a later issue;
 * it looks the Call row up by the SID this function returns and advances its
 * status. Named here so the URL Twilio is told to call and the route that later
 * answers it are defined in one place.
 */
export const OUTBOUND_STATUS_WEBHOOK_PATH = '/api/twilio/voice/status'

/**
 * Raised when PUBLIC_BASE_URL is not set, so no absolute webhook URL can be built.
 *
 * Thrown rather than tolerated, for the same reason the provisioning job refuses
 * a hostless voice URL: Twilio accepts a relative `url` and then can never reach
 * it, so the call would connect to nothing and drop. A named, up-front failure is
 * better than a call that silently goes nowhere.
 */
export class WebhookBaseUrlMissingError extends Error {
  constructor() {
    super(
      'PUBLIC_BASE_URL is not set, so no Twilio call webhook URL can be built. ' +
        'Set it to the public origin this API is reachable on (see .env.example).',
    )
    this.name = 'WebhookBaseUrlMissingError'
  }
}

/** What to dial, and which Call row the webhooks should tie the legs back to. */
export interface OutboundCallRequest {
  /** E.164 destination, already validated by the route. */
  to: string
  /** The caller's active outbound number, in E.164. Must be a number Twilio owns. */
  from: string
  /** The Call row's id, threaded onto the TwiML URL so the webhook can find it. */
  callId: string
}

/** What Twilio echoed back when it accepted the call. */
export interface InitiatedCall {
  /** Twilio's `CA…` SID for the call. The key the status webhook looks the row up by. */
  sid: string
  /** Twilio's own initial status for the call, e.g. "queued". */
  status: string
}

/**
 * Ask Twilio to place an outbound call.
 *
 * THIS COSTS MONEY: a connected call is billed per minute. The route above is
 * responsible for the double-call guard that keeps one click from becoming two
 * calls; this function just translates the request into the SDK call and hands
 * back only what Twilio confirmed.
 *
 * The webhook URLs are built here, from PUBLIC_BASE_URL, rather than passed in:
 * this is the one layer that already owns Twilio's webhook wiring (see
 * `buyPhoneNumber`), and keeping the config read out of the route is what lets
 * the route be unit-tested without a public origin set. A missing base is a
 * named throw, never a relative URL Twilio cannot call back.
 */
export async function initiateOutboundCall(request: OutboundCallRequest): Promise<InitiatedCall> {
  if (!PUBLIC_BASE_URL) throw new WebhookBaseUrlMissingError()

  // callId is threaded onto the TwiML URL so the voice webhook can find the row
  // even in the window before the SID this call returns has been stored.
  const twimlUrl = `${PUBLIC_BASE_URL}${OUTBOUND_VOICE_WEBHOOK_PATH}?callId=${encodeURIComponent(
    request.callId,
  )}`
  const statusCallback = `${PUBLIC_BASE_URL}${OUTBOUND_STATUS_WEBHOOK_PATH}`

  const call = await getTwilioClient().calls.create({
    to: request.to,
    from: request.from,
    url: twimlUrl,
    method: 'POST',
    statusCallback,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  })

  return { sid: call.sid, status: call.status }
}

// --- Voice webhook (Twilio → us) -------------------------------------------

/**
 * Is this request really from Twilio?
 *
 * Twilio signs every webhook: it hashes the full request URL plus the sorted
 * POST params with our auth token and sends the result as `X-Twilio-Signature`.
 * `validateRequest` recomputes that hash and compares it in constant time, so a
 * forged request — one that guessed a CallSid to move a call along, say — cannot
 * pass without the token, which only Twilio and this server hold.
 *
 * Lives here, beside the SDK, for the same reason the rest of this module does:
 * the route never imports the SDK, and a test can mock THIS function to exercise
 * the handler without minting a real signature. Returns a plain boolean — the
 * route owns the 403, as it owns every other HTTP decision.
 *
 * A missing token or a missing signature is a hard `false`, never a skipped
 * check: an unconfigured server must refuse Twilio webhooks, not wave them
 * through unverified.
 */
export function verifyTwilioSignature(args: {
  signature: string | undefined
  url: string
  params: Record<string, string>
}): boolean {
  if (!TWILIO_AUTH_TOKEN || !args.signature) return false
  return twilio.validateRequest(TWILIO_AUTH_TOKEN, args.signature, args.url, args.params)
}

/**
 * TwiML that dials one E.164 number: `<Response><Dial>+1…</Dial></Response>`.
 *
 * Built through the SDK's `VoiceResponse`, not string-concatenated, so the XML
 * is escaped and well-formed by construction. The number is passed straight
 * through — the route has already validated it as the Call row's `toE164`.
 */
export function buildDialTwiml(toE164: string): string {
  const response = new twilio.twiml.VoiceResponse()
  response.dial(toE164)
  return response.toString()
}

/**
 * An empty `<Response/>`: valid TwiML that tells Twilio to do nothing and hang
 * up. The outbound handler returns it for a Direction it does not dial, so an
 * unexpected request still gets well-formed TwiML rather than an error page.
 */
export function buildEmptyTwiml(): string {
  return new twilio.twiml.VoiceResponse().toString()
}

/** What Twilio echoed back when it accepted the hang-up. */
export interface HungUpCall {
  /** The `CA…` SID of the call that was ended. */
  sid: string
  /** Twilio's status for the call after the update, e.g. "completed". */
  status: string
}

/**
 * Ask Twilio to end a call that is already up.
 *
 * Setting a live call's `status` to "completed" is Twilio's own verb for hanging
 * it up — it drops whichever leg is connected. The route is responsible for
 * deciding a call is actually hang-up-able (a non-terminal status, with a SID
 * Twilio has accepted) before it gets here; this function is pure translation, as
 * the rest of this module is, and returns only what Twilio confirmed.
 *
 * Unlike `initiateOutboundCall`, this does not itself cost money — it stops a call
 * that is already being billed.
 */
export async function hangUpCall(callSid: string): Promise<HungUpCall> {
  const call = await getTwilioClient().calls(callSid).update({ status: 'completed' })

  return { sid: call.sid, status: call.status }
}
