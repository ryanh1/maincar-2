// Route tests for the invitee's half of the invite flow: the unauthenticated
// lookup and the authenticated accept.
//
// The acceptance criteria these cover come straight off MAI-7: one identical
// answer for every unusable token, email binding, a double-click that cannot
// produce two memberships, and a stored role set that may not grant a platform
// role.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    membership: { upsert: vi.fn() },
    invitation: { findUnique: vi.fn(), updateMany: vi.fn() },
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
const FUTURE = new Date('2026-09-20T12:00:00.000Z')
const PAST = new Date('2026-08-01T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const UNAVAILABLE = { error: 'Invitation unavailable' }

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-invitee',
    firebaseUid: 'uid-invitee',
    email: 'invitee@orga.com',
    firstName: null,
    lastName: null,
    title: null,
    imageUrl: null,
    roles: ['basic'],
    enabled: true,
    timeZone: null,
    currentOrgId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function invitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    token: 'tok-live',
    email: 'invitee@orga.com',
    orgId: 'org-a',
    roles: ['basic', 'admin'],
    status: 'PENDING',
    expiresAt: FUTURE,
    acceptedAt: null,
    acceptedByUserId: null,
    invitedByUserId: 'user-admin',
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: 'org-a', name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-invitee', email: 'invitee@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.membership.upsert.mockResolvedValue({})
  prismaMock.user.update.mockResolvedValue(userRow())
  // The route's transaction body is plain code, so running the callback against
  // the same mocks is what actually exercises it.
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
})

describe('GET /api/public/invitations/:token', () => {
  it('returns only what the join screen renders', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow())

    const res = await request(app).get('/api/public/invitations/tok-live')

    expect(res.status).toBe(200)
    expect(res.body.invitation).toEqual({
      orgName: 'Org A',
      email: 'invitee@orga.com',
      roles: ['basic', 'admin'],
      expiresAt: FUTURE.toISOString(),
    })
    // Anyone holding the link can read this, so it must carry no ids and never
    // echo the token back.
    expect(res.body.invitation.id).toBeUndefined()
    expect(res.body.invitation.orgId).toBeUndefined()
    expect(res.body.invitation.token).toBeUndefined()
  })

  it('needs no Authorization header', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow())

    const res = await request(app).get('/api/public/invitations/tok-live')

    expect(res.status).toBe(200)
  })

  // Four distinguishable errors would be a probing oracle: a scanner could tell
  // a wrong token from a real-but-spent one and learn the org exists.
  it('answers identically for unknown, expired, revoked, and used tokens', async () => {
    const cases = [
      null,
      invitationRow({ status: 'PENDING', expiresAt: PAST }),
      invitationRow({ status: 'REVOKED' }),
      invitationRow({ status: 'ACCEPTED' }),
    ]

    const bodies: unknown[] = []
    const statuses: number[] = []
    for (const row of cases) {
      prismaMock.invitation.findUnique.mockResolvedValue(row)
      const res = await request(app).get('/api/public/invitations/tok-x')
      statuses.push(res.status)
      bodies.push(res.body)
    }

    expect(statuses).toEqual([404, 404, 404, 404])
    for (const body of bodies) expect(body).toEqual(UNAVAILABLE)
  })

  // The admin's list and the invitee's screen must agree about a dead invite.
  it('marks a genuinely expired invite EXPIRED before answering', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      invitationRow({ status: 'PENDING', expiresAt: PAST }),
    )

    await request(app).get('/api/public/invitations/tok-old')

    expect(prismaMock.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })
  })

  it('404s an invite into a disabled org', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      invitationRow({
        org: { id: 'org-a', name: 'Org A', logo: null, enabled: false, createdAt: NOW, updatedAt: NOW },
      }),
    )

    const res = await request(app).get('/api/public/invitations/tok-live')

    expect(res.status).toBe(404)
    expect(res.body).toEqual(UNAVAILABLE)
  })
})

describe('POST /api/invitations/:token/accept', () => {
  it('401s without a token', async () => {
    const res = await request(app).post('/api/invitations/tok-live/accept')

    expect(res.status).toBe(401)
    expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
  })

  it('creates the membership and lands the caller in that org', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow())

    const res = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.membership).toEqual({
      orgId: 'org-a',
      orgName: 'Org A',
      roles: ['admin', 'basic'],
    })
    // upsert, not create: a re-invited former member still has the row, and
    // @@unique([userId, orgId]) would reject a second one.
    expect(prismaMock.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_orgId: { userId: 'user-invitee', orgId: 'org-a' } },
        create: { userId: 'user-invitee', orgId: 'org-a', roles: ['admin', 'basic'] },
        update: { roles: ['admin', 'basic'] },
      }),
    )
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-invitee' },
      data: { currentOrgId: 'org-a' },
    })
  })

  // The guard that makes a double-click safe: the second call claims zero rows
  // and never reaches the membership write.
  it('creates exactly one membership when the invite is claimed twice', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow())
    prismaMock.invitation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const first = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)
    const second = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(prismaMock.membership.upsert).toHaveBeenCalledTimes(1)
  })

  it('409s with both addresses when the signed-in email is not the invited one', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      invitationRow({ email: 'someone.else@orga.com' }),
    )

    const res = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(res.status).toBe(409)
    expect(res.body.status).toBe('email_mismatch')
    expect(res.body.invitedEmail).toBe('someone.else@orga.com')
    expect(res.body.signedInEmail).toBe('invitee@orga.com')
    expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
  })

  it('matches the email case-insensitively', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      invitationRow({ email: 'Invitee@OrgA.com' }),
    )

    const res = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(res.status).toBe(200)
  })

  // A row hand-edited in the database between create and accept must not be able
  // to grant a role the invite endpoint would have refused.
  it('refuses an invite whose stored roles are not assignable', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow({ roles: ['superadmin'] }))

    const res = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual(UNAVAILABLE)
    expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
  })

  it('refuses an invite with an empty role set', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow({ roles: [] }))

    const res = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
  })

  it('gives a revoked link the same answer as an unknown one', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(invitationRow({ status: 'REVOKED' }))

    const res = await request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual(UNAVAILABLE)
    expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
  })
})
