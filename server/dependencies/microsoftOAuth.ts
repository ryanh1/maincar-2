// microsoftOAuth.ts — Microsoft's half of the OAuth contract, in one file. Same four
// operations as googleOAuth.ts, against the Microsoft identity platform (v2.0) and
// Microsoft Graph. The HTTP is constructed HERE, with `fetch`, so no SDK is ever
// built in a route (rules/dependencies-and-config.md). Nothing outside this file and
// googleOAuth.ts names a Microsoft endpoint.

import {
  MS_OAUTH_CLIENT_ID,
  MS_OAUTH_CLIENT_SECRET,
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

// The `organizations` tenant: work and school accounts only. Personal Microsoft
// accounts (`consumers`) are OUT OF SCOPE — a rep does not sell from a personal
// Outlook inbox, and supporting both doubles the consent-failure surface
// (SPEC-int-oauth.md open question 1). This is the tenant segment in every endpoint.
const TENANT = 'organizations'
const AUTHORIZE_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const GRAPH_ME_ENDPOINT = 'https://graph.microsoft.com/v1.0/me'

/** The callback Microsoft redirects to. Must match a redirect URI registered on the app. */
function redirectUri(): string {
  return `${OAUTH_REDIRECT_BASE}/api/integrations/microsoft/callback`
}

/** The raw JSON of a Microsoft token response. Only the fields we read are typed. */
interface MicrosoftTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * POST a form body to the Microsoft token endpoint and parse the JSON. A non-2xx
 * response, or a body carrying an `error`, becomes an {@link OAuthProviderError} whose
 * `code` is Microsoft's own error string. Microsoft usually buries its real reason
 * (an `AADSTS…` code) inside `error_description`, so that is carried through as the
 * description for the mapper to match — never the `code`, verifier, or token that went in.
 */
async function postForm(form: Record<string, string>): Promise<MicrosoftTokenResponse> {
  let res: Response
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    })
  } catch (err) {
    throw new OAuthProviderError('provider_unreachable', err instanceof Error ? err.message : undefined)
  }

  const body = (await res.json().catch(() => ({}))) as MicrosoftTokenResponse
  if (!res.ok || body.error) {
    // The AADSTS code lives in error_description; pass it as the code so the mapper's
    // substring match finds it, falling back to the bare `error` when it is absent.
    const raw = body.error_description ?? body.error ?? `http_${res.status}`
    throw new OAuthProviderError(raw, body.error_description, res.status)
  }
  return body
}

/** Shape a token response into the provider-agnostic {@link TokenGrant}. */
function toGrant(body: MicrosoftTokenResponse): TokenGrant {
  if (!body.access_token) {
    throw new OAuthProviderError('token_exchange_failed', 'Microsoft returned no access token')
  }
  return {
    accessToken: body.access_token,
    // Microsoft returns a refresh token when `offline_access` was granted, and rotates
    // it on refresh. Absent → null, which the callback turns into missing_refresh_token.
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 0) * 1000),
    // The GRANTED scopes, exactly as Microsoft reported them — never the requested list.
    grantedScopes: (body.scope ?? '').split(' ').filter(Boolean),
  }
}

export const microsoftOAuth: OAuthClient = {
  provider: 'microsoft',

  buildAuthorizeUrl(input: AuthorizeUrlInput): string {
    const url = new URL(AUTHORIZE_ENDPOINT)
    url.searchParams.set('client_id', MS_OAUTH_CLIENT_ID)
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('scope', input.scopes.join(' '))
    url.searchParams.set('state', input.state)
    // PKCE S256: the challenge goes out here; exchangeCode sends the verifier.
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    // The refresh token comes from the `offline_access` scope (in allRequestedScopes),
    // not from a prompt flag, so Microsoft needs no access_type/prompt=consent.
    if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
    return url.toString()
  },

  async exchangeCode({ code, codeVerifier }: ExchangeCodeInput): Promise<TokenGrant> {
    return toGrant(
      await postForm({
        client_id: MS_OAUTH_CLIENT_ID,
        client_secret: MS_OAUTH_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(),
      }),
    )
  },

  async refreshAccessToken(refreshToken: string): Promise<TokenGrant> {
    return toGrant(
      await postForm({
        client_id: MS_OAUTH_CLIENT_ID,
        client_secret: MS_OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    )
  },

  async fetchIdentity(accessToken: string): Promise<ProviderIdentity> {
    let res: Response
    try {
      res = await fetch(GRAPH_ME_ENDPOINT, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      })
    } catch (err) {
      throw new OAuthProviderError('provider_unreachable', err instanceof Error ? err.message : undefined)
    }
    if (!res.ok) {
      throw new OAuthProviderError('identity_fetch_failed', `graph /me returned ${res.status}`, res.status)
    }
    const body = (await res.json().catch(() => ({}))) as {
      id?: string
      mail?: string | null
      userPrincipalName?: string
    }
    // A work account may leave `mail` null (no Exchange license); the UPN is the
    // fallback address, and is what the rep signs in as.
    const emailAddress = body.mail ?? body.userPrincipalName
    if (!body.id || !emailAddress) {
      throw new OAuthProviderError('identity_fetch_failed', 'graph /me missing id or address')
    }
    return { providerAccountId: body.id, emailAddress }
  },
}
