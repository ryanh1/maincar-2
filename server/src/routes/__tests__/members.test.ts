// Route tests for /api/orgs/:orgId/members — the member list and its two writes.
//
// What these exist to protect (MAI-6):
//   - the list pages, sorts, and searches in the DATABASE, not in the client
//   - a sort key is user input, so it goes through an allow-list and never
//     reaches Prisma raw
//   - the last-admin guardrail, counted and written in ONE transaction
//   - "owner" is never granted, cleared, or removed from this list
//   - the mandatory org-isolation four (.claude/rules/testing.md)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, revokeTokensMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    membership: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    emailTemplate: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  revokeTokensMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
  revokeFirebaseRefreshTokens: revokeTokensMock,
}))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'

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
    currentOrgId: ORG_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW, ...overrides }
}

/** The CALLER's own membership — what `requireMembership` reads. */
function callerMembership(overrides: Record<string, unknown> = {}) {
  const org = (overrides.org as ReturnType<typeof orgRow>) ?? orgRow()
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: org.id,
    roles: ['admin'],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    org,
  }
}

/** A row in the list, as `findMany({ include: { user: … } })` returns it. */
function memberRow(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'user-b',
    email: 'b@orga.com',
    firstName: 'Bee',
    lastName: 'Ta',
    title: null,
    imageUrl: null,
    enabled: true,
    ...((overrides.user as Record<string, unknown>) ?? {}),
  }
  return {
    id: 'mem-b',
    userId: user.id,
    orgId: ORG_A,
    roles: ['basic'],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    user,
  }
}

/** The TARGET of a write — what the route looks up before it acts. */
function targetMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-b',
    userId: 'user-b',
    orgId: ORG_A,
    roles: ['basic'],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    user: { firebaseUid: 'uid-b' },
    ...overrides,
  }
}

/**
 * Signs the caller in.
 *
 * `membership.findFirst` answers two different questions in these routes — the
 * caller's own gate, then the write's target — so it is queued in that order.
 */
function authAs(
  caller: ReturnType<typeof callerMembership> | null = callerMembership(),
  target?: ReturnType<typeof targetMembership> | null,
): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockReset()
  prismaMock.membership.findFirst.mockResolvedValueOnce(caller)
  if (target !== undefined) prismaMock.membership.findFirst.mockResolvedValueOnce(target)
  prismaMock.membership.findFirst.mockResolvedValue(null)
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.membership.count.mockResolvedValue(2)
  // The guardrail counts admins with their rows LOCKED, which only raw SQL can
  // express, so it reads this rather than `membership.count`.
  prismaMock.$queryRaw.mockResolvedValue([{ count: 2n }])
  prismaMock.membership.findMany.mockResolvedValue([])
  prismaMock.membership.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.emailTemplate.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 })
  revokeTokensMock.mockResolvedValue(undefined)
  // The routes' transaction bodies are plain code, so running the callback
  // against the same mocks is what actually exercises them.
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
  authAs()
})

describe('GET /api/orgs/:orgId/members', () => {
  it('401s without auth', async () => {
    const res = await request(app).get(`/api/orgs/${ORG_A}/members`)

    expect(res.status).toBe(401)
  })

  it('404s a caller who is not a member of the org in the path', async () => {
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_B}/members`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.membership.findMany).not.toHaveBeenCalled()
  })

  it('lets a non-admin member read the list', async () => {
    authAs(callerMembership({ roles: ['basic'] }))
    prismaMock.membership.findMany.mockResolvedValue([memberRow()])

    const res = await request(app).get(`/api/orgs/${ORG_A}/members`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.members).toHaveLength(1)
    expect(res.body.members[0].userId).toBe('user-b')
    expect(res.body.viewerRoles).toEqual(['basic'])
  })

  it('reports how many admins are left, so the client can grey out the last one', async () => {
    prismaMock.membership.count.mockResolvedValue(1)

    const res = await request(app).get(`/api/orgs/${ORG_A}/members`).set('Authorization', AUTH)

    expect(res.body.meta.activeAdminCount).toBe(1)
    expect(prismaMock.membership.count).toHaveBeenCalledWith({
      where: { orgId: ORG_A, isActive: true, roles: { hasSome: ['owner', 'admin'] } },
    })
  })

  it('pages in the database — never a client-side slice', async () => {
    await request(app).get(`/api/orgs/${ORG_A}/members?page=3`).set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    )
  })

  it('serves the 200-row ceiling a picker asks for, and no more', async () => {
    await request(app).get(`/api/orgs/${ORG_A}/members?limit=200`).set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 200 }),
    )

    // Past the ceiling the request is not clamped, it falls back to the default.
    // One caller must not be able to turn this list into an outage.
    authAs()
    await request(app).get(`/api/orgs/${ORG_A}/members?limit=5000`).set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 25 }),
    )
  })

  it('renders the default list for a broken query string instead of a 400', async () => {
    const res = await request(app)
      .get(`/api/orgs/${ORG_A}/members?page=zero&limit=-4&sort=DROP+TABLE&dir=sideways`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(25)
    // The rejected sort key falls back to joinedAt, and never reaches Prisma.
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { createdAt: 'asc' }] }),
    )
  })

  it('tie-breaks every sort on createdAt, so page 2 is not a reshuffle of page 1', async () => {
    for (const sort of ['name', 'email', 'roles', 'joinedAt']) {
      await request(app)
        .get(`/api/orgs/${ORG_A}/members?sort=${sort}`)
        .set('Authorization', AUTH)
      const call = prismaMock.membership.findMany.mock.lastCall![0] as {
        orderBy: Record<string, unknown>[]
      }
      expect(call.orderBy.at(-1)).toEqual({ createdAt: 'asc' })
      authAs()
    }
  })

  it('sorts unnamed members by email rather than dumping them at the end', async () => {
    await request(app).get(`/api/orgs/${ORG_A}/members?sort=name`).set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { user: { firstName: { sort: 'asc', nulls: 'last' } } },
          { user: { lastName: { sort: 'asc', nulls: 'last' } } },
          { user: { email: 'asc' } },
          { createdAt: 'asc' },
        ],
      }),
    )
  })

  it('falls back to email order for the role column, with no raw SQL', async () => {
    await request(app).get(`/api/orgs/${ORG_A}/members?sort=roles`).set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ user: { email: 'asc' } }, { createdAt: 'asc' }] }),
    )
  })

  it('searches name and email in the database, case-insensitively', async () => {
    await request(app).get(`/api/orgs/${ORG_A}/members?q=Bee`).set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId: ORG_A,
          isActive: true,
          OR: [
            { user: { firstName: { contains: 'Bee', mode: 'insensitive' } } },
            { user: { lastName: { contains: 'Bee', mode: 'insensitive' } } },
            { user: { email: { contains: 'Bee', mode: 'insensitive' } } },
          ],
        },
      }),
    )
  })

  it('filters by role in the database, so the total and the pages stay honest', async () => {
    await request(app)
      .get(`/api/orgs/${ORG_A}/members?role=admin&role=basic`)
      .set('Authorization', AUTH)

    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roles: { hasSome: ['admin', 'basic'] } }),
      }),
    )
    // The same filter reaches the count, or page 2 would page against a set the
    // server never counted.
    expect(prismaMock.membership.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ roles: { hasSome: ['admin', 'basic'] } }),
    })
  })

  it('drops a role value outside the vocabulary rather than refusing', async () => {
    const res = await request(app)
      .get(`/api/orgs/${ORG_A}/members?role=superadmin`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    const where = (prismaMock.membership.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
    }).where
    expect(where.roles).toBeUndefined()
  })

  it('hides a deactivated membership from the list and the count', async () => {
    await request(app).get(`/api/orgs/${ORG_A}/members`).set('Authorization', AUTH)

    for (const call of [
      prismaMock.membership.findMany.mock.calls[0],
      prismaMock.membership.count.mock.calls[0],
    ]) {
      expect((call![0] as { where: Record<string, unknown> }).where).toMatchObject({
        orgId: ORG_A,
        isActive: true,
      })
    }
  })
})

describe('PATCH /api/orgs/:orgId/members/:userId', () => {
  it('401s without auth', async () => {
    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .send({ roles: ['admin'] })

    expect(res.status).toBe(401)
  })

  it('403s a member who is not an admin, and writes nothing', async () => {
    authAs(callerMembership({ roles: ['basic'] }))

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['admin'] })

    expect(res.status).toBe(403)
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('404s an admin of another org, and writes nothing', async () => {
    authAs(null)

    const res = await request(app)
      .patch(`/api/orgs/${ORG_B}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['admin'] })

    expect(res.status).toBe(404)
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('refuses an empty role set rather than defaulting it', async () => {
    authAs(callerMembership(), targetMembership())

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: [] })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Pick at least one role.')
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a platform role and the owner role', async () => {
    for (const roles of [['superadmin'], ['owner'], ['owner', 'admin']]) {
      authAs(callerMembership(), targetMembership())

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles })

      expect(res.status).toBe(400)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    }
  })

  it("refuses to edit the owner's row", async () => {
    authAs(callerMembership(), targetMembership({ roles: ['owner'] }))

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['basic'] })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe(
      "The owner's role changes by transferring ownership, not from this list.",
    )
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('404s a target who is no longer an active member', async () => {
    authAs(callerMembership(), null)

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-gone`)
      .set('Authorization', AUTH)
      .send({ roles: ['admin'] })

    expect(res.status).toBe(404)
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('treats an unchanged SET as a no-op, whatever order the boxes were ticked', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['admin', 'basic'] }))

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['basic', 'admin'] })

    expect(res.status).toBe(200)
    expect(res.body.member.roles).toEqual(['admin', 'basic'])
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('writes through updateMany scoped by orgId, never update by id', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['basic'] }))

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['admin'] })

    expect(res.status).toBe(200)
    expect(res.body.member).toEqual({ userId: 'user-b', roles: ['admin'] })
    expect(prismaMock.membership.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-b', orgId: ORG_A, isActive: true },
      data: { roles: ['admin'] },
    })
  })

  it('409s the demotion that would leave the org with no admin', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['admin'] }))
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1n }])

    const res = await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['basic'] })

    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      'Promote someone else to admin first. An org always keeps at least one admin.',
    )
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('LOCKS the admin rows inside the transaction, so two demotions cannot both pass', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['admin'] }))

    await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['basic'] })

    // A plain count lets both racers read "2 admins" and both commit. The guard
    // runs inside the transaction the route opened, and takes a row lock.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const guardOrder = prismaMock.$queryRaw.mock.invocationCallOrder[0]!
    const txOrder = prismaMock.$transaction.mock.invocationCallOrder[0]!
    expect(guardOrder).toBeGreaterThan(txOrder)
    expect((prismaMock.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain('FOR UPDATE')
  })

  it('does not run the guardrail when the change keeps admin authority', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['admin'] }))

    await request(app)
      .patch(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)
      .send({ roles: ['admin', 'basic'] })

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.membership.updateMany).toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/members/:userId', () => {
  it('401s without auth', async () => {
    const res = await request(app).delete(`/api/orgs/${ORG_A}/members/user-b`)

    expect(res.status).toBe(401)
  })

  it('403s a member who is not an admin, and writes nothing', async () => {
    authAs(callerMembership({ roles: ['basic'] }))

    const res = await request(app)
      .delete(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(403)
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('404s an admin of another org, and writes nothing', async () => {
    authAs(null)

    const res = await request(app)
      .delete(`/api/orgs/${ORG_B}/members/user-b`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('deactivates the membership and leaves the User account alone', async () => {
    authAs(callerMembership(), targetMembership())

    const res = await request(app)
      .delete(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.membership.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-b', orgId: ORG_A, isActive: true },
      data: { isActive: false },
    })
    // Removing someone from Org A must not lock them out of Org B, so the
    // account is never disabled and never deleted.
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('clears currentOrgId only when it pointed at THIS org', async () => {
    authAs(callerMembership(), targetMembership())

    await request(app).delete(`/api/orgs/${ORG_A}/members/user-b`).set('Authorization', AUTH)

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-b', currentOrgId: ORG_A },
      data: { currentOrgId: null },
    })
  })

  it('deletes the removed member’s private templates in this organization only', async () => {
    authAs(callerMembership(), targetMembership())

    await request(app).delete(`/api/orgs/${ORG_A}/members/user-b`).set('Authorization', AUTH)

    expect(prismaMock.emailTemplate.deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, createdById: 'user-b', visibility: 'PRIVATE' },
    })
  })

  it('cuts live sessions after the transaction, keyed on the Firebase uid', async () => {
    authAs(callerMembership(), targetMembership())

    await request(app).delete(`/api/orgs/${ORG_A}/members/user-b`).set('Authorization', AUTH)

    expect(revokeTokensMock).toHaveBeenCalledWith('uid-b')
  })

  it('still reports success when revoking the session fails', async () => {
    authAs(callerMembership(), targetMembership())
    revokeTokensMock.mockRejectedValue(new Error('firebase is down'))

    const res = await request(app)
      .delete(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)

    // Access is already gone, so a failure here is logged, not fatal — and it
    // must not roll back a removal that succeeded.
    expect(res.status).toBe(200)
    expect(prismaMock.membership.updateMany).toHaveBeenCalled()
  })

  it('refuses to remove the owner', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['owner'] }))

    const res = await request(app)
      .delete(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Transfer ownership before removing the owner.')
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })

  it('409s the removal that would leave the org with no admin', async () => {
    authAs(callerMembership(), targetMembership({ roles: ['admin'] }))
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1n }])

    const res = await request(app)
      .delete(`/api/orgs/${ORG_A}/members/user-b`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      'Promote someone else to admin first. An org always keeps at least one admin.',
    )
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    expect(revokeTokensMock).not.toHaveBeenCalled()
  })

  it('404s a target who is already deactivated', async () => {
    authAs(callerMembership(), null)

    const res = await request(app)
      .delete(`/api/orgs/${ORG_A}/members/user-gone`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
  })
})

describe('a removed member loses access on their next request', () => {
  it('the org gate reads isActive, so a deactivated seat answers 404', async () => {
    // `requireMembership` finds nothing, because its filter includes isActive.
    authAs(null)

    const res = await request(app).get(`/api/orgs/${ORG_A}/members`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', orgId: ORG_A, isActive: true },
      }),
    )
  })
})
