// oauthProviders.ts — THE ONE PROVIDER REGISTRY. The single place a provider string
// becomes a concrete OAuth client, so every route and job switches on provider here
// and nowhere else. There is never a second registry beside this file
// (SPEC-int-oauth.md → Boundaries).
//
// Everything above this line in the stack holds the provider-agnostic OAuthClient
// type (dependencies/oauthTypes.ts); only this file knows that `google` means
// googleOAuth and `microsoft` means microsoftOAuth. Add a provider by adding one
// entry to PROVIDERS and one to REGISTRY — nothing else in the app changes.

import { googleOAuth } from '../../../dependencies/googleOAuth.js'
import { microsoftOAuth } from '../../../dependencies/microsoftOAuth.js'
import type { OAuthClient } from '../../../dependencies/oauthTypes.js'
import type { Provider } from '../oauthScopes.js'
import { registerTokenRefresher, type RefreshedGrant, type TokenRefreshInput } from './oauthConnections.js'

/**
 * The providers Maincar integrates, as a readonly tuple. The values line up with the
 * {@link Provider} union in oauthScopes.ts; {@link isProvider} is what proves an
 * untrusted string is one of them before it is used as a key anywhere.
 */
export const PROVIDERS = ['google', 'microsoft'] as const

/** The one map from a provider string to its OAuth client. The registry itself. */
const REGISTRY: Record<Provider, OAuthClient> = {
  google: googleOAuth,
  microsoft: microsoftOAuth,
}

/**
 * Narrow an untrusted value to a {@link Provider}. A `:provider` path param is
 * attacker-controlled, so no route indexes the registry, the scope table, or the
 * error map with it until this has held — an unknown provider is a 404, never a crash.
 */
export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
}

/**
 * The OAuth client for a provider. Callers pass a {@link Provider}, having already
 * proven it with {@link isProvider}, so this is a total lookup that never returns
 * undefined.
 */
export function oauthClientFor(provider: Provider): OAuthClient {
  return REGISTRY[provider]
}

/**
 * The token refresher that backs oauthConnections.withFreshAccessToken(). It is the
 * seam int-schema (MAI-101) left open: that file owns the decrypt, the write-back,
 * and the single-flight guard, but NOT the provider HTTP — this maps a stored
 * refresh token to a fresh grant through the registry.
 *
 * A revoked refresh token surfaces from the provider client as an OAuthProviderError
 * whose `code` is `invalid_grant`; withFreshAccessToken() inspects exactly that
 * `.code` to stamp the row `token_revoked`, so the error is rethrown untouched rather
 * than swallowed. Any other failure (a provider blip) bubbles up the same way and is
 * treated as transient, not a revocation.
 */
export async function oauthTokenRefresher({
  provider,
  refreshToken,
}: TokenRefreshInput): Promise<RefreshedGrant> {
  if (!isProvider(provider)) {
    throw new Error(`oauthProviders: unknown provider "${provider}" in a stored connection`)
  }
  const grant = await oauthClientFor(provider).refreshAccessToken(refreshToken)
  return {
    accessToken: grant.accessToken,
    expiresAt: grant.expiresAt,
    // Under refresh-token rotation the provider mints a new one; pass it through so
    // oauthConnections re-encrypts and stores it. Absent → keep the stored token.
    refreshToken: grant.refreshToken ?? undefined,
  }
}

/**
 * Wire the real Google/Microsoft refresh into oauthConnections, once, at startup.
 * Called from index.ts — never from app.ts, so the unit suite (which imports app.ts)
 * registers its own fake refresher per file instead of reaching a provider.
 */
export function registerOAuthTokenRefresher(): void {
  registerTokenRefresher(oauthTokenRefresher)
}
