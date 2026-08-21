/**
 * The client's view of the Integration Hub, plus the two copy tables that turn a
 * stable server error code into something a rep can act on.
 *
 * The shapes here MIRROR the server and add nothing the API does not send:
 *  - `IntegrationCard`      — one entry per provider (GET /api/integrations/orgs/:orgId),
 *                             built server-side so the client never owns the provider list.
 *  - `IntegrationConnection`— the token-free connection row (server `SerializedConnection`),
 *                             with Dates as ISO strings because that is what JSON carries.
 *  - `CapabilityResult`     — one probe's verdict from the Test button.
 *  - `TestConnectionResponse` — what POST …/:connectionId/test returns.
 *  - `BrokenConnection`     — the slim row GET …/health returns and the badge counts.
 *
 * `INTEGRATION_ERROR_CODES` is the client copy of the server's closed set
 * (server/src/lib/mail/integrationErrors.ts). Those strings are an API: the recovery
 * table below keys off them. When the server adds or renames a code, this list and
 * `ERROR_CODE_RECOVERY` change in the SAME commit — a test asserts the two never drift.
 */

/** The two providers Maincar integrates. Mirrors `Provider` in server oauthScopes.ts. */
export type Provider = 'google' | 'microsoft'

/**
 * A connection's health, the closed set the card colours from. `connected` only when
 * every permission is present; `limited` the instant one is missing; `error` for a hard
 * break the rep did not choose. Never colour alone — the card carries a word and an icon.
 */
export type ConnectionStatus = 'connected' | 'limited' | 'error'

/**
 * Every stable error code a connection can carry — the client copy of the server's
 * closed set. Kept in sync by hand (the server file says so) and by a drift test that
 * asserts `ERROR_CODE_RECOVERY` has exactly these keys.
 */
export const INTEGRATION_ERROR_CODES = [
  'partial_access',
  'token_revoked',
  'missing_refresh_token',
  'admin_approval_required',
  'user_cancelled',
  'state_invalid',
  'token_exchange_failed',
  'identity_fetch_failed',
  'token_unreadable',
  'provider_unreachable',
  'redirect_uri_mismatch',
  'client_secret_invalid',
  'unknown',
] as const

/** One of the stable codes above. What a connection's `errorCode` holds. */
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number]

/** The three capabilities the Test button probes. Mirrors server `Capability`. */
export type Capability = 'read_email' | 'send_email' | 'calendar'

/**
 * The token-free connection row. Mirrors the server `SerializedConnection`, except the
 * three timestamps arrive as ISO strings over the wire, not `Date`s (as `callTypes.ts`
 * does). `errorCode` is narrowed to the closed set, since the recovery table keys off it.
 */
export interface IntegrationConnection {
  id: string
  provider: string
  providerAccountId: string
  emailAddress: string
  scopes: string[]
  status: ConnectionStatus
  errorCode: IntegrationErrorCode | null
  statusDetail: string | null
  lastValidatedAt: string | null
  lastRefreshAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * One card the hub renders, one per PROVIDER. The client does not own `providerLabel`
 * or `requiredPermissions` — the server sends the copy so it lives in one place.
 * `connection: null` is a provider the rep has not connected — "Not connected".
 */
export interface IntegrationCard {
  provider: Provider
  /** The full product name ("Google Workspace"), for the card title only. */
  providerLabel: string
  /** The short name ("Google"), for buttons, toasts, and the disconnect dialog. */
  providerShortName: string
  /** The plain-words permissions Maincar asks for, shown on the card. */
  requiredPermissions: string[]
  connection: IntegrationConnection | null
}

/**
 * One capability's verdict from the Test button. Mirrors server `CapabilityResult`.
 * `label` is the SAME plain-words permission the card shows, so both agree; `reason`
 * is empty when `ok`.
 */
export interface CapabilityResult {
  capability: Capability
  label: string
  ok: boolean
  reason: string
  errorCode: IntegrationErrorCode | null
}

/**
 * The `result` a Test returns: a verdict PER capability, never a bare boolean, so the
 * rep learns WHICH permission is broken. `connection` is the just-written status the
 * card re-renders from.
 */
export interface TestConnectionResult {
  ok: boolean
  detail: string
  errorCode: IntegrationErrorCode | null
  capabilities: CapabilityResult[]
  connection: IntegrationConnection | null
}

/** What POST …/:connectionId/test returns, wrapped in `result` like the server keys it. */
export interface TestConnectionResponse {
  result: TestConnectionResult
}

/**
 * The slim broken-connection row GET …/health returns. Mirrors server `BrokenConnection`:
 * enough to count and to deep-link to the fix, and nothing more — no token, no scopes.
 */
export interface BrokenConnection {
  connectionId: string
  provider: Provider
  providerLabel: string
  emailAddress: string
  errorCode: IntegrationErrorCode | null
  detail: string
}

/** What GET /api/integrations/orgs/:orgId returns: one card per provider, wrapped. */
export interface GetIntegrationsResponse {
  integrations: IntegrationCard[]
}

/** What GET …/health returns: only the connections stamped `error`, wrapped. */
export interface GetIntegrationHealthResponse {
  broken: BrokenConnection[]
}

/** What POST …/authorize returns: the consent URL the client opens in its popup. */
export interface AuthorizeResponse {
  url: string
}

/** What POST …/refresh returns: the re-evaluated, token-free connection, wrapped. */
export interface ConnectionResponse {
  connection: IntegrationConnection
}

// --- The recovery table ------------------------------------------------------
//
// Every card that is not fully healthy renders a recovery block. NO error line ever
// ships without a next action (SPEC-int-hub-ui.md AC 5): each `fixes` entry ends in
// something the rep can click ("Reconnect", "Fix permissions", "Test") or ask for
// ("ask your administrator", "contact support"). Every code the server can stamp has
// an entry here, and so does `unknown`, so a code the client has never seen still
// renders a block instead of a blank card.

/** A title and the concrete next steps for one error code. Steps are never empty. */
export interface ErrorCodeRecovery {
  /** What to do, in a few words. Names an action, never just states the problem. */
  title: string
  /** One or more steps, each ending in something the rep can click or ask for. */
  fixes: string[]
}

/**
 * A recovery block per stable error code. Keyed by `IntegrationErrorCode` so a card
 * looks its `errorCode` up directly; an unrecognised code falls back to `unknown`.
 * Every string obeys rules/copy.md: one sentence, says what to do, "organization"
 * never "workspace".
 */
export const ERROR_CODE_RECOVERY: Record<IntegrationErrorCode, ErrorCodeRecovery> = {
  partial_access: {
    title: 'Grant the missing permission',
    fixes: ['Click Fix permissions and approve the one Maincar still needs.'],
  },
  token_revoked: {
    title: 'Reconnect to restore access',
    fixes: ['Click Reconnect and sign in to the same account.'],
  },
  missing_refresh_token: {
    title: 'Reconnect and keep Maincar signed in',
    fixes: ['Click Reconnect, and leave "stay signed in" selected at the consent screen.'],
  },
  admin_approval_required: {
    title: 'Ask your admin to approve Maincar',
    fixes: ["Ask your organization's administrator to approve Maincar, then click Reconnect."],
  },
  user_cancelled: {
    title: 'Connect again to finish',
    fixes: ['Click Connect and approve every permission Maincar asks for.'],
  },
  state_invalid: {
    title: 'Start the connection again',
    fixes: ['Click Connect to start a fresh connection.'],
  },
  token_exchange_failed: {
    title: 'Try connecting again',
    fixes: ['Click Reconnect to try again.', 'If it keeps failing, contact support.'],
  },
  identity_fetch_failed: {
    title: 'Try connecting again',
    fixes: ['Click Reconnect to try again.', 'If it keeps failing, contact support.'],
  },
  token_unreadable: {
    title: 'Reconnect to restore access',
    fixes: ['Click Reconnect to grant access again.'],
  },
  provider_unreachable: {
    title: 'Try again shortly',
    fixes: ['Wait a moment, then click Test again.'],
  },
  redirect_uri_mismatch: {
    title: 'Contact support to fix the setup',
    fixes: ['Contact Maincar support so we can fix the connection setup.'],
  },
  client_secret_invalid: {
    title: 'Contact support to fix the setup',
    fixes: ['Contact Maincar support so we can fix the connection setup.'],
  },
  unknown: {
    title: 'Reconnect, or contact support',
    fixes: ['Click Reconnect to try again.', 'If it keeps failing, contact support.'],
  },
}

/**
 * Look up the recovery block for a code, falling back to `unknown` so an unrecognised
 * `errorCode` still renders a block rather than a blank card. `null` (no error) also
 * lands on `unknown`, but the card only calls this when it has a code to show.
 */
export function recoveryFor(code: IntegrationErrorCode | null | undefined): ErrorCodeRecovery {
  if (code && code in ERROR_CODE_RECOVERY) return ERROR_CODE_RECOVERY[code]
  return ERROR_CODE_RECOVERY.unknown
}

// --- Before you connect ------------------------------------------------------
//
// The two failures that look like bugs when they hit a rep cold (SPEC-int-hub-ui.md
// AC 6): Google's unverified-app warning and its admin block, and Microsoft's admin
// approval requirement. A not-connected card shows the notes for its own provider,
// so the rep is warned before they meet the screen, not after.

/** One pre-connect warning, tied to the provider whose consent screen shows it. */
export interface PreConnectNote {
  provider: Provider
  note: string
}

/** The warnings a not-connected card shows under "Before you connect", per provider. */
export const PRE_CONNECT_NOTES: readonly PreConnectNote[] = [
  {
    provider: 'google',
    note: 'Google warns that this app is not verified. Choose Advanced, then continue.',
  },
  {
    provider: 'google',
    note: 'If you see "Access blocked", your Google Workspace admin must allow Maincar in Security → API controls.',
  },
  {
    provider: 'microsoft',
    note: 'If you see "Need admin approval", your Microsoft 365 admin must approve Maincar first.',
  },
]

/** The pre-connect notes for one provider, in order. */
export function preConnectNotesFor(provider: Provider): string[] {
  return PRE_CONNECT_NOTES.filter((n) => n.provider === provider).map((n) => n.note)
}

// --- Card subtitle ------------------------------------------------------------

/** What the connection is for, per provider — shown under the title on every card. */
export const CARD_SUBTITLE: Record<Provider, string> = {
  google: 'Read and send from Gmail mailboxes.',
  microsoft: 'Read and send from Outlook mailboxes.',
}

// --- The OAuth popup message -------------------------------------------------
//
// Consent runs in a popup; the callback page posts its result back to the opener,
// TARGETED AT THE APP'S OWN ORIGIN. The listener trusts a `message` only from that
// origin AND only when its `data` is this shape, so a foreign frame posting garbage
// can never be mistaken for a finished consent.

/** The `type` on the callback's postMessage. The one place this literal lives. */
export const OAUTH_MESSAGE_TYPE = 'maincar:oauth-result'

/** The message the callback page posts to `window.opener`. Mirrors the server payload. */
export interface OAuthPopupMessage {
  type: typeof OAUTH_MESSAGE_TYPE
  provider: Provider | null
  ok: boolean
  status: ConnectionStatus
  errorCode: IntegrationErrorCode | null
  statusDetail: string
  emailAddress: string | null
}

/**
 * Narrow an unknown `MessageEvent.data` to an {@link OAuthPopupMessage}.
 *
 * Checks the tag and the shape of every field, so a `message` event from a foreign
 * frame — or a browser extension posting its own traffic — is rejected even when it
 * arrives from the right origin. The listener still checks the origin FIRST; this is
 * the second gate, not a replacement for it.
 */
export function isOAuthPopupMessage(data: unknown): data is OAuthPopupMessage {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (d.type !== OAUTH_MESSAGE_TYPE) return false
  if (typeof d.ok !== 'boolean') return false
  if (d.status !== 'connected' && d.status !== 'limited' && d.status !== 'error') return false
  if (typeof d.statusDetail !== 'string') return false
  if (!(d.provider === null || d.provider === 'google' || d.provider === 'microsoft')) return false
  if (!(d.errorCode === null || typeof d.errorCode === 'string')) return false
  if (!(d.emailAddress === null || typeof d.emailAddress === 'string')) return false
  return true
}
