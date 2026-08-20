import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// The canonical route-test shape: vi.hoisted() builds the mocks, vi.mock() swaps
// the database and the Firebase SDK, and `app.js` is imported LAST so the mocks
// are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    org: { create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
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
    roles: ['admin'],
    enabled: true,
    timeZone: null,
    orgId: 'org-a',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-a',
    name: 'Org A',
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Makes the token verify and the user lookup succeed. Returns the auth header. */
function authAs(user = userRow()): string {
  verifyTokenMock.mockResolvedValue({ uid: user.firebaseUid, email: user.email })
  prismaMock.user.findUnique.mockResolvedValue({ ...user, org: { enabled: true } })
  return 'Bearer fake-token'
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.org.findUniqueOrThrow.mockResolvedValue(orgRow())
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

  it('provisions an org and an admin on first sign-in', async () => {
    verifyTokenMock.mockResolvedValue({ uid: 'uid-new', email: 'new@orgb.com' })
    // Neither the uid lookup nor the email collision check finds anything.
    prismaMock.user.findUnique.mockResolvedValue(null)
    const provisioned = userRow({ id: 'user-new', firebaseUid: 'uid-new', email: 'new@orgb.com' })
    prismaMock.$transaction.mockResolvedValue(provisioned)

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(res.body.user.email).toBe('new@orgb.com')
    // The person who creates the org runs it.
    expect(res.body.user.roles).toContain('admin')
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

  it('403s when the org is disabled, even though the user is fine', async () => {
    authAs()
    prismaMock.org.findUniqueOrThrow.mockResolvedValue(orgRow({ enabled: false }))

    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token')

    expect(res.status).toBe(403)
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

  it('lets an admin rename the org', async () => {
    const auth = authAs(userRow({ roles: ['admin'] }))
    prismaMock.user.update.mockResolvedValue(userRow())

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth)
      .send({ orgName: 'Renamed Org' })

    expect(res.status).toBe(200)
    expect(prismaMock.org.update).toHaveBeenCalledWith({
      where: { id: 'org-a' },
      data: { name: 'Renamed Org' },
    })
  })

  it('ignores orgName from a non-admin instead of renaming the org', async () => {
    const auth = authAs(userRow({ roles: ['basic'] }))
    prismaMock.user.update.mockResolvedValue(userRow({ roles: ['basic'] }))

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', auth)
      .send({ orgName: 'Hostile Rename' })

    expect(res.status).toBe(200)
    expect(prismaMock.org.update).not.toHaveBeenCalled()
  })
})

describe('unknown routes', () => {
  it('404s with a JSON body, so a fetch() caller can read the error', async () => {
    const res = await request(app).get('/api/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Not found')
  })
})
