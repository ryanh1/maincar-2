// Route tests for the Integration Hub's two authenticated routes:
//   POST /api/integrations/orgs/:orgId/:provider/authorize
//   GET  /api/integrations/orgs/:orgId
//
// The org-isolation cases prove membership is re-proven from the path (a non-member
// is answered 404 before any connection is read, matching this codebase's rule that
// a foreign org is never confirmed with a 403). The rest proves the contract: the
// authorize URL carries the signed state and the requested scopes and never
// redirects; an unknown provider is 404 via isProvider(); a `fix` asks for only the
// missing scope and sets login_hint; another rep's connectionId is 404; the list
// groups every connection under its provider; and no response body ever carries a
// token or an authorization code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const {
  prismaMock,
  verifyTokenMock,
  saveConnectionMock,
  markConnectionErrorMock,
  getConnectionMock,
  refreshConnectionMock,
  disconnectConnectionMock,
  testConnectionMock,
  getMailProviderMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    oAuthConnection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    mailAccount: { findFirst: vi.fn() },
  },
  verifyTokenMock: vi.fn(),
  // The callback's two writers are stubbed so the unit suite never touches Postgres;
  // the REAL saveConnection (connected/limited, one-row-per-address, primary) is
  // exercised against a live schema in integrations.integration.test.ts.
  saveConnectionMock: vi.fn(),
  markConnectionErrorMock: vi.fn(),
  // getConnection re-reads the token-free row; refreshConnection is the forced
  // refresh + re-evaluate. Both stubbed so the Test/refresh routes never reach the
  // database, the decryptor, or a provider — their real behavior lives in the
  // oauthConnections unit + integration suites.
  getConnectionMock: vi.fn(),
  refreshConnectionMock: vi.fn(),
  // disconnectConnection deletes the grant (mailbox cascades) and promotes the next
  // primary; stubbed here so the DELETE route tests never touch Postgres. Its real
  // delete/cascade/promote behavior lives in oauthConnection.integration.test.ts.
  disconnectConnectionMock: vi.fn(),
  // The per-capability probes and the seam factory, stubbed: this suite tests the
  // ROUTE (auth, org-scoping, aggregation, write-back, response), not the probes,
  // which are proven in connectionTest.test.ts against a fake provider.
  testConnectionMock: vi.fn(),
  getMailProviderMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))
// Keep everything the authorize/list routes use (serializeConnection, the select,
// the real TokenRevokedError/TokenUnreadableError classes the refresh route matches
// with instanceof), but stub the writers and readers the routes call so no unit test
// reaches the database, the token decryptor, or a provider.
vi.mock('../../lib/mail/oauthConnections.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/mail/oauthConnections.js')>()
  return {
    ...actual,
    saveConnection: saveConnectionMock,
    markConnectionError: markConnectionErrorMock,
    getConnection: getConnectionMock,
    refreshConnection: refreshConnectionMock,
    disconnectConnection: disconnectConnectionMock,
  }
})
vi.mock('../../lib/mail/connectionTest.js', () => ({ testConnection: testConnectionMock }))
vi.mock('../../lib/mail/getMailProvider.js', () => ({ getMailProvider: getMailProviderMock }))

import { googleOAuth } from '../../../dependencies/googleOAuth.js'
import { microsoftOAuth } from '../../../dependencies/microsoftOAuth.js'
import { OAuthProviderError } from '../../../dependencies/oauthTypes.js'
import { WEB_ORIGIN } from '../../config.js'
import { TokenRevokedError } from '../../lib/mail/oauthConnections.js'
import { signState, verifyState } from '../../lib/oauthState.js'

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const URL_A = `/api/integrations/orgs/${ORG_A}`

// The six Google scope params, verbatim from oauthScopes.ts.
const G_READ = 'https://www.googleapis.com/auth/gmail.readonly'
const G_SEND = 'https://www.googleapis.com/auth/gmail.send'
const G_CAL = 'https://www.googleapis.com/auth/calendar.events'
const G_CALENDAR_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const G_FREE_BUSY = 'https://www.googleapis.com/auth/calendar.freebusy'
const G_ID = 'https://www.googleapis.com/auth/userinfo.email'
const G_ALL = [G_READ, G_SEND, G_CAL, G_CALENDAR_LIST, G_FREE_BUSY, G_ID]

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    firebaseUid: 'uid-a',
    email: 'a@orga.com',
    firstName: 'Al',
    lastName: 'Pha',
    title: null,
    imageUrl: null,
    roles: ['basic'],
    enabled: true,
    timeZone: 'America/New_York',
    currentOrgId: ORG_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: ORG_A,
    roles: ['basic'],
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

// A full connection row, tokens and all. The route selects the public columns, and
// serializeConnection drops the tokens — a test passes these in to prove that.
function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-google',
    orgId: ORG_A,
    userId: 'user-a',
    provider: 'google',
    providerAccountId: 'sub-123',
    emailAddress: 'rep@acme.com',
    refreshToken: 'SECRET-REFRESH-TOKEN',
    accessToken: 'SECRET-ACCESS-TOKEN',
    scopes: G_ALL,
    status: 'connected',
    errorCode: null,
    statusDetail: null,
    lastValidatedAt: NOW,
    lastRefreshAt: NOW,
    expiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Signs the caller in. `membership` is what they hold in the org they ask about. */
function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.oAuthConnection.findFirst.mockResolvedValue(null)
  prismaMock.oAuthConnection.findMany.mockResolvedValue([])
  prismaMock.oAuthConnection.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.mailAccount.findFirst.mockResolvedValue(null)
})

// ============================================================
// POST authorize
// ============================================================
describe('POST /api/integrations/orgs/:orgId/:provider/authorize', () => {
  it('returns a consent URL carrying the signed state and the full scope set — and never redirects', async () => {
    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'connect' })

    expect(res.status).toBe(200)
    expect(res.headers.location).toBeUndefined()
    const url = new URL(res.body.url as string)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    // State is present and non-empty; scopes are the full requested set.
    expect((url.searchParams.get('state') ?? '').length).toBeGreaterThan(0)
    const scope = url.searchParams.get('scope') ?? ''
    for (const s of G_ALL) expect(scope).toContain(s)
    // PKCE S256 challenge went out; the verifier did not.
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect((url.searchParams.get('code_challenge') ?? '').length).toBeGreaterThan(0)
  })

  it('re-proves membership from the path org before minting anything', async () => {
    await request(app).post(`${URL_A}/google/authorize`).set('Authorization', AUTH).send({ mode: 'connect' })

    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a', orgId: ORG_A, isActive: true }) }),
    )
  })

  it('404s an unknown provider, checked with isProvider and never trusted as a bare string', async () => {
    const res = await request(app)
      .post(`${URL_A}/slack/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'connect' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Unknown provider' })
  })

  it('fix asks for ONLY the missing scope and sets login_hint to the existing address', async () => {
    // Every Calendar permission is granted; gmail.send alone is missing.
    prismaMock.oAuthConnection.findFirst.mockResolvedValue({
      id: 'conn-google',
      emailAddress: 'rep@acme.com',
      scopes: [G_READ, G_CAL, G_CALENDAR_LIST, G_FREE_BUSY, G_ID],
    })

    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'fix', connectionId: 'conn-google' })

    expect(res.status).toBe(200)
    const url = new URL(res.body.url as string)
    expect(url.searchParams.get('scope')).toBe(G_SEND)
    expect(url.searchParams.get('login_hint')).toBe('rep@acme.com')
    // The lookup was scoped to this rep in this org, for this provider.
    expect(prismaMock.oAuthConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conn-google', orgId: ORG_A, userId: 'user-a', provider: 'google' },
        select: expect.anything(),
      }),
    )
  })

  it('targets an existing connection when reconnecting it with the full scope set', async () => {
    prismaMock.oAuthConnection.findFirst.mockResolvedValue({
      id: 'conn-google',
      emailAddress: 'rep@acme.com',
      scopes: [G_READ],
    })

    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'connect', connectionId: 'conn-google' })

    expect(res.status).toBe(200)
    const url = new URL(res.body.url as string)
    expect(url.searchParams.get('login_hint')).toBe('rep@acme.com')
    for (const scope of G_ALL) {
      expect(url.searchParams.get('scope')).toContain(scope)
    }
    const verified = verifyState(url.searchParams.get('state') ?? '')
    expect(verified).toMatchObject({
      ok: true,
      payload: { connectionId: 'conn-google', mode: 'connect' },
    })
  })

  it("404s a fix for another rep's connectionId (the scoped lookup finds nothing)", async () => {
    prismaMock.oAuthConnection.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'fix', connectionId: 'someone-elses-connection' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Connection not found' })
  })

  it('400s a fix with no connectionId', async () => {
    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'fix' })

    expect(res.status).toBe(400)
  })

  it('400s a fix on a connection that already has every permission', async () => {
    prismaMock.oAuthConnection.findFirst.mockResolvedValue({
      id: 'conn-google',
      emailAddress: 'rep@acme.com',
      scopes: G_ALL,
    })

    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'fix', connectionId: 'conn-google' })

    expect(res.status).toBe(400)
  })

  it('400s a body with no valid mode', async () => {
    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'delete-everything' })

    expect(res.status).toBe(400)
  })

  it('401s an unauthenticated caller', async () => {
    const res = await request(app).post(`${URL_A}/google/authorize`).send({ mode: 'connect' })
    expect(res.status).toBe(401)
  })

  it('404s an org the caller does not belong to — never a 403 — before minting a URL', async () => {
    authAs(null)
    const res = await request(app)
      .post(`${URL_A}/google/authorize`)
      .set('Authorization', AUTH)
      .send({ mode: 'connect' })

    expect(res.status).toBe(404)
    expect(prismaMock.oAuthConnection.findFirst).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET list
// ============================================================
describe('GET /api/integrations/orgs/:orgId', () => {
  it('returns one card per provider with every connection grouped under its provider', async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([
      connectionRow(),
      connectionRow({
        id: 'conn-google-2',
        providerAccountId: 'sub-456',
        emailAddress: 'second@acme.com',
      }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.integrations.map((c: { provider: string }) => c.provider)).toEqual(['google', 'microsoft'])

    const google = res.body.integrations.find((c: { provider: string }) => c.provider === 'google')
    const microsoft = res.body.integrations.find((c: { provider: string }) => c.provider === 'microsoft')

    expect(google.providerLabel).toBe('Google Workspace')
    expect(google.providerShortName).toBe('Google')
    expect(google.requiredPermissions).toContain('Send email as you')
    expect(google.connection.emailAddress).toBe('rep@acme.com')
    expect(google.connections.map((connection: { emailAddress: string }) => connection.emailAddress)).toEqual([
      'rep@acme.com',
      'second@acme.com',
    ])

    expect(microsoft.providerLabel).toBe('Microsoft 365')
    expect(microsoft.providerShortName).toBe('Microsoft')
    expect(microsoft.connection).toBeNull()
    expect(microsoft.connections).toEqual([])
  })

  it('scopes the connection query to this rep in the path org', async () => {
    await request(app).get(URL_A).set('Authorization', AUTH)

    expect(prismaMock.oAuthConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: ORG_A, userId: 'user-a' } }),
    )
  })

  it('carries no token or authorization code in the response body, even with tokens on the row', async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([connectionRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('SECRET-REFRESH-TOKEN')
    expect(body).not.toContain('SECRET-ACCESS-TOKEN')
    expect(body).not.toContain('refreshToken')
    expect(body).not.toContain('accessToken')
    // The serialized connection has no token-bearing keys.
    const google = res.body.integrations.find((c: { provider: string }) => c.provider === 'google')
    expect(Object.keys(google.connection)).not.toContain('refreshToken')
    expect(Object.keys(google.connection)).not.toContain('accessToken')
    expect(Object.keys(google.connections[0])).not.toContain('refreshToken')
    expect(Object.keys(google.connections[0])).not.toContain('accessToken')
  })

  it('401s an unauthenticated caller', async () => {
    const res = await request(app).get(URL_A)
    expect(res.status).toBe(401)
  })

  it('404s an org the caller does not belong to — never a 403', async () => {
    authAs(null)
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.oAuthConnection.findMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET /:orgId/health — the broken-connection signal (the badge)
// ============================================================
// This is what the app-wide badge counts. The suite mocks prisma, so at this layer the
// honest proof that a `limited` (or `connected`) connection never reaches the badge is
// that the query filters to `status: 'error'` — the row-level filtering is the DB's job,
// and the where clause is where it is enforced. The rest proves the HTTP contract: the
// slim mapped shape, newest-broken-first, an empty list is `{ broken: [] }` not a 404,
// tenant scoping in the where, no token in the body, and 401/404 before any query runs.

const HEALTH_URL = `${URL_A}/health`

/** A broken row as connectionHealth's select returns it (token-free by construction). */
function brokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-google',
    provider: 'google',
    emailAddress: 'rep@acme.com',
    errorCode: 'token_revoked',
    statusDetail: 'Access was revoked; reconnect the mailbox.',
    ...overrides,
  }
}

describe('GET /api/integrations/orgs/:orgId/health', () => {
  it("returns the rep's error connections as slim BrokenConnection rows, newest-broken first", async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([
      brokenRow({ id: 'conn-ms', provider: 'microsoft', errorCode: 'token_revoked', statusDetail: 'Access was revoked; reconnect the mailbox.' }),
      brokenRow({ id: 'conn-google', provider: 'google', errorCode: 'admin_approval_required', statusDetail: 'Ask your administrator to approve Maincar.' }),
    ])

    const res = await request(app).get(HEALTH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    // Order is preserved from the query (newest-broken first), and each row is the slim
    // shape the badge needs — connectionId, provider, providerLabel, address, code, detail.
    expect(res.body.broken).toEqual([
      {
        connectionId: 'conn-ms',
        provider: 'microsoft',
        providerLabel: 'Microsoft',
        emailAddress: 'rep@acme.com',
        errorCode: 'token_revoked',
        detail: 'Access was revoked; reconnect the mailbox.',
      },
      {
        connectionId: 'conn-google',
        provider: 'google',
        providerLabel: 'Google',
        emailAddress: 'rep@acme.com',
        errorCode: 'admin_approval_required',
        detail: 'Ask your administrator to approve Maincar.',
      },
    ])
  })

  it('queries ONLY error rows for this rep in this org, newest-broken first — so a limited or connected connection can never be in the badge', async () => {
    await request(app).get(HEALTH_URL).set('Authorization', AUTH)

    expect(prismaMock.oAuthConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG_A, userId: 'user-a', status: 'error' },
        orderBy: { updatedAt: 'desc' },
      }),
    )
  })

  it('an empty result is { broken: [] }, never a 404', async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([])

    const res = await request(app).get(HEALTH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ broken: [] })
  })

  it('coalesces a null statusDetail to an empty string so detail is always a string', async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([brokenRow({ errorCode: 'unknown', statusDetail: null })])

    const res = await request(app).get(HEALTH_URL).set('Authorization', AUTH)

    expect(res.body.broken[0].detail).toBe('')
  })

  it('carries no token in the response body', async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([brokenRow()])

    const res = await request(app).get(HEALTH_URL).set('Authorization', AUTH)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('refreshToken')
    expect(body).not.toContain('accessToken')
  })

  it('401s an unauthenticated caller', async () => {
    const res = await request(app).get(HEALTH_URL)
    expect(res.status).toBe(401)
  })

  it('404s an org the caller does not belong to — never a 403 — and never queries', async () => {
    authAs(null)

    const res = await request(app).get(HEALTH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.oAuthConnection.findMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST /:connectionId/test — the Test button
// ============================================================
// testConnection and getMailProvider are mocked (see the module mocks up top), so
// these tests prove the ROUTE: it proves ownership, folds the per-capability results
// into the written-back status, sets lastValidatedAt ONLY on a clean pass, answers
// 200-with-ok-false for a broken integration (never 500), and never leaks a token.
// The probes themselves are proven against a fake provider in connectionTest.test.ts.

/** A CapabilityResult as testConnection returns one. */
type Cap = { capability: string; label: string; ok: boolean; reason: string; errorCode: string | null }
const okCap = (capability: string, label: string): Cap => ({ capability, label, ok: true, reason: '', errorCode: null })
const failCap = (capability: string, label: string, errorCode: string, reason: string): Cap => ({
  capability,
  label,
  ok: false,
  reason,
  errorCode,
})

const CAP_READ = okCap('read_email', 'Read your email')
const CAP_SEND = okCap('send_email', 'Send email as you')
const CAP_CAL = okCap('calendar', 'See and add calendar events')

const TEST_URL = `${URL_A}/conn-google/test`

/** Arrange a testable connection: this rep's row, its mailbox, and the given verdict. */
function arrangeTest(capabilities: Cap[], connectionOverrides: Record<string, unknown> = {}) {
  prismaMock.oAuthConnection.findFirst.mockResolvedValue({ id: 'conn-google', scopes: G_ALL })
  prismaMock.mailAccount.findFirst.mockResolvedValue({ id: 'mail-1' })
  getMailProviderMock.mockResolvedValue({ provider: 'google' })
  testConnectionMock.mockResolvedValue(capabilities)
  getConnectionMock.mockResolvedValue(serializedConn(connectionOverrides))
}

describe('POST /api/integrations/orgs/:orgId/:connectionId/test', () => {
  it('all green: returns ok, writes connected, and STAMPS lastValidatedAt', async () => {
    arrangeTest([CAP_READ, CAP_SEND, CAP_CAL])

    const res = await request(app).post(TEST_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.result.ok).toBe(true)
    expect(res.body.result.errorCode).toBeNull()
    expect(res.body.result.capabilities).toHaveLength(3)

    const write = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(write.where).toEqual({ id: 'conn-google', orgId: ORG_A, userId: 'user-a' })
    expect(write.data.status).toBe('connected')
    expect(write.data.errorCode).toBeNull()
    // Verified is a fact with a timestamp: a clean pass refreshes it.
    expect(write.data.lastValidatedAt).toBeInstanceOf(Date)
  })

  it('one withheld scope: read+calendar stay green, send reads red, connection goes limited', async () => {
    const send = failCap('send_email', 'Send email as you', 'partial_access', 'Permission to send email as you was not granted.')
    arrangeTest([CAP_READ, send, CAP_CAL], { status: 'limited', errorCode: 'partial_access' })

    const res = await request(app).post(TEST_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.result.ok).toBe(false)
    const caps = res.body.result.capabilities as Cap[]
    expect(caps.find((c) => c.capability === 'read_email')!.ok).toBe(true)
    expect(caps.find((c) => c.capability === 'calendar')!.ok).toBe(true)
    expect(caps.find((c) => c.capability === 'send_email')!.ok).toBe(false)

    const write = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(write.data.status).toBe('limited')
    expect(write.data.errorCode).toBe('partial_access')
    // A failed Test must NOT refresh the "Verified" stamp.
    expect(write.data.lastValidatedAt).toBeUndefined()
  })

  it('a revoked token is a 200 with ok:false and token_revoked on the row — never a 500', async () => {
    const dead = (capability: string, label: string) =>
      failCap(capability, label, 'token_revoked', 'The mailbox rejected the saved access.')
    arrangeTest(
      [dead('read_email', 'Read your email'), dead('send_email', 'Send email as you'), dead('calendar', 'See and add calendar events')],
      { status: 'error', errorCode: 'token_revoked' },
    )

    const res = await request(app).post(TEST_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.result.ok).toBe(false)
    expect(res.body.result.errorCode).toBe('token_revoked')

    const write = prismaMock.oAuthConnection.updateMany.mock.calls[0][0]
    expect(write.data.status).toBe('error')
    expect(write.data.errorCode).toBe('token_revoked')
    expect(write.data.lastValidatedAt).toBeUndefined()
  })

  it("404s another rep's connectionId, and never probes it", async () => {
    prismaMock.oAuthConnection.findFirst.mockResolvedValue(null)

    const res = await request(app).post(TEST_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Connection not found' })
    expect(testConnectionMock).not.toHaveBeenCalled()
    // The lookup carried the full tenant boundary: org AND rep.
    expect(prismaMock.oAuthConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conn-google', orgId: ORG_A, userId: 'user-a' }, select: expect.anything() }),
    )
  })

  it('carries no token in the response body', async () => {
    arrangeTest([CAP_READ, CAP_SEND, CAP_CAL])

    const res = await request(app).post(TEST_URL).set('Authorization', AUTH)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('refreshToken')
    expect(body).not.toContain('accessToken')
  })

  it('401s an unauthenticated caller', async () => {
    const res = await request(app).post(TEST_URL)
    expect(res.status).toBe(401)
  })

  it('404s an org the caller does not belong to — never a 403 — before probing', async () => {
    authAs(null)
    const res = await request(app).post(TEST_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.oAuthConnection.findFirst).not.toHaveBeenCalled()
    expect(testConnectionMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST /:connectionId/refresh — the Refresh button
// ============================================================
// refreshConnection (the forced refresh + re-evaluate) is mocked here; its real
// limited→connected behavior is proven in oauthConnections.test.ts. These tests prove
// the route: ownership, the token-free reply, another rep's id → 404, and that a
// revoked grant reports the stamped status rather than 500ing.

const REFRESH_URL = `${URL_A}/conn-google/refresh`

describe('POST /api/integrations/orgs/:orgId/:connectionId/refresh', () => {
  it('forces the refresh scoped to (connectionId, org, rep) and returns the new status', async () => {
    refreshConnectionMock.mockResolvedValue(serializedConn({ status: 'connected' }))

    const res = await request(app).post(REFRESH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.connection.status).toBe('connected')
    expect(refreshConnectionMock).toHaveBeenCalledWith('conn-google', ORG_A, 'user-a')
  })

  it("404s another rep's connectionId (the scoped refresh finds nothing)", async () => {
    refreshConnectionMock.mockResolvedValue(null)

    const res = await request(app).post(REFRESH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Connection not found' })
  })

  it('a revoked grant reports the stamped status (200), never a 500', async () => {
    refreshConnectionMock.mockRejectedValue(new TokenRevokedError())
    getConnectionMock.mockResolvedValue(serializedConn({ status: 'error', errorCode: 'token_revoked' }))

    const res = await request(app).post(REFRESH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.connection.status).toBe('error')
    expect(res.body.connection.errorCode).toBe('token_revoked')
  })

  it('carries no token in the response body', async () => {
    refreshConnectionMock.mockResolvedValue(serializedConn({ status: 'connected' }))

    const res = await request(app).post(REFRESH_URL).set('Authorization', AUTH)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('refreshToken')
    expect(body).not.toContain('accessToken')
  })

  it('401s an unauthenticated caller', async () => {
    const res = await request(app).post(REFRESH_URL)
    expect(res.status).toBe(401)
  })

  it('404s an org the caller does not belong to — never a 403', async () => {
    authAs(null)
    const res = await request(app).post(REFRESH_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(refreshConnectionMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE /:connectionId — the Disconnect button
// ============================================================
// disconnectConnection (the delete + cascade + primary-promotion) is mocked here; its
// real behavior against a live schema — the row and its mailbox gone, the primary
// promoted, an Email row SetNull'd rather than blocking — lives in
// oauthConnection.integration.test.ts. These tests prove the ROUTE: ownership re-proven
// from the path, the scoped call, a 204 with no body on success, another rep's id → 404
// deleting nothing, and no token in any reply.

const DISCONNECT_URL = `${URL_A}/conn-google`

describe('DELETE /api/integrations/orgs/:orgId/:connectionId', () => {
  it('disconnects scoped to (connectionId, org, rep) and answers 204 with no body', async () => {
    disconnectConnectionMock.mockResolvedValue({ provider: 'google' })

    const res = await request(app).delete(DISCONNECT_URL).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(disconnectConnectionMock).toHaveBeenCalledWith('conn-google', ORG_A, 'user-a')
  })

  it("404s another rep's connectionId and deletes nothing (the scoped delete finds nothing)", async () => {
    disconnectConnectionMock.mockResolvedValue(null)

    const res = await request(app).delete(DISCONNECT_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Connection not found' })
  })

  it('401s an unauthenticated caller and never deletes', async () => {
    const res = await request(app).delete(DISCONNECT_URL)

    expect(res.status).toBe(401)
    expect(disconnectConnectionMock).not.toHaveBeenCalled()
  })

  it('404s an org the caller does not belong to — never a 403 — and never deletes', async () => {
    authAs(null)

    const res = await request(app).delete(DISCONNECT_URL).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(disconnectConnectionMock).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET /:provider/callback — the unauthenticated OAuth callback
// ============================================================
// The callback is mounted at /api/integrations (not under /orgs/:orgId), so its path
// is /api/integrations/:provider/callback. saveConnection and markConnectionError are
// stubbed (see the module mock at the top), so these tests prove the callback's
// CONTROL FLOW — state verification, error mapping, the never-green refresh-token
// gate, org-from-state scoping, the failed-repair stamp, and the escaped popup page.
// The real evaluate/store behavior lives in integrations.integration.test.ts.

const CB = (provider: string) => `/api/integrations/${provider}/callback`

/** A token-free connection shape, as the real saveConnection would return. */
function serializedConn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    provider: 'google',
    providerAccountId: 'sub-1',
    emailAddress: 'rep@acme.com',
    scopes: G_ALL,
    status: 'connected',
    errorCode: null,
    statusDetail: null,
    lastValidatedAt: NOW,
    lastRefreshAt: NOW,
    expiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** A signed, valid state for the given claims. Uses the test OAUTH_STATE_SECRET. */
function state(overrides: Partial<{ provider: string; userId: string; orgId: string; mode: 'connect' | 'fix'; connectionId: string | null }> = {}) {
  return signState({
    provider: overrides.provider ?? 'google',
    userId: overrides.userId ?? 'user-a',
    orgId: overrides.orgId ?? ORG_A,
    mode: overrides.mode ?? 'connect',
    connectionId: overrides.connectionId ?? null,
  })
}

/** A full grant a provider client would return from exchangeCode. */
function grant(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'ACCESS-1',
    refreshToken: 'REFRESH-1',
    expiresAt: new Date(NOW.getTime() + 3600_000),
    grantedScopes: G_ALL,
    ...overrides,
  }
}

/** The JSON object the page posts to the opener, parsed back out of the rendered HTML. */
function postedMessage(html: string): Record<string, unknown> {
  const m = html.match(/var result = (\{.*?\});/s)
  if (!m) throw new Error('no posted message found in callback page')
  return JSON.parse(m[1]) as Record<string, unknown>
}

describe('GET /api/integrations/:provider/callback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exchanges, stores, and renders a page that posts connected to the app origin — never *', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockResolvedValue(grant())
    vi.spyOn(googleOAuth, 'fetchIdentity').mockResolvedValue({ providerAccountId: 'sub-1', emailAddress: 'rep@acme.com' })
    saveConnectionMock.mockResolvedValue(serializedConn())

    const res = await request(app).get(CB('google')).query({ code: 'the-code', state: state() })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    // Targeted at the app's own origin, literally, never a wildcard.
    expect(res.text).toContain(`postMessage(result, "${WEB_ORIGIN}")`)
    expect(res.text).not.toContain("postMessage(result, '*'")
    expect(res.text).not.toContain('postMessage(result, "*"')

    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ type: 'maincar:oauth-result', provider: 'google', ok: true, status: 'connected', emailAddress: 'rep@acme.com' })
    // The exchange used the PKCE verifier derived from THIS state, not the raw code alone.
    expect(googleOAuth.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'the-code', codeVerifier: expect.any(String) }))
  })

  it('renders limited when the provider granted only some scopes', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockResolvedValue(grant({ grantedScopes: [G_READ, G_CAL, G_CALENDAR_LIST, G_FREE_BUSY, G_ID] }))
    vi.spyOn(googleOAuth, 'fetchIdentity').mockResolvedValue({ providerAccountId: 'sub-1', emailAddress: 'rep@acme.com' })
    saveConnectionMock.mockResolvedValue(
      serializedConn({ status: 'limited', errorCode: 'partial_access', statusDetail: 'Maincar cannot send email as you.', scopes: [G_READ, G_CAL, G_CALENDAR_LIST, G_FREE_BUSY, G_ID] }),
    )

    const res = await request(app).get(CB('google')).query({ code: 'the-code', state: state() })

    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ status: 'limited', errorCode: 'partial_access', statusDetail: 'Maincar cannot send email as you.' })
  })

  it('verifies the state BEFORE anything else — a tampered state is state_invalid and writes nothing', async () => {
    const exchange = vi.spyOn(googleOAuth, 'exchangeCode')
    const good = state()
    // Tamper the signature by flipping a byte of the DECODED signature, not a
    // base64url character. The final char of a 43-char (32-byte) HMAC segment
    // encodes only 4 significant bits, so ~7% of last-char flips decode to the
    // same bytes and still verify — a genuine ~1-in-15 flake. Flipping a decoded
    // byte cannot alias.
    const [payload, sig] = good.split('.')
    const sigBytes = Buffer.from(sig, 'base64url')
    sigBytes[0] ^= 0xff
    const tampered = `${payload}.${sigBytes.toString('base64url')}`

    const res = await request(app).get(CB('google')).query({ code: 'the-code', state: tampered })

    expect(res.status).toBe(200)
    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ status: 'error', errorCode: 'state_invalid', ok: false })
    expect(exchange).not.toHaveBeenCalled()
    expect(saveConnectionMock).not.toHaveBeenCalled()
    expect(markConnectionErrorMock).not.toHaveBeenCalled()
  })

  it('maps a Microsoft AADSTS65001 exchange failure to admin_approval_required', async () => {
    vi.spyOn(microsoftOAuth, 'exchangeCode').mockRejectedValue(
      new OAuthProviderError('AADSTS65001: The user or administrator has not consented to use the application.'),
    )

    const res = await request(app).get(CB('microsoft')).query({ code: 'the-code', state: state({ provider: 'microsoft' }) })

    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ status: 'error', errorCode: 'admin_approval_required', provider: 'microsoft' })
    expect(saveConnectionMock).not.toHaveBeenCalled()
  })

  it('never writes a connection when Google returns no refresh token', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockResolvedValue(grant({ refreshToken: null }))
    vi.spyOn(googleOAuth, 'fetchIdentity').mockResolvedValue({ providerAccountId: 'sub-1', emailAddress: 'rep@acme.com' })

    const res = await request(app).get(CB('google')).query({ code: 'the-code', state: state() })

    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ status: 'error', errorCode: 'missing_refresh_token', ok: false })
    expect(saveConnectionMock).not.toHaveBeenCalled()
  })

  it('scopes the write to the org named in the SIGNED state, not the request path', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockResolvedValue(grant())
    vi.spyOn(googleOAuth, 'fetchIdentity').mockResolvedValue({ providerAccountId: 'sub-1', emailAddress: 'rep@acme.com' })
    saveConnectionMock.mockResolvedValue(serializedConn())

    await request(app).get(CB('google')).query({ code: 'the-code', state: state({ orgId: 'org-b', userId: 'user-b' }) })

    expect(saveConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-b', userId: 'user-b' }))
  })

  it('rejects a targeted reconnect that signs in to a different provider account', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockResolvedValue(grant())
    vi.spyOn(googleOAuth, 'fetchIdentity').mockResolvedValue({
      providerAccountId: 'sub-other',
      emailAddress: 'other@acme.com',
    })
    prismaMock.oAuthConnection.findFirst.mockResolvedValue({ providerAccountId: 'sub-1' })

    const res = await request(app)
      .get(CB('google'))
      .query({ code: 'the-code', state: state({ mode: 'connect', connectionId: 'conn-google' }) })

    expect(postedMessage(res.text)).toMatchObject({
      status: 'error',
      errorCode: 'account_mismatch',
      ok: false,
    })
    expect(markConnectionErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-google' }),
      'account_mismatch',
      expect.any(String),
    )
    expect(saveConnectionMock).not.toHaveBeenCalled()
  })

  it('stamps the repaired row on a FAILED fix so it cannot keep reading as before', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockRejectedValue(new OAuthProviderError('invalid_grant'))

    const res = await request(app)
      .get(CB('google'))
      .query({ code: 'the-code', state: state({ mode: 'fix', connectionId: 'conn-google' }) })

    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ status: 'error', errorCode: 'token_revoked' })
    expect(markConnectionErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_A, userId: 'user-a', provider: 'google', connectionId: 'conn-google' }),
      'token_revoked',
      expect.any(String),
    )
    expect(saveConnectionMock).not.toHaveBeenCalled()
  })

  it('does NOT stamp a row on a failed FIRST connect — there is no row to stamp', async () => {
    vi.spyOn(googleOAuth, 'exchangeCode').mockRejectedValue(new OAuthProviderError('invalid_grant'))

    await request(app).get(CB('google')).query({ code: 'the-code', state: state({ mode: 'connect' }) })

    expect(markConnectionErrorMock).not.toHaveBeenCalled()
  })

  it("maps the provider's own access_denied redirect to user_cancelled without exchanging", async () => {
    const exchange = vi.spyOn(googleOAuth, 'exchangeCode')

    const res = await request(app).get(CB('google')).query({ state: state(), error: 'access_denied' })

    const msg = postedMessage(res.text)
    expect(msg).toMatchObject({ status: 'error', errorCode: 'user_cancelled' })
    expect(exchange).not.toHaveBeenCalled()
  })

  it('escapes provider text so an email carrying </script> cannot break out of the page', async () => {
    const evilEmail = 'x</script><script>alert(1)</script>@e.com'
    vi.spyOn(googleOAuth, 'exchangeCode').mockResolvedValue(grant())
    vi.spyOn(googleOAuth, 'fetchIdentity').mockResolvedValue({ providerAccountId: 'sub-1', emailAddress: evilEmail })
    saveConnectionMock.mockResolvedValue(serializedConn({ emailAddress: evilEmail }))

    const res = await request(app).get(CB('google')).query({ code: 'the-code', state: state() })

    // The raw closing tag never appears in the payload; its `<` is unicode-escaped.
    expect(res.text).not.toContain('</script><script>alert(1)')
    expect(res.text).toContain('\\u003c/script')
    // And it still round-trips to the intended value once parsed.
    expect(postedMessage(res.text).emailAddress).toBe(evilEmail)
  })

  it('renders an error page (never a redirect) even for an unknown provider path', async () => {
    const res = await request(app).get(CB('slack')).query({ code: 'x', state: state() })

    expect(res.status).toBe(200)
    expect(res.headers.location).toBeUndefined()
    // The signed state carries provider=google, so it verifies; but the path is a
    // browser-facing page regardless. The message still posts to the app origin.
    expect(res.text).toContain(`postMessage(result, "${WEB_ORIGIN}")`)
  })
})
