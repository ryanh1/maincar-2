// Route tests for /api/team — profile, org CRUD, members, invitations.
//
// The org-isolation block at the bottom proves that a caller from Org A cannot
// reach Org B, and that an unauthenticated caller is rejected.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    org: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    invitation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
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
const AUTH = 'Bearer fake-token'

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

/** Signs the caller in. `membership` is what they hold in the org they ask about. */
function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  // The gate looks the caller's membership up per request; null means "not a member".
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
})

describe('GET /api/team/profile', () => {
  it('401s without auth', async () => {
    const res = await request(app).get('/api/team/profile')

    expect(res.status).toBe(401)
  })

  it('returns the keyed profile of the caller', async () => {
    const res = await request(app).get('/api/team/profile').set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe('user-a')
    expect(res.body.user.createdAt).toBe(NOW.toISOString())
  })
})

describe('PATCH /api/team/profile', () => {
  it('updates the caller by their own id, never by an id from the body', async () => {
    prismaMock.user.update.mockResolvedValue(userRow({ firstName: 'Ada' }))

    const res = await request(app)
      .patch('/api/team/profile')
      .set('Authorization', AUTH)
      .send({ firstName: 'Ada' })

    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { firstName: 'Ada' },
    })
  })

  it('400s on an unknown field rather than silently ignoring it', async () => {
    const res = await request(app)
      .patch('/api/team/profile')
      .set('Authorization', AUTH)
      .send({ id: 'user-somebody-else', roles: ['admin'] })

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('400s when the body updates nothing', async () => {
    const res = await request(app).patch('/api/team/profile').set('Authorization', AUTH).send({})

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('clears a field when sent an empty string', async () => {
    prismaMock.user.update.mockResolvedValue(userRow({ title: null }))

    const res = await request(app)
      .patch('/api/team/profile')
      .set('Authorization', AUTH)
      .send({ title: '' })

    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-a' },
      data: { title: null },
    })
  })
})

describe('GET /api/team/orgs', () => {
  it('lists every org the caller belongs to, with their role in each', async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      membershipRow({ orgId: 'org-a', org: orgRow(), roles: ['admin'] }),
      membershipRow({ id: 'mem-b', orgId: 'org-b', org: orgRow({ id: 'org-b' }), roles: ['basic'] }),
    ])

    const res = await request(app).get('/api/team/orgs').set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.orgs).toHaveLength(2)
    expect(res.body.orgs[0].roles).toEqual(['admin'])
    expect(res.body.orgs[1].roles).toEqual(['basic'])
  })

  it('scopes the list to the caller, and hides disabled orgs', async () => {
    prismaMock.membership.findMany.mockResolvedValue([])

    await request(app).get('/api/team/orgs').set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', isActive: true, org: { enabled: true } },
      }),
    )
  })
})

describe('POST /api/team/orgs', () => {
  it('creates the org and makes the caller its admin', async () => {
    prismaMock.$transaction.mockResolvedValue(orgRow({ id: 'org-new', name: 'New Co' }))

    const res = await request(app)
      .post('/api/team/orgs')
      .set('Authorization', AUTH)
      .send({ name: 'New Co' })

    expect(res.status).toBe(201)
    expect(res.body.org.name).toBe('New Co')
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('400s without a name', async () => {
    const res = await request(app).post('/api/team/orgs').set('Authorization', AUTH).send({})

    expect(res.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/team/orgs/:orgId', () => {
  it('lets an admin of that org rename it', async () => {
    prismaMock.org.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.org.findUniqueOrThrow.mockResolvedValue(orgRow({ name: 'Renamed' }))

    const res = await request(app)
      .patch('/api/team/orgs/org-a')
      .set('Authorization', AUTH)
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    expect(res.body.org.name).toBe('Renamed')
  })

  // updateMany, not update: the org boundary lives in the where clause, so a
  // caller who got past the gate still cannot write a different org.
  it('scopes the write by org id', async () => {
    prismaMock.org.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.org.findUniqueOrThrow.mockResolvedValue(orgRow())

    await request(app)
      .patch('/api/team/orgs/org-a')
      .set('Authorization', AUTH)
      .send({ name: 'Renamed' })

    expect(prismaMock.org.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-a' },
      data: { name: 'Renamed' },
    })
  })

  it('403s a member who is not an admin of that org', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app)
      .patch('/api/team/orgs/org-a')
      .set('Authorization', AUTH)
      .send({ name: 'Hostile Rename' })

    expect(res.status).toBe(403)
    expect(prismaMock.org.updateMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/team/orgs/:orgId/invitations', () => {
  it('creates a pending invite and returns the link', async () => {
    prismaMock.membership.findFirst
      // the gate: the caller is an admin here
      .mockResolvedValueOnce(membershipRow())
      // the "already a member?" check: nobody with that email yet
      .mockResolvedValueOnce(null)
    // the "already invited?" check: no live invite for that address either
    prismaMock.invitation.findFirst.mockResolvedValue(null)
    prismaMock.invitation.create.mockResolvedValue({
      id: 'inv-1',
      token: 'tok-1',
      email: 'new@orga.com',
      orgId: 'org-a',
      roles: ['basic'],
      status: 'PENDING',
      expiresAt: NOW,
      createdAt: NOW,
    })

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'new@orga.com' })

    expect(res.status).toBe(201)
    expect(res.body.invitation.email).toBe('new@orga.com')
    expect(res.body.invitation.inviteUrl).toContain('/join/tok-1')
    // The token is the secret in the link; it is never echoed as its own field.
    expect(res.body.invitation.token).toBeUndefined()
  })

  // Without a closed role list an admin could mint an invite carrying any string,
  // and whatever accepts it would write that straight onto a Membership.
  it('400s on a role outside the allowed set', async () => {
    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'new@orga.com', roles: ['superadmin'] })

    expect(res.status).toBe(400)
    expect(prismaMock.invitation.create).not.toHaveBeenCalled()
  })

  it('400s on an invalid email', async () => {
    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(prismaMock.invitation.create).not.toHaveBeenCalled()
  })

  it('409s when that person already belongs to the org', async () => {
    prismaMock.membership.findFirst
      .mockResolvedValueOnce(membershipRow())
      .mockResolvedValueOnce(membershipRow({ id: 'mem-existing' }))

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'a@orga.com' })

    expect(res.status).toBe(409)
    expect(prismaMock.invitation.create).not.toHaveBeenCalled()
  })

  it('403s a member who is not an admin of that org', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'new@orga.com' })

    expect(res.status).toBe(403)
    expect(prismaMock.invitation.create).not.toHaveBeenCalled()
  })

  // A second live invite for the same address leaves the admin with two links
  // and no way to tell which one they already sent. Overwriting the token
  // silently would be worse: it kills a link that may already be in an inbox.
  it('409s when that address already has a live invite', async () => {
    prismaMock.membership.findFirst
      .mockResolvedValueOnce(membershipRow())
      .mockResolvedValueOnce(null)
    prismaMock.invitation.findFirst.mockResolvedValue({ id: 'inv-live', status: 'PENDING' })

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'new@orga.com' })

    expect(res.status).toBe(409)
    expect(prismaMock.invitation.create).not.toHaveBeenCalled()
  })

  // Roles are stored deduped and sorted, so ["admin","admin","basic"] and
  // ["basic","admin"] land as the same row and compare equal.
  it('dedupes and sorts the roles it stores', async () => {
    prismaMock.membership.findFirst
      .mockResolvedValueOnce(membershipRow())
      .mockResolvedValueOnce(null)
    prismaMock.invitation.findFirst.mockResolvedValue(null)
    prismaMock.invitation.create.mockResolvedValue({
      id: 'inv-2',
      token: 'tok-2',
      email: 'new@orga.com',
      orgId: 'org-a',
      roles: ['admin', 'basic'],
      status: 'PENDING',
      expiresAt: NOW,
      createdAt: NOW,
    })

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)
      .send({ email: 'new@orga.com', roles: ['admin', 'admin', 'basic'] })

    expect(res.status).toBe(201)
    expect(prismaMock.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roles: ['admin', 'basic'] }) }),
    )
  })
})

describe('POST /api/team/orgs/:orgId/invitations/:id/regenerate', () => {
  it('mints a new token and returns the new link', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.invitation.findUniqueOrThrow.mockResolvedValue({
      id: 'inv-1',
      token: 'tok-fresh',
      email: 'new@orga.com',
      orgId: 'org-a',
      roles: ['basic'],
      status: 'PENDING',
      expiresAt: NOW,
      createdAt: NOW,
    })

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations/inv-1/regenerate')
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.invitation.inviteUrl).toContain('/join/tok-fresh')
    // Scoped by orgId, so an admin of one org cannot regenerate another's invite.
    expect(prismaMock.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'inv-1', orgId: 'org-a', status: 'PENDING' }),
      }),
    )
  })

  it('404s an invite that is not pending in this org', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations/inv-other/regenerate')
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
  })

  it('403s a member who is not an admin of that org', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app)
      .post('/api/team/orgs/org-a/invitations/inv-1/regenerate')
      .set('Authorization', AUTH)

    expect(res.status).toBe(403)
    expect(prismaMock.invitation.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/team/orgs/:orgId/invitations/:invitationId', () => {
  it('revokes the invite, scoped by org so ids cannot be guessed across orgs', async () => {
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 })

    const res = await request(app)
      .delete('/api/team/orgs/org-a/invitations/inv-1')
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', orgId: 'org-a', status: 'PENDING' },
      data: { status: 'REVOKED' },
    })
  })

  it('404s when the invite belongs to another org', async () => {
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app)
      .delete('/api/team/orgs/org-a/invitations/inv-from-org-b')
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
  })

  it('403s a member who is not an admin of that org', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app)
      .delete('/api/team/orgs/org-a/invitations/inv-1')
      .set('Authorization', AUTH)

    expect(res.status).toBe(403)
    expect(prismaMock.invitation.updateMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/team/orgs/:orgId/invitations', () => {
  it('lists pending invites with their links', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.invitation.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        token: 'tok-1',
        email: 'new@orga.com',
        orgId: 'org-a',
        roles: ['basic'],
        status: 'PENDING',
        expiresAt: NOW,
        createdAt: NOW,
      },
    ])

    const res = await request(app)
      .get('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.invitations[0].inviteUrl).toContain('/join/tok-1')
    // The token is the secret in the link; it is never its own field.
    expect(res.body.invitations[0].token).toBeUndefined()
  })

  // The admin's table must never offer a Copy button for a link that has already
  // stopped working, so the read flips anything past its expiry first.
  it('expires stale invites before listing, scoped to this org', async () => {
    prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.invitation.findMany.mockResolvedValue([])

    await request(app).get('/api/team/orgs/org-a/invitations').set('Authorization', AUTH)

    expect(prismaMock.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'org-a', status: 'PENDING' }),
        data: { status: 'EXPIRED' },
      }),
    )
  })

  // This is the route that hands back every live token, so the admin gate on it
  // is what stops a plain member from reading them.
  it('403s a member who is not an admin, so no token reaches them', async () => {
    authAs(membershipRow({ roles: ['basic'] }))

    const res = await request(app)
      .get('/api/team/orgs/org-a/invitations')
      .set('Authorization', AUTH)

    expect(res.status).toBe(403)
    expect(res.body.invitations).toBeUndefined()
    expect(prismaMock.invitation.findMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// Org isolation — the mandatory block (.claude/rules/testing.md)
// ============================================================
describe('org isolation', () => {
  const ORG_SCOPED_ROUTES = [
    { method: 'get' as const, path: '/api/team/orgs/org-b' },
    { method: 'patch' as const, path: '/api/team/orgs/org-b' },
    { method: 'post' as const, path: '/api/team/orgs/org-b/switch' },
    { method: 'get' as const, path: '/api/team/orgs/org-b/members' },
    { method: 'get' as const, path: '/api/team/orgs/org-b/invitations' },
    { method: 'post' as const, path: '/api/team/orgs/org-b/invitations' },
    { method: 'delete' as const, path: '/api/team/orgs/org-b/invitations/inv-1' },
    { method: 'post' as const, path: '/api/team/orgs/org-b/invitations/inv-1/regenerate' },
  ]

  for (const route of ORG_SCOPED_ROUTES) {
    it(`401s an unauthenticated caller on ${route.method.toUpperCase()} ${route.path}`, async () => {
      const res = await request(app)[route.method](route.path).send({})

      expect(res.status).toBe(401)
    })

    // 404, not 403: telling a stranger the org is real but off-limits confirms it
    // exists. A caller with no membership gets the same answer either way.
    it(`404s a caller from another org on ${route.method.toUpperCase()} ${route.path}`, async () => {
      authAs(null)

      const res = await request(app)[route.method](route.path).set('Authorization', AUTH).send({})

      expect(res.status).toBe(404)
      expect(prismaMock.org.updateMany).not.toHaveBeenCalled()
      expect(prismaMock.invitation.create).not.toHaveBeenCalled()
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    // A membership in a DISABLED org is not a way in either.
    it(`404s when the org is disabled on ${route.method.toUpperCase()} ${route.path}`, async () => {
      authAs(membershipRow({ orgId: 'org-b', org: orgRow({ id: 'org-b', enabled: false }) }))

      const res = await request(app)[route.method](route.path).set('Authorization', AUTH).send({})

      expect(res.status).toBe(404)
    })
  }

  it('scopes the membership lookup to the caller, never to an id from the path', async () => {
    authAs(null)

    await request(app).get('/api/team/orgs/org-b').set('Authorization', AUTH)

    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', orgId: 'org-b', isActive: true } }),
    )
  })
})
