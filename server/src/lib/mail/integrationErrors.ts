// integrationErrors.ts — the stable OAuth error-CODE table for the Integration Hub.
//
// THESE STRINGS ARE AN API. The client keys its recovery steps off them
// (`ERROR_CODE_RECOVERY` in the hub UI maps each code to what the rep should click
// or ask for), so they DO NOT CHANGE CASUALLY. Renaming `admin_approval_required`
// is a breaking change to the front end, not a refactor. Add codes freely; rename
// or remove one only on purpose, and update the client in the same change.
//
// This is distinct from mailErrors.ts. That file holds the typed *exception
// classes* the seam throws at runtime (MailAuthError, RateLimitedError, …). This
// file holds the machine-readable *status codes* a connection is stamped with and
// the mapper that turns a provider's own error string into one of them. A provider
// speaks its own dialect — Google says `admin_policy_enforced`, Microsoft says
// `AADSTS65001`, and they mean the same thing to a rep. `mapProviderError`
// collapses that dialect onto one stable vocabulary so the client never has to know
// which provider a card is for.

import type { Provider } from '../oauthScopes.js'
import { logger } from '../../../dependencies/logger.js'

/**
 * Every stable error code a connection can carry. This is the closed set the
 * callback writes and the client reads; `mapProviderError` only ever returns one of
 * these, never a raw provider string.
 *
 * Each is lowercase snake_case and names the SITUATION, never the provider — a code
 * is shared by both Google and Microsoft, so a provider name in one would be a lie
 * on the other. What each one means, and why it is its own code and not a variant
 * of another:
 *
 * - `partial_access`         — some scopes granted, some refused. The card is amber,
 *                              not red; the repair asks for only the missing scopes.
 * - `token_revoked`          — the grant was valid and is now dead (user revoked it,
 *                              password changed, refresh token expired). Reconnect.
 * - `missing_refresh_token`  — consent completed but no refresh token came back, so
 *                              the grant cannot outlive its first hour. Never green.
 * - `admin_approval_required`— the org's admin, not the rep, must allow the app. The
 *                              fix is "ask your admin", so retrying alone never works.
 * - `user_cancelled`         — the rep closed the consent screen or clicked deny.
 *                              Not an error to alarm anyone with; just try again.
 * - `state_invalid`          — the signed `state` failed verification or expired. A
 *                              stale popup or a tampered callback. Start over.
 * - `token_exchange_failed`  — the code-for-token POST itself failed for a reason
 *                              that is not one of the more specific codes below.
 * - `identity_fetch_failed`  — tokens obtained, but the "which account is this?"
 *                              call failed, so we cannot name the mailbox. Retry.
 * - `account_mismatch`       — a targeted reconnect authenticated as a different
 *                              provider identity. Retry with the original mailbox.
 * - `token_unreadable`       — a stored ciphertext would not decrypt (key rotated,
 *                              corruption). The connection must be re-made.
 * - `provider_unreachable`   — the provider's endpoint could not be reached at all
 *                              (network, DNS, 5xx). Transient; retry later.
 * - `redirect_uri_mismatch`  — the redirect URI sent does not match the one the
 *                              provider has registered. A config bug, not a rep bug.
 * - `client_secret_invalid`  — the app's own client credentials were rejected. A
 *                              config bug on our side; no rep action fixes it.
 * - `unknown`                — nothing above matched. The client still renders a
 *                              recovery block; the raw code is logged so this table
 *                              can grow from real traffic.
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
  'account_mismatch',
  'token_unreadable',
  'provider_unreachable',
  'redirect_uri_mismatch',
  'client_secret_invalid',
  'unknown',
] as const

/** One of the stable codes above. What a connection's `errorCode` column holds. */
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number]

// --- Provider dialects, mapped onto the stable vocabulary above ---

// Microsoft surfaces its real reason as an `AADSTS<n>` code, and usually buries it
// inside a long `error_description` rather than the bare `error` field. So these are
// matched as case-insensitive SUBSTRINGS of the raw string, not by exact equality.
const MICROSOFT_AADSTS: ReadonlyArray<readonly [string, IntegrationErrorCode]> = [
  ['AADSTS65001', 'admin_approval_required'], // user or admin has not consented to the app
  ['AADSTS90094', 'admin_approval_required'], // admin consent is required for this app
  ['AADSTS65004', 'user_cancelled'], // user declined to consent at the prompt
  ['AADSTS70000', 'token_revoked'], // invalid grant — the refresh token is no longer good
  ['AADSTS50011', 'redirect_uri_mismatch'], // reply URL does not match a registered one
  ['AADSTS7000215', 'client_secret_invalid'], // an invalid client secret was provided
]

// Standard OAuth 2.0 `error` values (RFC 6749). Both providers speak these, so they
// are matched for either. Compared against the lowercased, trimmed raw string.
const OAUTH_ERROR: Readonly<Record<string, IntegrationErrorCode>> = {
  access_denied: 'user_cancelled',
  invalid_grant: 'token_revoked',
  redirect_uri_mismatch: 'redirect_uri_mismatch',
  invalid_client: 'client_secret_invalid',
  unauthorized_client: 'client_secret_invalid',
  temporarily_unavailable: 'provider_unreachable',
}

// Google-specific error strings that are not standard OAuth values.
const GOOGLE_ERROR: Readonly<Record<string, IntegrationErrorCode>> = {
  admin_policy_enforced: 'admin_approval_required', // a Workspace admin blocks the app/scope
  org_internal: 'admin_approval_required', // the app is restricted to another org's users
}

/**
 * Map a provider's own error string onto a stable {@link IntegrationErrorCode}.
 *
 * Always returns a code from {@link INTEGRATION_ERROR_CODES}, never the provider's
 * raw string. The lookup runs provider-specific dialects first (Microsoft's AADSTS
 * substrings, Google's non-standard strings), then the shared OAuth 2.0 vocabulary.
 *
 * Anything unmatched becomes `unknown` **and is logged with the raw code** — that is
 * the only branch that logs, and it is deliberate: the log line is how this table
 * grows from real traffic. A code that keeps showing up as `unknown` is a code that
 * deserves its own entry.
 */
export function mapProviderError(provider: Provider, raw: string): IntegrationErrorCode {
  const trimmed = (raw ?? '').trim()

  if (trimmed) {
    if (provider === 'microsoft') {
      const upper = trimmed.toUpperCase()
      for (const [aadsts, code] of MICROSOFT_AADSTS) {
        if (upper.includes(aadsts)) return code
      }
    }

    if (provider === 'google') {
      const google = GOOGLE_ERROR[trimmed.toLowerCase()]
      if (google) return google
    }

    const shared = OAUTH_ERROR[trimmed.toLowerCase()]
    if (shared) return shared
  }

  // Unmapped: fall back to `unknown` and log the raw code so the table can grow.
  // The raw provider error code is not a secret or a token — logging it is the point.
  logger.warn(
    { provider, rawErrorCode: trimmed || String(raw) },
    'unmapped integration provider error mapped to unknown',
  )
  return 'unknown'
}
