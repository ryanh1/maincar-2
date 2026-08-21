// oauthProviders.test.ts — the registry and both provider clients, with ALL provider
// HTTP mocked (globalThis.fetch is stubbed). No test here reaches Google or Microsoft.
//
// db.js is mocked so importing oauthProviders (→ oauthConnections → db) opens no pool.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../db.js', () => ({ default: {} }))

import { googleOAuth } from '../../../../dependencies/googleOAuth.js'
import { microsoftOAuth } from '../../../../dependencies/microsoftOAuth.js'
import { OAuthProviderError } from '../../../../dependencies/oauthTypes.js'
import { allRequestedScopes } from '../../oauthScopes.js'
import {
  PROVIDERS,
  isProvider,
  oauthClientFor,
  oauthTokenRefresher,
} from '../oauthProviders.js'

/** A minimal `fetch` Response stand-in carrying a JSON body. */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response
}

/** Stub globalThis.fetch to resolve one queued response, and return the spy. */
function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', spy)
  return spy
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// --- The registry ----------------------------------------------------------

describe('the one provider registry', () => {
  it('PROVIDERS names exactly google and microsoft', () => {
    expect([...PROVIDERS]).toEqual(['google', 'microsoft'])
  })

  it('isProvider narrows only the two known strings', () => {
    expect(isProvider('google')).toBe(true)
    expect(isProvider('microsoft')).toBe(true)
    expect(isProvider('slack')).toBe(false)
    expect(isProvider('Google')).toBe(false)
    expect(isProvider('')).toBe(false)
    expect(isProvider(undefined)).toBe(false)
    expect(isProvider(42)).toBe(false)
  })

  it('oauthClientFor returns the client whose provider matches the key', () => {
    expect(oauthClientFor('google')).toBe(googleOAuth)
    expect(oauthClientFor('google').provider).toBe('google')
    expect(oauthClientFor('microsoft')).toBe(microsoftOAuth)
    expect(oauthClientFor('microsoft').provider).toBe('microsoft')
  })
})

// --- buildAuthorizeUrl ------------------------------------------------------

describe('googleOAuth.buildAuthorizeUrl', () => {
  const scopes = allRequestedScopes('google')
  const url = () =>
    new URL(
      googleOAuth.buildAuthorizeUrl({ scopes, state: 'signed-state-token', codeChallenge: 'CHALLENGE-abc' }),
    )

  it('carries the PKCE challenge and the S256 method', () => {
    const u = url()
    expect(u.searchParams.get('code_challenge')).toBe('CHALLENGE-abc')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('carries the state verbatim', () => {
    expect(url().searchParams.get('state')).toBe('signed-state-token')
  })

  it('carries every requested scope', () => {
    const requested = url().searchParams.get('scope')?.split(' ') ?? []
    for (const scope of scopes) expect(requested).toContain(scope)
  })

  it('forces a refresh token with access_type=offline and prompt=consent', () => {
    const u = url()
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
  })

  it('points redirect_uri at the google callback and never leaks the client secret', () => {
    const raw = googleOAuth.buildAuthorizeUrl({ scopes, state: 's', codeChallenge: 'c' })
    expect(new URL(raw).searchParams.get('redirect_uri')).toBe(
      'https://test.example.com/api/integrations/google/callback',
    )
    expect(raw).not.toContain('test-google-client-secret')
  })

  it('sets login_hint only when a fix supplies one', () => {
    expect(url().searchParams.get('login_hint')).toBeNull()
    const fix = new URL(
      googleOAuth.buildAuthorizeUrl({ scopes, state: 's', codeChallenge: 'c', loginHint: 'rep@acme.com' }),
    )
    expect(fix.searchParams.get('login_hint')).toBe('rep@acme.com')
  })
})

describe('microsoftOAuth.buildAuthorizeUrl', () => {
  const scopes = allRequestedScopes('microsoft')
  const url = () =>
    new URL(microsoftOAuth.buildAuthorizeUrl({ scopes, state: 'st', codeChallenge: 'CH' }))

  it('targets the organizations tenant (work accounts only)', () => {
    const u = url()
    expect(u.host).toBe('login.microsoftonline.com')
    expect(u.pathname).toContain('/organizations/')
    expect(u.pathname).not.toContain('/consumers/')
  })

  it('carries the PKCE challenge, the S256 method, and the state', () => {
    const u = url()
    expect(u.searchParams.get('code_challenge')).toBe('CH')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe('st')
  })

  it('carries every requested scope, including offline_access', () => {
    const requested = url().searchParams.get('scope')?.split(' ') ?? []
    for (const scope of scopes) expect(requested).toContain(scope)
    expect(requested).toContain('offline_access')
  })

  it('points redirect_uri at the microsoft callback', () => {
    expect(url().searchParams.get('redirect_uri')).toBe(
      'https://test.example.com/api/integrations/microsoft/callback',
    )
  })
})

// --- exchangeCode -----------------------------------------------------------

describe('exchangeCode', () => {
  it('returns the GRANTED scopes as the provider reported them, not the requested set', async () => {
    // Google grants only two of the four requested scopes.
    const granted = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email'
    stubFetch(
      jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: granted }),
    )
    const grant = await googleOAuth.exchangeCode({ code: 'the-code', codeVerifier: 'the-verifier' })
    expect(grant.grantedScopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ])
    expect(grant.grantedScopes).not.toEqual(allRequestedScopes('google'))
    expect(grant.accessToken).toBe('at')
    expect(grant.refreshToken).toBe('rt')
    expect(grant.expiresAt.toISOString()).toBe('2026-08-20T13:00:00.000Z')
  })

  it('sends the PKCE verifier and the authorization_code grant to the token endpoint', async () => {
    const spy = stubFetch(jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: '' }))
    await googleOAuth.exchangeCode({ code: 'the-code', codeVerifier: 'the-verifier' })
    const [endpoint, opts] = spy.mock.calls[0] as [string, RequestInit]
    expect(endpoint).toBe('https://oauth2.googleapis.com/token')
    const sent = new URLSearchParams(opts.body as string)
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code_verifier')).toBe('the-verifier')
    expect(sent.get('code')).toBe('the-code')
  })

  it('returns a null refresh token when Google returns none', async () => {
    stubFetch(jsonResponse({ access_token: 'at', expires_in: 3600, scope: '' }))
    const grant = await googleOAuth.exchangeCode({ code: 'c', codeVerifier: 'v' })
    expect(grant.refreshToken).toBeNull()
  })

  it('maps a provider error onto OAuthProviderError carrying the raw code', async () => {
    stubFetch(
      jsonResponse(
        { error: 'invalid_grant', error_description: 'Bad Request' },
        { ok: false, status: 400 },
      ),
    )
    await expect(googleOAuth.exchangeCode({ code: 'c', codeVerifier: 'v' })).rejects.toMatchObject({
      name: 'OAuthProviderError',
      code: 'invalid_grant',
    })
  })

  it('carries a Microsoft AADSTS reason through as the error code', async () => {
    stubFetch(
      jsonResponse(
        { error: 'invalid_grant', error_description: 'AADSTS65001: consent required' },
        { ok: false, status: 400 },
      ),
    )
    const err = await microsoftOAuth.exchangeCode({ code: 'c', codeVerifier: 'v' }).catch((e) => e)
    expect(err).toBeInstanceOf(OAuthProviderError)
    expect(err.code).toContain('AADSTS65001')
  })

  it('never puts the code or verifier in the thrown error message', async () => {
    stubFetch(jsonResponse({ error: 'invalid_grant' }, { ok: false, status: 400 }))
    const err = await googleOAuth.exchangeCode({ code: 'SECRET-CODE', codeVerifier: 'SECRET-VERIFIER' }).catch((e) => e)
    expect(err.message).not.toContain('SECRET-CODE')
    expect(err.message).not.toContain('SECRET-VERIFIER')
  })
})

// --- refreshAccessToken -----------------------------------------------------

describe('refreshAccessToken', () => {
  it('returns a fresh grant and the granted scopes', async () => {
    stubFetch(jsonResponse({ access_token: 'new-at', expires_in: 3600, scope: 'Mail.Read Mail.Send' }))
    const grant = await microsoftOAuth.refreshAccessToken('stored-refresh')
    expect(grant.accessToken).toBe('new-at')
    expect(grant.grantedScopes).toEqual(['Mail.Read', 'Mail.Send'])
    expect(grant.expiresAt.toISOString()).toBe('2026-08-20T13:00:00.000Z')
  })

  it('passes through a rotated refresh token when the provider mints one', async () => {
    stubFetch(jsonResponse({ access_token: 'at', refresh_token: 'rotated', expires_in: 3600, scope: '' }))
    const grant = await microsoftOAuth.refreshAccessToken('old')
    expect(grant.refreshToken).toBe('rotated')
  })
})

// --- fetchIdentity ----------------------------------------------------------

describe('fetchIdentity', () => {
  it('resolves Google identity from sub and email', async () => {
    stubFetch(jsonResponse({ sub: 'google-sub-123', email: 'rep@acme.com' }))
    expect(await googleOAuth.fetchIdentity('at')).toEqual({
      providerAccountId: 'google-sub-123',
      emailAddress: 'rep@acme.com',
    })
  })

  it('resolves Microsoft identity from id and mail', async () => {
    stubFetch(jsonResponse({ id: 'ms-id-1', mail: 'rep@acme.com', userPrincipalName: 'rep@acme.onmicrosoft.com' }))
    expect(await microsoftOAuth.fetchIdentity('at')).toEqual({
      providerAccountId: 'ms-id-1',
      emailAddress: 'rep@acme.com',
    })
  })

  it('falls back to the Microsoft UPN when mail is null', async () => {
    stubFetch(jsonResponse({ id: 'ms-id-2', mail: null, userPrincipalName: 'rep@acme.onmicrosoft.com' }))
    const identity = await microsoftOAuth.fetchIdentity('at')
    expect(identity.emailAddress).toBe('rep@acme.onmicrosoft.com')
  })

  it('throws identity_fetch_failed on a non-2xx', async () => {
    stubFetch(jsonResponse({}, { ok: false, status: 401 }))
    await expect(googleOAuth.fetchIdentity('at')).rejects.toMatchObject({ code: 'identity_fetch_failed' })
  })
})

// --- the token-refresher seam (wires into oauthConnections) ------------------

describe('oauthTokenRefresher', () => {
  it('maps a provider refresh onto the RefreshedGrant shape', async () => {
    stubFetch(jsonResponse({ access_token: 'fresh', expires_in: 3600, scope: '' }))
    const grant = await oauthTokenRefresher({ provider: 'google', refreshToken: 'rt', connectionId: 'c1' })
    expect(grant.accessToken).toBe('fresh')
    expect(grant.expiresAt.toISOString()).toBe('2026-08-20T13:00:00.000Z')
    // No rotation → undefined, so oauthConnections keeps the stored refresh token.
    expect(grant.refreshToken).toBeUndefined()
  })

  it('passes a rotated refresh token through for re-encryption', async () => {
    stubFetch(jsonResponse({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600, scope: '' }))
    const grant = await oauthTokenRefresher({ provider: 'google', refreshToken: 'rt', connectionId: 'c1' })
    expect(grant.refreshToken).toBe('rotated')
  })

  it('rethrows a revoked grant as an invalid_grant-coded error for oauthConnections to catch', async () => {
    stubFetch(jsonResponse({ error: 'invalid_grant' }, { ok: false, status: 400 }))
    await expect(
      oauthTokenRefresher({ provider: 'google', refreshToken: 'dead', connectionId: 'c1' }),
    ).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('rejects a provider string that is not in the registry', async () => {
    await expect(
      oauthTokenRefresher({ provider: 'slack', refreshToken: 'rt', connectionId: 'c1' }),
    ).rejects.toThrow(/unknown provider/)
  })
})
