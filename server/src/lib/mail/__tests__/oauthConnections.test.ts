// Unit tests for oauthConnections.ts — the single decrypt chokepoint.
//
// What these protect:
//   - a token expiring inside the 60 s skew is refreshed and written back; one
//     comfortably in date is handed back untouched, with no provider call
//   - a provider `invalid_grant` stamps the row error/token_revoked and THROWS —
//     it never returns a dead token
//   - ciphertext that will not decrypt stamps token_unreadable and throws — it is
//     never treated as an absent token
//   - two concurrent callers for one connection trigger exactly ONE refresh
//   - serializeConnection never carries a substring of either token, and cannot
//     grow a token field
//   - reads and writes stay inside the org boundary
//
// No test reaches a provider: the refresh call is injected through
// registerTokenRefresher and mocked here. tokenCrypto is used for real, with the
// deterministic key src/test/setup.ts installs, so the round-trip is genuine.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    oAuthConnection: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('../../../db.js', () => ({ default: prismaMock }))

import { encryptToken } from '../../tokenCrypto.js'
import {
  CONNECTION_PUBLIC_SELECT,
  InvalidGrantError,
  TokenRevokedError,
  TokenUnreadableError,
  getConnection,
  registerTokenRefresher,
  serializeConnection,
  withFreshAccessToken,
  type RefreshedGrant,
  type TokenRefresher,
} from '../oauthConnections.js'

const NOW = Date.now()
const PROVIDER = 'google'
const USER_ID = 'user-a'
const ORG_ID = 'org-a'
const CONN_ID = 'conn-1'
const AAD = `${PROVIDER}:${USER_ID}`

const REFRESH_PLAINTEXT = 'refresh-token-SECRET-value'
const ACCESS_PLAINTEXT = 'access-token-SECRET-value'
const NEW_ACCESS_PLAINTEXT = 'brand-new-access-token'

/** A full connection row as findUnique returns it, tokens encrypted for real. */
function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    orgId: ORG_ID,
    userId: USER_ID,
    provider: PROVIDER,
    providerAccountId: 'sub-123',
    emailAddress: 'rep@example.com',
    refreshToken: encryptToken(REFRESH_PLAINTEXT, AAD),
    accessToken: encryptToken(ACCESS_PLAINTEXT, AAD),
    expiresAt: new Date(NOW - 1000), // expired by default → a refresh is due
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    status: 'connected',
    errorCode: null,
    statusDetail: null,
    lastValidatedAt: null,
    lastRefreshAt: null,
    createdAt: new Date(NOW - 100_000),
    updatedAt: new Date(NOW - 100_000),
    ...overrides,
  }
}

function grant(overrides: Partial<RefreshedGrant> = {}): RefreshedGrant {
  return { accessToken: NEW_ACCESS_PLAINTEXT, expiresAt: new Date(NOW + 3_600_000), ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.oAuthConnection.updateMany.mockResolvedValue({ count: 1 })
  // A default refresher so a stray test does not hit the "unregistered" guard.
  registerTokenRefresher(async () => grant())
})

describe('withFreshAccessToken — refresh decision', () => {
  it('refreshes a token expiring within 60 s, writes it back, and returns it', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(
      connectionRow({ expiresAt: new Date(NOW + 30_000) }),
    )
    const refresher = vi.fn<TokenRefresher>(async () => grant())
    registerTokenRefresher(refresher)

    const token = await withFreshAccessToken(CONN_ID)

    expect(token).toBe(NEW_ACCESS_PLAINTEXT)
    expect(refresher).toHaveBeenCalledTimes(1)
    // The provider was handed the DECRYPTED refresh token, never ciphertext.
    expect(refresher).toHaveBeenCalledWith({
      provider: PROVIDER,
      refreshToken: REFRESH_PLAINTEXT,
      connectionId: CONN_ID,
    })

    // Written back, scoped to (id, orgId), with the new token encrypted (not plain).
    expect(prismaMock.oAuthConnection.updateMany).toHaveBeenCalledTimes(1)
    const call = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: CONN_ID, orgId: ORG_ID })
    expect(call.data.accessToken).not.toContain(NEW_ACCESS_PLAINTEXT)
    expect(call.data.expiresAt).toBeInstanceOf(Date)
    expect(call.data.lastRefreshAt).toBeInstanceOf(Date)
  })

  it('does NOT refresh a token expiring in 10 minutes, and returns the stored one', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(
      connectionRow({ expiresAt: new Date(NOW + 600_000) }),
    )
    const refresher = vi.fn<TokenRefresher>(async () => grant())
    registerTokenRefresher(refresher)

    const token = await withFreshAccessToken(CONN_ID)

    expect(token).toBe(ACCESS_PLAINTEXT)
    expect(refresher).not.toHaveBeenCalled()
    expect(prismaMock.oAuthConnection.updateMany).not.toHaveBeenCalled()
  })

  it('writes back a rotated refresh token when the provider returns one', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(connectionRow())
    registerTokenRefresher(async () => grant({ refreshToken: 'rotated-refresh-token' }))

    await withFreshAccessToken(CONN_ID)

    const call = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(call.data.refreshToken).toBeDefined()
    expect(call.data.refreshToken).not.toContain('rotated-refresh-token')
  })
})

describe('withFreshAccessToken — terminal failures', () => {
  it('stamps token_revoked and throws when the refresh fails invalid_grant', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(connectionRow())
    registerTokenRefresher(async () => {
      throw new InvalidGrantError()
    })

    await expect(withFreshAccessToken(CONN_ID)).rejects.toBeInstanceOf(TokenRevokedError)

    const call = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: CONN_ID, orgId: ORG_ID })
    expect(call.data.status).toBe('error')
    expect(call.data.errorCode).toBe('token_revoked')
  })

  it('also treats a bare { code: "invalid_grant" } as a revocation', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(connectionRow())
    registerTokenRefresher(async () => {
      throw Object.assign(new Error('nope'), { code: 'invalid_grant' })
    })

    await expect(withFreshAccessToken(CONN_ID)).rejects.toBeInstanceOf(TokenRevokedError)
    expect(prismaMock.oAuthConnection.updateMany.mock.calls[0][0].data.errorCode).toBe('token_revoked')
  })

  it('lets a transient provider error bubble up WITHOUT stamping the row', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(connectionRow())
    registerTokenRefresher(async () => {
      throw new Error('ECONNRESET')
    })

    await expect(withFreshAccessToken(CONN_ID)).rejects.toThrow('ECONNRESET')
    expect(prismaMock.oAuthConnection.updateMany).not.toHaveBeenCalled()
  })

  it('stamps token_unreadable and throws when the stored token will not decrypt', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(
      connectionRow({ refreshToken: 'v1.not.real.ciphertext' }),
    )
    const refresher = vi.fn<TokenRefresher>(async () => grant())
    registerTokenRefresher(refresher)

    await expect(withFreshAccessToken(CONN_ID)).rejects.toBeInstanceOf(TokenUnreadableError)

    expect(refresher).not.toHaveBeenCalled() // never reached the provider
    const call = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(call.data.status).toBe('error')
    expect(call.data.errorCode).toBe('token_unreadable')
  })

  it('token_unreadable when a ciphertext decrypts under the WRONG aad (row copied to another user)', async () => {
    // Encrypted for a DIFFERENT user; the row claims userId=user-a, so the aad
    // this file builds will not match and GCM authentication fails.
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(
      connectionRow({ refreshToken: encryptToken(REFRESH_PLAINTEXT, `${PROVIDER}:someone-else`) }),
    )

    await expect(withFreshAccessToken(CONN_ID)).rejects.toBeInstanceOf(TokenUnreadableError)
    expect(prismaMock.oAuthConnection.updateMany.mock.calls[0][0].data.errorCode).toBe('token_unreadable')
  })
})

describe('withFreshAccessToken — single-flight', () => {
  it('performs exactly one refresh for two concurrent callers on the same connection', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(connectionRow())

    let resolveRefresh: (g: RefreshedGrant) => void = () => {}
    const refresher = vi.fn<TokenRefresher>(
      () => new Promise<RefreshedGrant>((resolve) => (resolveRefresh = resolve)),
    )
    registerTokenRefresher(refresher)

    const a = withFreshAccessToken(CONN_ID)
    const b = withFreshAccessToken(CONN_ID)

    // Let both calls get past the (resolved) findUnique await so the shared
    // in-flight promise has actually invoked the refresher before we release it.
    await new Promise((r) => setTimeout(r, 0))
    resolveRefresh(grant())
    const [ta, tb] = await Promise.all([a, b])

    expect(ta).toBe(NEW_ACCESS_PLAINTEXT)
    expect(tb).toBe(NEW_ACCESS_PLAINTEXT)
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(prismaMock.oAuthConnection.findUnique).toHaveBeenCalledTimes(1)
    expect(prismaMock.oAuthConnection.updateMany).toHaveBeenCalledTimes(1)
  })

  it('refreshes again once the first in-flight call has settled', async () => {
    prismaMock.oAuthConnection.findUnique.mockResolvedValue(connectionRow())
    const refresher = vi.fn<TokenRefresher>(async () => grant())
    registerTokenRefresher(refresher)

    await withFreshAccessToken(CONN_ID)
    await withFreshAccessToken(CONN_ID)

    expect(refresher).toHaveBeenCalledTimes(2)
  })
})

describe('serializeConnection', () => {
  it('drops both tokens: the serialized JSON contains no substring of either', () => {
    const row = {
      ...connectionRow(),
      // Give the tokens memorable PLAINTEXT markers, so a leak of ciphertext OR of
      // the raw value would both be caught by the substring assertion below.
      refreshToken: 'REFRESH-LEAK-MARKER',
      accessToken: 'ACCESS-LEAK-MARKER',
    }

    const json = JSON.stringify(serializeConnection(row))

    expect(json).not.toContain('REFRESH-LEAK-MARKER')
    expect(json).not.toContain('ACCESS-LEAK-MARKER')
    expect(json).not.toContain('refreshToken')
    expect(json).not.toContain('accessToken')
    // The safe fields are all present.
    const parsed = JSON.parse(json)
    expect(parsed.emailAddress).toBe('rep@example.com')
    expect(parsed.status).toBe('connected')
  })

  it('the public select declares no token field', () => {
    expect(CONNECTION_PUBLIC_SELECT).not.toHaveProperty('refreshToken')
    expect(CONNECTION_PUBLIC_SELECT).not.toHaveProperty('accessToken')
  })
})

describe('getConnection', () => {
  it('returns the token-free shape and filters on orgId', async () => {
    prismaMock.oAuthConnection.findFirst.mockResolvedValue({
      id: CONN_ID,
      provider: PROVIDER,
      providerAccountId: 'sub-123',
      emailAddress: 'rep@example.com',
      scopes: [],
      status: 'connected',
      errorCode: null,
      statusDetail: null,
      lastValidatedAt: null,
      lastRefreshAt: null,
      expiresAt: null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })

    const result = await getConnection(CONN_ID, ORG_ID)

    expect(result?.emailAddress).toBe('rep@example.com')
    const where = prismaMock.oAuthConnection.findFirst.mock.calls[0][0].where
    expect(where).toEqual({ id: CONN_ID, orgId: ORG_ID })
    // The read used the explicit token-free select.
    expect(prismaMock.oAuthConnection.findFirst.mock.calls[0][0].select).toBe(CONNECTION_PUBLIC_SELECT)
  })

  it('returns null for a connection id from another org, without throwing', async () => {
    prismaMock.oAuthConnection.findFirst.mockResolvedValue(null)
    await expect(getConnection(CONN_ID, 'org-somebody-else')).resolves.toBeNull()
  })
})
