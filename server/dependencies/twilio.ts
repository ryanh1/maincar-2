import twilio, { type Twilio } from 'twilio'

import {
  PUBLIC_BASE_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SECRET,
  TWILIO_API_KEY_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_TWIML_APP_SID,
} from '../src/config.js'

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
//
// The browser places the call directly: the rep's Device (the Voice SDK,
// vite/src/dependencies/twilioVoice.ts) connects to the TwiML Application named by
// TWILIO_TWIML_APP_SID, Twilio fetches the URL below for instructions, and the
// TwiML bridges that browser leg to the destination with <Dial><Number>. Nothing
// here calls Twilio's REST calls.create() — that was the earlier design, and it
// is what dialed the destination TWICE (once via calls.create's `to`, once via the
// TwiML's own <Dial>). One leg, one <Dial>, one call to the destination.

/**
 * The path Twilio fetches for TwiML once the rep's browser Device has a call in
 * hand — the same voice webhook a purchased number points its inbound calls at.
 * The handler tells the two apart by whether the request carries OUR `callId`
 * param (see `buildBridgeTwiml`'s caller, routes/twilioVoice.ts): only a call we
 * originated carries one, so a real inbound call to a purchased number can never
 * collide with it. This constant is where the TwiML Application's Voice Request
 * URL and `buyPhoneNumber`'s voiceUrl are both wired in from, so the three names
 * cannot drift.
 */
export const OUTBOUND_VOICE_WEBHOOK_PATH = '/api/twilio/voice'

/**
 * The path Twilio POSTs call-progress events to (initiated → ringing → answered
 * → completed) for the bridged leg. Its handler — POST /api/twilio/voice/status —
 * looks the Call row up by the SID it carries and advances its status. Named here
 * so the URL Twilio is told to call and the route that answers it are defined in
 * one place.
 */
export const OUTBOUND_STATUS_WEBHOOK_PATH = '/api/twilio/voice/status'

/**
 * The path Twilio POSTs to when a `<Dial record>` recording changes state
 * (in-progress, completed). This is the ONLY reliable source of `RecordingSid` —
 * Twilio does not add it to the call's own CallStatus callback above, because the
 * recording belongs to the `<Dial>` verb, not to the `<Number>` leg that callback
 * tracks. `buildBridgeTwiml` wires this in as `recordingStatusCallback`; its
 * handler (routes/twilioVoice.ts → POST /voice/recording-status) is where
 * `Call.recordingEnabled` is actually set, from Twilio's own confirmation.
 */
export const OUTBOUND_RECORDING_STATUS_WEBHOOK_PATH = '/api/twilio/voice/recording-status'

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

/**
 * Raised when the browser Voice SDK cannot be handed a working access token
 * because the account isn't wired up for it yet.
 *
 * A Voice access token needs THREE things beyond the account SID/auth token pair
 * every other Twilio call in this file uses: an API Key (TWILIO_API_KEY_SID +
 * TWILIO_API_KEY_SECRET, minted in the Twilio console — the account auth token
 * cannot sign one) and a TwiML Application (TWILIO_TWIML_APP_SID) whose Voice
 * Request URL is OUTBOUND_VOICE_WEBHOOK_PATH above. Thrown rather than tolerated,
 * same reasoning as WebhookBaseUrlMissingError: a rep pressing Call deserves a
 * named reason, not a Device that silently never connects.
 */
export class VoiceTokenConfigMissingError extends Error {
  constructor() {
    super(
      'Browser calling is not configured. Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, ' +
        'and TWILIO_TWIML_APP_SID in .env (see .env.example).',
    )
    this.name = 'VoiceTokenConfigMissingError'
  }
}

/** How long a minted Voice access token is good for, in seconds. */
const VOICE_ACCESS_TOKEN_TTL_SECONDS = 3600

/** A short-lived credential that lets one rep's browser register a Device. */
export interface VoiceAccessToken {
  /** The signed JWT to hand `new Device(token)` on the client. */
  token: string
  /** The identity the token was minted for — echoed back so the caller can log it. */
  identity: string
  /** Seconds until the token expires. The client refreshes on the SDK's own warning. */
  ttlSeconds: number
}

/**
 * Mint a Voice access token for one rep's browser.
 *
 * `identity` is the rep's user id: stable, unique, and never PII, so it is safe
 * to carry inside a JWT the browser holds. `incomingAllow: false` because this
 * phase is outbound-only — nothing yet routes an inbound call to a rep's Device
 * (that is inbound/voicemail work, tracked separately from this dialer).
 */
export function mintVoiceAccessToken(identity: string): VoiceAccessToken {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_TWIML_APP_SID) {
    throw new VoiceTokenConfigMissingError()
  }

  const token = new twilio.jwt.AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
    identity,
    ttl: VOICE_ACCESS_TOKEN_TTL_SECONDS,
  })
  token.addGrant(
    new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: false,
    }),
  )

  return { token: token.toJwt(), identity, ttlSeconds: VOICE_ACCESS_TOKEN_TTL_SECONDS }
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

/** Which number to bridge the browser leg to, and what caller ID to present. */
export interface BridgeCallRequest {
  /** E.164 destination — the Call row's `toE164`, already validated by the route. */
  toE164: string
  /** E.164 caller ID to present to the destination — the Call row's `fromE164`. */
  callerId: string
  /**
   * Record the bridged call. The route is responsible for this being true ONLY
   * when the Call row's `recordingConsent` is `"granted"` — this function does
   * not read consent itself, it only wires the TwiML once told to.
   */
  record: boolean
}

/**
 * TwiML that bridges the browser leg already on the line to one PSTN number:
 * `<Response><Dial callerId="+1…"><Number statusCallback="…">+1…</Number></Dial></Response>`.
 *
 * Built through the SDK's `VoiceResponse`, not string-concatenated, so the XML is
 * escaped and well-formed by construction. `<Number>` (not the bare `<Dial>` form
 * `buildDialTwiml` used) carries its own statusCallback, so THIS leg's progress —
 * ringing, answered, completed — reaches POST /voice/status exactly the way the
 * old REST-initiated call's did, even though nothing called `calls.create()` this
 * time.
 *
 * When `record` is true, the `<Dial>` itself carries `record="record-from-answer"`
 * (start once the callee answers, never during ringing) plus a
 * `recordingStatusCallback` pointed at OUTBOUND_RECORDING_STATUS_WEBHOOK_PATH —
 * the ONLY place Twilio ever delivers a `RecordingSid` for this architecture (see
 * that constant's comment). Without `record`, Twilio is never told to record at
 * all, so no recording exists and that webhook never fires for this call.
 *
 * THIS COSTS MONEY once Twilio dials it: a connected call is billed per minute,
 * and a recorded one is billed for the recording too. The route above is
 * responsible for the double-call guard that keeps one click from becoming two
 * calls; this function only builds what to tell Twilio.
 */
export function buildBridgeTwiml(request: BridgeCallRequest): string {
  if (!PUBLIC_BASE_URL) throw new WebhookBaseUrlMissingError()

  const response = new twilio.twiml.VoiceResponse()
  const dial = response.dial({
    callerId: request.callerId,
    ...(request.record
      ? {
          record: 'record-from-answer' as const,
          recordingStatusCallback: `${PUBLIC_BASE_URL}${OUTBOUND_RECORDING_STATUS_WEBHOOK_PATH}`,
          recordingStatusCallbackMethod: 'POST' as const,
          recordingStatusCallbackEvent: ['in-progress', 'completed'] as const,
        }
      : {}),
  })
  dial.number(
    {
      statusCallback: `${PUBLIC_BASE_URL}${OUTBOUND_STATUS_WEBHOOK_PATH}`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    },
    request.toE164,
  )
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

/** What Twilio reports for a call's current state, fetched fresh from its API. */
export interface FetchedCallStatus {
  /** The `CA…` SID this was fetched for. */
  sid: string
  /** Twilio's own status string, e.g. "completed", "in-progress". */
  status: string
  /** Billed duration in whole seconds, or null if Twilio has none to report yet. */
  durationS: number | null
}

/**
 * Ask Twilio directly what a call's real, current status is.
 *
 * Used by the stale-call reaper (jobs/reapStaleCalls.ts) to reconcile a call
 * stuck past the staleness threshold against the truth, rather than assuming a
 * lost status webhook means the call failed. Pure translation, like the rest of
 * this module — the reaper decides what a given status means for `Call.status`.
 */
export async function fetchCallStatus(callSid: string): Promise<FetchedCallStatus> {
  const call = await getTwilioClient().calls(callSid).fetch()
  const durationS = Number.parseInt(call.duration ?? '', 10)

  return {
    sid: call.sid,
    status: call.status,
    durationS: Number.isFinite(durationS) ? durationS : null,
  }
}

// --- Call recordings (Twilio → S3) -----------------------------------------

/** One recording's media, downloaded from Twilio as raw bytes. */
export interface RecordingMedia {
  /** The MP3 file contents. */
  data: Buffer
  /** The content type Twilio served, normally "audio/mpeg". */
  contentType: string
}

/**
 * Download one recording's MP3 from Twilio.
 *
 * Twilio serves recording MEDIA (as opposed to metadata) from a plain HTTPS URL
 * under the account, not through a typed SDK method, so this fetches it directly
 * with HTTP Basic auth — the account SID and auth token, exactly the credentials
 * the SDK client is built from. That keeps every Twilio credential read inside
 * this one module, as the rest of the file does.
 *
 * A non-2xx response is turned into an Error carrying Twilio's HTTP `status`, so
 * the job above it can make the SAME transient-vs-permanent decision it makes for
 * a Twilio REST error (see `twilioErrorStatus`): a 404 means the recording is
 * gone and no retry brings it back, while a 5xx or 429 is worth one more try.
 */
export async function fetchRecordingMp3(recordingSid: string): Promise<RecordingMedia> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error(
      'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env ' +
        '(see .env.example).',
    )
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')

  const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!response.ok) {
    // Shaped like a Twilio REST error (a numeric `status`) so twilioErrorStatus
    // reads it and the caller's retry logic does not need a second code path.
    throw Object.assign(new Error(`Twilio recording fetch failed (${response.status})`), {
      status: response.status,
    })
  }

  const body = Buffer.from(await response.arrayBuffer())
  return { data: body, contentType: response.headers.get('content-type') ?? 'audio/mpeg' }
}

/**
 * Delete a recording from Twilio.
 *
 * Called only AFTER the MP3 is safely in our own object store, so Twilio stops
 * being a second copy (and a recurring storage line item) of media we now own.
 * `remove()` is idempotent enough for our purpose: a recording already gone
 * answers 404, which the caller treats as "nothing left to delete".
 */
export async function deleteRecording(recordingSid: string): Promise<void> {
  await getTwilioClient().recordings(recordingSid).remove()
}
