// googleOAuth.ts — Google's half of the OAuth contract, in one file. Builds the
// consent URL, exchanges a code for tokens, refreshes an access token, and resolves
// whose mailbox a token is. The HTTP is constructed HERE, with `fetch`, so no SDK is
// ever built in a route (rules/dependencies-and-config.md). Nothing outside this file
// and microsoftOAuth.ts names a Google endpoint.

import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  OAUTH_REDIRECT_BASE,
} from '../src/config.js'
import {
  OAuthProviderError,
  type AuthorizeUrlInput,
  type ExchangeCodeInput,
  type OAuthClient,
  type ProviderIdentity,
  type TokenGrant,
} from './oauthTypes.js'

// Google's OAuth 2.0 endpoints. The one place in the codebase they appear.
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

/** The callback Google redirects to. Must match a redirect URI registered on the app. */
function redirectUri(): string {
  return `${OAUTH_REDIRECT_BASE}/api/integrations/google/callback`
}

/** The raw JSON of a Google token response. Only the fields we read are typed. */
interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * POST a form body to a Google endpoint and parse the JSON. A non-2xx response, or a
 * body carrying an `error`, is turned into an {@link OAuthProviderError} whose `code`
 * is Google's own error string — never the `code`, verifier, or token that went in.
 */
async function postForm(url: string, form: Record<string, string>): Promise<GoogleTokenResponse> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    })
  } catch (err) {
    // DNS, TLS, connection refused — the endpoint was never reached.
    throw new OAuthProviderError('provider_unreachable', err instanceof Error ? err.message : undefined)
  }

  const body = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  if (!res.ok || body.error) {
    throw new OAuthProviderError(body.error ?? `http_${res.status}`, body.error_description, res.status)
  }
  return body
}

/** Shape a token response into the provider-agnostic {@link TokenGrant}. */
function toGrant(body: GoogleTokenResponse): TokenGrant {
  if (!body.access_token) {
    throw new OAuthProviderError('token_exchange_failed', 'Google returned no access token')
  }
  return {
    accessToken: body.access_token,
    // Google returns a refresh token only when consent was forced; absent otherwise.
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 0) * 1000),
    // The GRANTED scopes, exactly as Google reported them — never the requested list.
    grantedScopes: (body.scope ?? '').split(' ').filter(Boolean),
  }
}

export const googleOAuth: OAuthClient = {
  provider: 'google',

  buildAuthorizeUrl(input: AuthorizeUrlInput): string {
    const url = new URL(AUTHORIZE_ENDPOINT)
    url.searchParams.set('client_id', GOOGLE_OAUTH_CLIENT_ID)
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', input.scopes.join(' '))
    url.searchParams.set('state', input.state)
    // PKCE S256: the challenge goes out here; exchangeCode sends the verifier.
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    // Google returns a refresh token ONLY when consent is forced. `access_type=offline`
    // asks for one, and `prompt=consent` forces the screen on every consent — including
    // a re-consent — so the refresh token is re-issued instead of silently dropped.
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    // Incremental authorization: a `mode: 'fix'` re-consent for only the missing
    // scopes keeps the ones already granted, so the rep is not re-asked for them.
    url.searchParams.set('include_granted_scopes', 'true')
    if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
    return url.toString()
  },

  async exchangeCode({ code, codeVerifier }: ExchangeCodeInput): Promise<TokenGrant> {
    return toGrant(
      await postForm(TOKEN_ENDPOINT, {
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(),
      }),
    )
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenGrant> {
    return toGrant(
      await postForm(TOKEN_ENDPOINT, {
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    )
  },

  async fetchIdentity(accessToken: string): Promise<ProviderIdentity> {
    let res: Response
    try {
      res = await fetch(USERINFO_ENDPOINT, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      })
    } catch (err) {
      throw new OAuthProviderError('provider_unreachable', err instanceof Error ? err.message : undefined)
    }
    if (!res.ok) {
      throw new OAuthProviderError('identity_fetch_failed', `userinfo returned ${res.status}`, res.status)
    }
    const body = (await res.json().catch(() => ({}))) as { sub?: string; email?: string }
    if (!body.sub || !body.email) {
      throw new OAuthProviderError('identity_fetch_failed', 'userinfo missing sub or email')
    }
    return { providerAccountId: body.sub, emailAddress: body.email }
  },
}
