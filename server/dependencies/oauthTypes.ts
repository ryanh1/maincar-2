// oauthTypes.ts — the provider-agnostic OAuth contract. ONE shape that Google and
// Microsoft each implement, so the rest of the app switches on provider in exactly
// one place (server/src/lib/mail/oauthProviders.ts) and never learns which provider
// is underneath.
//
// This file lives under dependencies/ beside the two clients that implement it. It
// pulls in the {@link Provider} union from the scope table (the one place "google"
// and "microsoft" are named) rather than redeclaring it, so there is a single
// source of truth for what a provider is.

import type { Provider } from '../src/lib/oauthScopes.js'

/** What a caller supplies to build a provider's consent URL. */
export interface AuthorizeUrlInput {
  /** Every scope string to request — evaluable plus authorize-only. From allRequestedScopes(). */
  scopes: string[]
  /** The signed, opaque `state` (CSRF + who-consented). Passed through verbatim. */
  state: string
  /** The PKCE `S256` code challenge. The verifier is kept by the caller for exchange. */
  codeChallenge: string
  /**
   * The address to pre-fill on the consent screen. Set on `mode: 'fix'` so the rep
   * is not asked which account they mean when repairing one they already connected.
   */
  loginHint?: string
}

/** What a caller supplies to trade an authorization code for tokens. */
export interface ExchangeCodeInput {
  /** The one-time `code` the provider put on the callback URL. Never logged. */
  code: string
  /** The PKCE verifier whose challenge went out in the authorize URL. */
  codeVerifier: string
}

/**
 * The tokens and grant a provider hands back from a code exchange or a refresh.
 *
 * `grantedScopes` is what the provider reported it ACTUALLY granted, verbatim — it
 * is routinely a subset of what was requested, and the whole amber state of the hub
 * depends on reading the granted set honestly instead of assuming the requested one.
 */
export interface TokenGrant {
  accessToken: string
  /**
   * The refresh token, or null when the provider returned none. Google returns one
   * only when consent was forced; a null here is what the callback turns into
   * `missing_refresh_token` rather than a green connection.
   */
  refreshToken: string | null
  /** Absolute expiry of the access token, in UTC. Derived from the provider's `expires_in`. */
  expiresAt: Date
  /** The scopes the provider says it granted — NOT the requested list. */
  grantedScopes: string[]
}

/** Who a set of tokens belongs to, resolved from the provider's identity endpoint. */
export interface ProviderIdentity {
  /** The provider's stable account id (Google `sub`, Microsoft `id`). Never the email. */
  providerAccountId: string
  /** The mailbox address the tokens act as. What the hub card names. */
  emailAddress: string
}

/**
 * The four operations every provider's OAuth half must implement. A registry maps a
 * provider string to one of these, and every route and job holds this type, never a
 * concrete client.
 */
export interface OAuthClient {
  /** Which provider this client speaks for. Lets the registry stay a plain map. */
  readonly provider: Provider
  /** Build the consent URL to open in the rep's popup. PKCE `S256`; never redirects. */
  buildAuthorizeUrl(input: AuthorizeUrlInput): string
  /** Trade a `code` (+ PKCE verifier) for tokens and the GRANTED scopes. */
  exchangeCode(input: ExchangeCodeInput): Promise<TokenGrant>
  /** Trade a refresh token for a fresh access token (and, under rotation, a new refresh token). */
  refreshAccessToken(refreshToken: string): Promise<TokenGrant>
  /** Resolve which account a live access token belongs to, to name the mailbox. */
  fetchIdentity(accessToken: string): Promise<ProviderIdentity>
}

/**
 * A provider rejected an OAuth call and named a reason. `code` is the provider's OWN
 * error string, untranslated — `invalid_grant`, `AADSTS65001`, `admin_policy_enforced`.
 *
 * It is deliberately the RAW string, not a mapped {@link IntegrationErrorCode}: the
 * route maps it onto the stable vocabulary with `mapProviderError(provider, err.code)`
 * so the mapping lives in one place. It is also named `code` — the exact property
 * oauthConnections.withFreshAccessToken() inspects — so a refresh that fails with
 * `invalid_grant` is recognised as a revocation and stamps the row `token_revoked`.
 *
 * The raw provider error string is not a secret and carries no token, so it is safe
 * to log and to attach here. The `code` and `error_description` are all this ever holds.
 */
export class OAuthProviderError extends Error {
  /** The provider's raw error string (e.g. `invalid_grant`). Fed to mapProviderError. */
  readonly code: string
  /** The provider's HTTP status, when the failure was an HTTP response. */
  readonly httpStatus?: number

  constructor(code: string, description?: string, httpStatus?: number) {
    super(description && description !== code ? `${code}: ${description}` : code)
    this.name = 'OAuthProviderError'
    this.code = code
    this.httpStatus = httpStatus
  }
}
