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
// returns one card per provider with one connection null; and no response body ever
// carries a token or an authorization code.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    oAuthConnection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  verifyTokenMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const URL_A = `/api/integrations/orgs/${ORG_A}`

// The four Google scope params, verbatim from oauthScopes.ts.
const G_READ = 'https://www.googleapis.com/auth/gmail.readonly'
const G_SEND = 'https://www.googleapis.com/auth/gmail.send'
const G_CAL = 'https://www.googleapis.com/auth/calendar.events'
const G_ID = 'https://www.googleapis.com/auth/userinfo.email'

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
    scopes: [G_READ, G_SEND, G_CAL, G_ID],
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
    for (const s of [G_READ, G_SEND, G_CAL, G_ID]) expect(scope).toContain(s)
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
    // Granted three of four; gmail.send is missing.
    prismaMock.oAuthConnection.findFirst.mockResolvedValue({
      id: 'conn-google',
      emailAddress: 'rep@acme.com',
      scopes: [G_READ, G_CAL, G_ID],
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
      scopes: [G_READ, G_SEND, G_CAL, G_ID],
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
  it('returns one card per provider, with a connection null where nothing is connected', async () => {
    prismaMock.oAuthConnection.findMany.mockResolvedValue([connectionRow()])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.integrations.map((c: { provider: string }) => c.provider)).toEqual(['google', 'microsoft'])

    const google = res.body.integrations.find((c: { provider: string }) => c.provider === 'google')
    const microsoft = res.body.integrations.find((c: { provider: string }) => c.provider === 'microsoft')

    expect(google.providerLabel).toBe('Google')
    expect(google.requiredPermissions).toContain('Send email as you')
    expect(google.connection.emailAddress).toBe('rep@acme.com')

    expect(microsoft.providerLabel).toBe('Microsoft')
    expect(microsoft.connection).toBeNull()
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
