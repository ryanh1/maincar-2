import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// The canonical route-test shape: vi.hoisted() builds the mocks, vi.mock() swaps
// the database and the Firebase SDK, and `app.js` is imported LAST so the mocks
// are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    org: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    membership: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
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
    timeZone: null,
    currentOrgId: 'org-a',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-a',
    name: 'Org A',
    logo: null,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/**
 * One membership joining a user to an org. Roles are PER-ORG now, so this — not
 * `user.roles` — is what decides whether the caller is an admin of this org.
 */
function membershipRow(overrides: Record<string, unknown> = {}) {
  const org = (overrides.org as ReturnType<typeof orgRow>) ?? orgRow()
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: org.id,
    roles: ['admin'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    org,
  }
}

/**
 * Makes the token verify, the user lookup succeed, and the caller belong to the
 * given orgs. Returns the auth header.
 */
function authAs(user = userRow(), memberships = [membershipRow()]): string {
  verifyTokenMock.mockResolvedValue({ uid: user.firebaseUid, email: user.email })
  prismaMock.user.findUnique.mockResolvedValue(user)
  prismaMock.membership.findMany.mockResolvedValue(memberships)
  prismaMock.membership.findFirst.mockResolvedValue(memberships[0] ?? null)
  return 'Bearer fake-token'
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.org.findUniqueOrThrow.mockResolvedValue(orgRow())
  prismaMock.org.findUnique.mockResolvedValue(orgRow())
  prismaMock.membership.findMany.mockResolvedValue([membershipRow()])
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
})

describe('GET /api/health', () => {
  it('answers without auth, because a health check runs before anyone signs in', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('GET /api/auth/me', () => {
  it('401s with no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me')

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Not signed in')
  })

  it('401s when the token does not verify', async () => {
    verifyTokenMock.mockRejectedValue(new Error('invalid signature'))

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope')

    expect(res.status).toBe(401)
  })

  it('returns the keyed user and org for an existing account', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', authAs())

    expect(res.status).toBe(200)
    // Keyed responses, never a bare object.
    expect(res.body.user.id).toBe('user-a')
    expect(res.body.org.id).toBe('org-a')
    // Dates cross the wire as ISO strings, not Date objects.
    expect(res.body.user.createdAt).toBe(NOW.toISOString())
  })

  // Creating an account no longer creates an org (MAI-7). Those are two separate
  // onboarding steps, so that an invited person does not end up owning a second,
  // empty org they never asked for.
  it('provisions a user with NO org on first sign-in', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-new', email: 'new@orgb.com' })
    // Neither the uid lookup nor the email collision check finds anything.
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.create.mockResolvedValue(
      userRow({
        id: 'user-new',
        firebaseUid: 'uid-new',
        email: 'new@orgb.com',
        currentOrgId: null,
      }),
    )
    prismaMock.membership.findMany.mockResolvedValue([])

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('new@orgb.com')
    // No org, no membership, and above all no transaction minting either.
    expect(prismaMock.org.create).not.toHaveBeenCalled()
    expect(prismaMock.membership.create).not.toHaveBeenCalled()
    expect(res.body.org).toBeNull()
    expect(res.body.memberships).toHaveLength(0)
  })

  // A Firebase account deleted and recreated with the same address (a reset
  // emulator locally, a deleted-and-re-invited person in production) arrives with
  // a NEW uid and an email that is already taken. Provisioning would trip the
  // unique-email constraint and 500. Refusing is also what stops a takeover:
  // re-linking would hand this caller the existing user's whole org.
  it('409s when the email already belongs to a different Firebase account', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-recreated', email: 'a@orga.com' })
    prismaMock.user.findUnique
      // by firebaseUid — nothing
      .mockResolvedValueOnce(null)
      // by email — an existing row, owned by a different uid
      .mockResolvedValueOnce(userRow())

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(409)
    expect(res.body.status).toBe('email_already_linked')
    // Nothing was created, so the existing account is untouched.
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('403s a disabled user, because signing out and back in would not help', async () => {
    authAs(userRow({ enabled: false }))

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(403)
  })

  it('403s when every org the user belongs to is disabled', async () => {
    authAs(userRow(), [membershipRow({ org: orgRow({ enabled: false }) })])

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(403)
  })

  // The multi-org half of the rule above: one bad org must not lock a user out of
  // the others. The disabled org is simply never handed back as the active one.
  it('falls back to an enabled org instead of locking out a multi-org user', async () => {
    authAs(userRow({ currentOrgId: 'org-off' }), [
      membershipRow({ id: 'mem-off', orgId: 'org-off', org: orgRow({ id: 'org-off', enabled: false }) }),
      membershipRow({ id: 'mem-on', orgId: 'org-on', org: orgRow({ id: 'org-on' }), roles: ['basic'] }),
    ])
    prismaMock.user.update.mockResolvedValue(userRow({ currentOrgId: 'org-on' }))

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(200)
    expect(res.body.org.id).toBe('org-on')
    // The stale preference is repaired, so the next request does not re-resolve.
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { currentOrgId: 'org-on' },
    })
  })

  it('returns a null org for a user who belongs to none yet', async () => {
    authAs(userRow({ currentOrgId: null }), [])

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(200)
    expect(res.body.org).toBeNull()
    expect(res.body.memberships).toEqual([])
  })

  it('500s without leaking the underlying message when the database throws', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
    prismaMock.user.findUnique.mockRejectedValue(new Error('relation "User" does not exist'))

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
    expect(JSON.stringify(res.body)).not.toContain('does not exist')
  })

  it('503s, not 500, when the database is unreachable, so the client knows to retry', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
    const err = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
    prismaMock.user.findUnique.mockRejectedValue(err)

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(503)
  })
})

describe('PATCH /api/auth/me', () => {
  it('401s without auth', async () => {
    const res = await request(app).patch('/api/auth/me').send({ firstName: 'Ada' })

    expect(res.status).toBe(401)
  })

  it('updates the caller by their own id, never by an id from the body', async () => {
    const auth = authAs()
    prismaMock.user.update.mockResolvedValue(userRow({ firstName: 'Ada' }))

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth)
      .send({ firstName: 'Ada', id: 'user-somebody-else' })

    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { firstName: 'Ada' },
    })
  })

  it('400s on a body that fails validation', async () => {
    const auth = authAs()

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth)
      .send({ firstName: '' })

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('lets an admin of the active org rename it', async () => {
    const auth = authAs(userRow(), [membershipRow({ roles: ['admin'] })])
    prismaMock.user.update.mockResolvedValue(userRow())

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth)
      .send({ orgName: 'Renamed Org' })

    expect(res.status).toBe(200)
    expect(prismaMock.org.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-a' },
      data: { name: 'Renamed Org' },
    })
  })

  // The gate is the caller's role IN THIS ORG. A user who is an admin somewhere
  // else is still a basic member here, and must not be able to rename it.
  it('ignores orgName from a non-admin of the active org', async () => {
    const auth = authAs(userRow(), [membershipRow({ roles: ['basic'] })])
    prismaMock.user.update.mockResolvedValue(userRow())

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth)
      .send({ orgName: 'Hostile Rename' })

    expect(res.status).toBe(200)
    expect(prismaMock.org.updateMany).not.toHaveBeenCalled()
  })
})

describe('unknown routes', () => {
  it('404s with a JSON body, so a fetch() caller can read the error', async () => {
    const res = await request(app).get('/api/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })
})
