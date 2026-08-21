// MAI-8 — the cross-cutting membership guardrail matrix.
//
// Every rule below is IMPLEMENTED somewhere else: in the members routes (MAI-6),
// the team/invitation routes, or the invitee routes (MAI-7). This file is the one
// place that proves ALL of them, so a future change cannot quietly remove one and
// still ship green.
//
// The suite is TABLE-DRIVEN on purpose: a new guardrail is one row, not a new
// describe. Each row carries its G-number, so a failure names the rule it broke.
//
// Where the rest of the matrix lives:
//   - G3  (two genuinely concurrent demotions), G4, G5, G9, G16, G18, G22 and G23
//     are proved against a REAL Postgres in guardrails.integration.test.ts. A
//     mocked Prisma cannot prove a row lock, a unique constraint, or that an
//     inactive row is excluded — only that the route asked. Rows for those here
//     assert the ASK; the integration file asserts the ANSWER.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'

const { prismaMock, verifyTokenMock, revokeTokensMock, loggerMock, logCalls } = vi.hoisted(() => {
  const logCalls: unknown[][] = []
  const record =
    () =>
    (...args: unknown[]) => {
      logCalls.push(args)
    }
  return {
    prismaMock: {
      user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      membership: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
      invitation: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      org: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
      $transaction: vi.fn(),
      $queryRaw: vi.fn(),
    },
    verifyTokenMock: vi.fn(),
    revokeTokensMock: vi.fn(),
    // G27 needs to read what the app logged, so the logger is a recorder rather
    // than a silenced pino.
    loggerMock: { info: vi.fn(record()), warn: vi.fn(record()), error: vi.fn(record()), debug: vi.fn(record()) },
    logCalls,
  }
})

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
  revokeFirebaseRefreshTokens: revokeTokensMock,
}))
vi.mock('../../../dependencies/logger.js', () => ({ logger: loggerMock }))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const FUTURE = new Date('2026-09-20T12:00:00.000Z')
const PAST = new Date('2026-08-01T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'

const LAST_ADMIN_ERROR =
  'Promote someone else to admin first. An org always keeps at least one admin.'
const OWNER_ROLE_ERROR =
  "The owner's role changes by transferring ownership, not from this list."
const OWNER_REMOVE_ERROR = 'Transfer ownership before removing the owner.'
const UNAVAILABLE = { error: 'Invitation unavailable' }

// --- Row builders -------------------------------------------------------------

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

function invitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    token: 'tok-live',
    email: 'a@orga.com',
    orgId: ORG_A,
    roles: ['basic'],
    status: 'PENDING',
    expiresAt: FUTURE,
    acceptedAt: null,
    acceptedByUserId: null,
    invitedByUserId: 'user-admin',
    createdAt: NOW,
    updatedAt: NOW,
    org: orgRow(),
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

/** The `data` a `membership.updateMany` was called with, for role assertions. */
function lastRoleWrite(): string[] {
  const call = prismaMock.membership.updateMany.mock.lastCall as
    | [{ data: { roles?: string[] } }]
    | undefined
  return call?.[0]?.data?.roles ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  logCalls.length = 0
  prismaMock.membership.count.mockResolvedValue(2)
  // Two admins by default, so a demotion is allowed unless a row says otherwise.
  prismaMock.$queryRaw.mockResolvedValue([{ count: 2n }])
  prismaMock.membership.findMany.mockResolvedValue([])
  prismaMock.membership.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.membership.upsert.mockResolvedValue({})
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.user.update.mockResolvedValue(userRow())
  prismaMock.invitation.findFirst.mockResolvedValue(null)
  prismaMock.invitation.findMany.mockResolvedValue([])
  prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 })
  revokeTokensMock.mockResolvedValue(undefined)
  // The routes' transaction bodies are plain code, so running the callback
  // against the same mocks is what actually exercises them.
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock))
  authAs()
})

// --- The matrix ---------------------------------------------------------------

interface Guardrail {
  /** The G-number from MAI-8, so a failure names the rule it broke. */
  id: string
  rule: string
  check: () => Promise<void>
}

function runMatrix(title: string, rows: Guardrail[]): void {
  describe(title, () => {
    for (const row of rows) {
      it(`${row.id} — ${row.rule}`, row.check)
    }
  })
}

// ============================================================
// Never zero admins
// ============================================================
runMatrix('never zero admins', [
  {
    id: 'G1',
    rule: 'demoting the last admin is refused, in the org-keeps-an-admin words',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['admin'] }))
      prismaMock.$queryRaw.mockResolvedValue([{ count: 1n }])

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic'] })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe(LAST_ADMIN_ERROR)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G2',
    rule: 'removing the last admin is refused, with the SAME message as G1',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['admin'] }))
      prismaMock.$queryRaw.mockResolvedValue([{ count: 1n }])

      const res = await request(app)
        .delete(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(409)
      expect(res.body.error).toBe(LAST_ADMIN_ERROR)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
      // The removal never happened, so the sessions must not be cut either.
      expect(revokeTokensMock).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G3',
    rule: 'the count and the write share one transaction, taking a row LOCK (real concurrency: integration)',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['admin'] }))

      await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic'] })

      // A plain count lets both racers read "2 admins" and both commit. The guard
      // must run INSIDE the transaction the route opened, and must lock.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
      const guardOrder = prismaMock.$queryRaw.mock.invocationCallOrder[0]!
      const txOrder = prismaMock.$transaction.mock.invocationCallOrder[0]!
      expect(guardOrder).toBeGreaterThan(txOrder)
      expect((prismaMock.$queryRaw.mock.calls[0]![0] as string[]).join('?')).toContain('FOR UPDATE')
    },
  },
  {
    id: 'G4',
    rule: 'an INACTIVE admin membership is not counted (the lock filters isActive; proved for real in integration)',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['admin'] }))

      await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic'] })

      const sql = (prismaMock.$queryRaw.mock.calls[0]![0] as string[]).join('?')
      expect(sql).toContain('"isActive" = true')
    },
  },
  {
    id: 'G5',
    rule: 'the admin-authority count includes the OWNER, so an admin may be demoted when only the owner remains',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['admin'] }))
      // The owner plus this admin: two rows carry admin authority.
      prismaMock.$queryRaw.mockResolvedValue([{ count: 2n }])

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic'] })

      expect(res.status).toBe(200)
      expect(prismaMock.membership.updateMany).toHaveBeenCalled()
      // What makes the owner count: the locked query asks for BOTH roles.
      expect(prismaMock.$queryRaw.mock.calls[0]![2]).toEqual(['owner', 'admin'])
    },
  },
])

// ============================================================
// Owner is structural
// ============================================================
runMatrix('owner is structural', [
  {
    id: 'G6',
    rule: "the owner's roles cannot be edited from the member list",
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['owner'] }))

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic'] })

      expect(res.status).toBe(403)
      expect(res.body.error).toBe(OWNER_ROLE_ERROR)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G7',
    rule: 'the owner cannot be removed',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['owner'] }))

      const res = await request(app)
        .delete(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe(OWNER_REMOVE_ERROR)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
      expect(revokeTokensMock).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G8',
    rule: 'an invitation may not be created carrying "owner" — refused at the Zod boundary',
    async check() {
      for (const roles of [['owner'], ['owner', 'admin'], ['superadmin']]) {
        authAs()

        const res = await request(app)
          .post(`/api/team/orgs/${ORG_A}/invitations`)
          .set('Authorization', AUTH)
          .send({ email: 'new@orga.com', roles })

        expect(res.status).toBe(400)
        expect(prismaMock.invitation.create).not.toHaveBeenCalled()
      }
    },
  },
  {
    id: 'G9',
    rule: 'a stored invitation whose roles contain "owner" is re-validated at accept and refused',
    async check() {
      prismaMock.invitation.findUnique.mockResolvedValue(invitationRow({ roles: ['owner'] }))

      const res = await request(app)
        .post('/api/invitations/tok-live/accept')
        .set('Authorization', AUTH)

      // 404, not 403: the row is unusable, and every unusable invite answers the
      // same way.
      expect(res.status).toBe(404)
      expect(res.body).toEqual(UNAVAILABLE)
      expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
    },
  },
])

// ============================================================
// A role set is never empty
// ============================================================
runMatrix('a role set is never empty', [
  {
    id: 'G10',
    rule: 'an empty role set is refused, not defaulted — it is a removal in a role change costume',
    async check() {
      authAs(callerMembership(), targetMembership())

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: [] })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Pick at least one role.')
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G11',
    rule: 'a repeated role is DEDUPED (MAI-6 normalises rather than refusing) and never stored twice',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['basic'] }))

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['admin', 'admin'] })

      expect(res.status).toBe(200)
      const stored = lastRoleWrite()
      expect(stored).toEqual(['admin'])
      expect(new Set(stored).size).toBe(stored.length)
      expect(res.body.member.roles).toEqual(['admin'])
    },
  },
  {
    id: 'G12',
    rule: 'the two orders of the same set store identically, and the second time is a no-op',
    async check() {
      authAs(callerMembership(), targetMembership({ roles: ['basic'] }))
      await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic', 'admin'] })
      const first = lastRoleWrite()

      authAs(callerMembership(), targetMembership({ roles: ['basic'] }))
      await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['admin', 'basic'] })
      const second = lastRoleWrite()

      expect(first).toEqual(['admin', 'basic'])
      expect(second).toEqual(first)

      // And once the row already holds that set, the same request writes nothing.
      prismaMock.membership.updateMany.mockClear()
      authAs(callerMembership(), targetMembership({ roles: ['admin', 'basic'] }))
      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic', 'admin'] })

      expect(res.status).toBe(200)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    },
  },
])

// ============================================================
// Self-protection
// ============================================================
runMatrix('self-protection', [
  {
    id: 'G13',
    rule: 'the last admin cannot remove THEMSELVES either — the guardrail is not about who is asking',
    async check() {
      authAs(
        callerMembership(),
        targetMembership({ id: 'mem-a', userId: 'user-a', roles: ['admin'], user: { firebaseUid: 'uid-a' } }),
      )
      prismaMock.$queryRaw.mockResolvedValue([{ count: 1n }])

      const res = await request(app)
        .delete(`/api/orgs/${ORG_A}/members/user-a`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(409)
      expect(res.body.error).toBe(LAST_ADMIN_ERROR)
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G14',
    rule: 'an admin MAY demote themselves while another admin exists — there is no blanket self-ban',
    async check() {
      authAs(
        callerMembership(),
        targetMembership({ id: 'mem-a', userId: 'user-a', roles: ['admin'], user: { firebaseUid: 'uid-a' } }),
      )
      prismaMock.$queryRaw.mockResolvedValue([{ count: 2n }])

      const res = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-a`)
        .set('Authorization', AUTH)
        .send({ roles: ['basic'] })

      expect(res.status).toBe(200)
      expect(prismaMock.membership.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-a', orgId: ORG_A, isActive: true },
        data: { roles: ['basic'] },
      })
    },
  },
])

// ============================================================
// Tenant isolation
// ============================================================
runMatrix('tenant isolation', [
  {
    id: 'G15',
    rule: 'a member of Org A gets 404 — never 403 — from every Org B route',
    async check() {
      const calls: (() => request.Test)[] = [
        () => request(app).get(`/api/orgs/${ORG_B}/members`).set('Authorization', AUTH),
        () =>
          request(app)
            .patch(`/api/orgs/${ORG_B}/members/user-b`)
            .set('Authorization', AUTH)
            .send({ roles: ['admin'] }),
        () => request(app).delete(`/api/orgs/${ORG_B}/members/user-b`).set('Authorization', AUTH),
        () => request(app).get(`/api/team/orgs/${ORG_B}`).set('Authorization', AUTH),
        () => request(app).get(`/api/team/orgs/${ORG_B}/invitations`).set('Authorization', AUTH),
        () =>
          request(app)
            .post(`/api/team/orgs/${ORG_B}/invitations`)
            .set('Authorization', AUTH)
            .send({ email: 'new@orgb.com', roles: ['basic'] }),
      ]

      for (const call of calls) {
        authAs(null)
        const res = await call()
        // 403 would confirm the org is real. An org id stays unguessable.
        expect(res.status).toBe(404)
        expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()
        expect(prismaMock.invitation.create).not.toHaveBeenCalled()
      }
    },
  },
  {
    id: 'G16',
    rule: 'an INACTIVE member of Org A gets 404 from an Org A route — every membership read filters isActive',
    async check() {
      // requireMembership finds nothing, because its filter includes isActive.
      authAs(null)

      const res = await request(app).get(`/api/orgs/${ORG_A}/members`).set('Authorization', AUTH)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Organization not found')
      expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-a', orgId: ORG_A, isActive: true } }),
      )
    },
  },
  {
    id: 'G17',
    rule: 'patching a user who belongs to a DIFFERENT org 404s — at the lookup, and again on count === 0',
    async check() {
      // The target lookup is itself scoped by orgId, so the other org's member is
      // simply not there.
      authAs(callerMembership(), null)
      const missing = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-in-org-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['admin'] })

      expect(missing.status).toBe(404)
      expect(missing.body.error).toBe('Member not found')
      expect(prismaMock.membership.updateMany).not.toHaveBeenCalled()

      // And if the row disappears between the lookup and the write, the scoped
      // updateMany writes nothing and `count === 0` still answers 404.
      authAs(callerMembership(), targetMembership())
      prismaMock.membership.updateMany.mockResolvedValue({ count: 0 })
      const raced = await request(app)
        .patch(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)
        .send({ roles: ['admin'] })

      expect(raced.status).toBe(404)
      expect(raced.body.error).toBe('Member not found')
      expect(prismaMock.membership.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-b', orgId: ORG_A, isActive: true },
        data: { roles: ['admin'] },
      })
    },
  },
  {
    id: 'G18',
    rule: 'removing someone from Org A touches only Org A (their account and other orgs are untouched)',
    async check() {
      authAs(callerMembership(), targetMembership())

      const res = await request(app)
        .delete(`/api/orgs/${ORG_A}/members/user-b`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(200)
      // Scoped by orgId, so no other org's seat is in the write's reach.
      expect(prismaMock.membership.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-b', orgId: ORG_A, isActive: true },
        data: { isActive: false },
      })
      // The User row is never disabled or deleted: Org B must keep working.
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G19',
    rule: 'a non-admin member cannot read the invitation list — it carries live tokens',
    async check() {
      authAs(callerMembership({ roles: ['basic'] }))

      const res = await request(app)
        .get(`/api/team/orgs/${ORG_A}/invitations`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(403)
      expect(prismaMock.invitation.findMany).not.toHaveBeenCalled()
    },
  },
])

// ============================================================
// Session and state hygiene
// ============================================================
runMatrix('session and state hygiene', [
  {
    id: 'G20',
    rule: "a removed member's sessions are revoked, and their next request fails",
    async check() {
      authAs(callerMembership(), targetMembership())
      await request(app).delete(`/api/orgs/${ORG_A}/members/user-b`).set('Authorization', AUTH)

      expect(revokeTokensMock).toHaveBeenCalledWith('uid-b')

      // Their next request: the org gate reads isActive, so the seat is gone.
      authAs(null)
      const next = await request(app).get(`/api/orgs/${ORG_A}/members`).set('Authorization', AUTH)
      expect(next.status).toBe(404)
    },
  },
  {
    id: 'G21',
    rule: 'the current-org pointer is cleared when it pointed at THIS org, and only then',
    async check() {
      authAs(callerMembership(), targetMembership())

      await request(app).delete(`/api/orgs/${ORG_A}/members/user-b`).set('Authorization', AUTH)

      // The repo's column is User.currentOrgId. Scoped to this org, so someone
      // working elsewhere keeps their place.
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-b', currentOrgId: ORG_A },
        data: { currentOrgId: null },
      })
    },
  },
  {
    id: 'G22',
    rule: 're-accepting REACTIVATES the existing seat rather than creating a second one',
    async check() {
      prismaMock.invitation.findUnique.mockResolvedValue(invitationRow())

      const res = await request(app)
        .post('/api/invitations/tok-live/accept')
        .set('Authorization', AUTH)

      expect(res.status).toBe(200)
      // upsert on the compound unique, never create: @@unique([userId, orgId])
      // would reject a second row for a former member.
      expect(prismaMock.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_orgId: { userId: 'user-a', orgId: ORG_A } },
          update: { roles: ['basic'], isActive: true },
        }),
      )
      expect(prismaMock.membership.create).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G23',
    rule: 'a double-clicked Join makes one membership and claims the invitation once',
    async check() {
      prismaMock.invitation.findUnique.mockResolvedValue(invitationRow())
      // The `status: PENDING` guard on the claim is what makes this safe: the
      // second call updates zero rows and never reaches the membership write.
      prismaMock.invitation.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })

      const [first, second] = await Promise.all([
        request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH),
        request(app).post('/api/invitations/tok-live/accept').set('Authorization', AUTH),
      ])

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(prismaMock.membership.upsert).toHaveBeenCalledTimes(1)
      const claims = prismaMock.invitation.updateMany.mock.calls.filter(
        (call) => (call[0] as { data: { status?: string } }).data.status === 'ACCEPTED',
      )
      expect(claims).toHaveLength(2)
      for (const call of claims) {
        expect((call[0] as { where: Record<string, unknown> }).where).toMatchObject({
          status: 'PENDING',
        })
      }
    },
  },
])

// ============================================================
// Invitation hygiene
// ============================================================
runMatrix('invitation hygiene', [
  {
    id: 'G24',
    rule: 'invalid, expired, revoked and used tokens give four BYTE-IDENTICAL 404s',
    async check() {
      const rows = [
        null,
        invitationRow({ status: 'PENDING', expiresAt: PAST }),
        invitationRow({ status: 'REVOKED' }),
        invitationRow({ status: 'ACCEPTED' }),
      ]

      const seen: { status: number; text: string; type: string }[] = []
      for (const row of rows) {
        prismaMock.invitation.findUnique.mockResolvedValue(row)
        const res = await request(app).get('/api/public/invitations/tok-x')
        seen.push({ status: res.status, text: res.text, type: res.type })
      }

      // Four distinguishable answers would be a probing oracle.
      expect(seen.map((s) => s.status)).toEqual([404, 404, 404, 404])
      for (const answer of seen) expect(answer).toEqual(seen[0])
      expect(JSON.parse(seen[0]!.text)).toEqual(UNAVAILABLE)
    },
  },
  {
    id: 'G25',
    rule: 'accepting while signed in as someone else is refused, naming BOTH addresses',
    async check() {
      prismaMock.invitation.findUnique.mockResolvedValue(
        invitationRow({ email: 'someone.else@orga.com' }),
      )

      const res = await request(app)
        .post('/api/invitations/tok-live/accept')
        .set('Authorization', AUTH)

      expect(res.status).toBe(409)
      expect(res.body.status).toBe('email_mismatch')
      expect(res.body.invitedEmail).toBe('someone.else@orga.com')
      expect(res.body.signedInEmail).toBe('a@orga.com')
      expect(res.body.error).toContain('someone.else@orga.com')
      expect(prismaMock.membership.upsert).not.toHaveBeenCalled()
    },
  },
  {
    id: 'G26',
    rule: 'regenerating mints a new link and the OLD one is dead on the very next request',
    async check() {
      prismaMock.invitation.findUniqueOrThrow.mockResolvedValue(
        invitationRow({ token: 'tok-new' }),
      )

      const res = await request(app)
        .post(`/api/team/orgs/${ORG_A}/invitations/inv-1/regenerate`)
        .set('Authorization', AUTH)

      expect(res.status).toBe(200)
      expect(res.body.invitation.inviteUrl).toContain('tok-new')
      expect(res.body.invitation.inviteUrl).not.toContain('tok-live')
      // The token is replaced in place, scoped by orgId and still PENDING.
      const write = prismaMock.invitation.updateMany.mock.lastCall![0] as {
        where: Record<string, unknown>
        data: { token: string }
      }
      expect(write.where).toMatchObject({ id: 'inv-1', orgId: ORG_A, status: 'PENDING' })
      expect(write.data.token).not.toBe('tok-live')

      // The old link now resolves to nothing.
      prismaMock.invitation.findUnique.mockResolvedValue(null)
      const old = await request(app).get('/api/public/invitations/tok-live')
      expect(old.status).toBe(404)
      expect(old.body).toEqual(UNAVAILABLE)
    },
  },
  {
    id: 'G27',
    rule: 'no invite token reaches any log line — not in a field, a message, or a logged URL',
    async check() {
      const SECRET = 'tok-super-secret-value'
      prismaMock.invitation.findUnique.mockResolvedValue(invitationRow({ token: SECRET }))
      prismaMock.invitation.findUniqueOrThrow.mockResolvedValue(invitationRow({ token: SECRET }))
      prismaMock.invitation.create.mockResolvedValue(invitationRow({ token: SECRET }))

      // Every route that has ever held a token in its hand.
      await request(app).get(`/api/public/invitations/${SECRET}`)
      await request(app).post(`/api/invitations/${SECRET}/accept`).set('Authorization', AUTH)
      authAs()
      await request(app)
        .post(`/api/team/orgs/${ORG_A}/invitations`)
        .set('Authorization', AUTH)
        .send({ email: 'new@orga.com', roles: ['basic'] })
      authAs()
      await request(app)
        .post(`/api/team/orgs/${ORG_A}/invitations/inv-1/regenerate`)
        .set('Authorization', AUTH)

      expect(logCalls.length).toBeGreaterThan(0)
      const written = logCalls.map((args) =>
        args
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' '),
      )
      for (const line of written) {
        expect(line).not.toContain(SECRET)
        // The invite URL carries the token, so it must not be logged either.
        expect(line).not.toContain('/join/')
      }
    },
  },
])

// ============================================================
// Structural: every org-scoped write is a scoped updateMany / deleteMany
// ============================================================
// A cheap grep, so the rule is enforced rather than remembered. The matching
// review checklist item lives in .claude/rules/server-routes.md.
//
// `update(...)`/`delete(...)` by id alone cannot carry the tenant boundary in its
// where clause. `updateMany`/`deleteMany` can, and their `count` is what turns a
// miss into a 404 instead of a silent success.
describe('structural', () => {
  // `task` and `note` join the list with MAI-141 (T13): they are the first CRM
  // work objects with a full CRUD router, so they are the first that a careless
  // `prisma.task.update({ where: { id } })` could write across a tenant boundary.
  const ORG_SCOPED_MODELS = [
    'membership', 'invitation', 'phoneNumber', 'call', 'emailDraft', 'emailTemplate',
    'task', 'note',
  ]
  const routesDir = path.resolve(import.meta.dirname, '..')

  it('G-STRUCT — no route writes an org-scoped model with update() or delete() by id', () => {
    const offenders: string[] = []
    const pattern = new RegExp(
      `\\b(?:prisma|tx)\\.(${ORG_SCOPED_MODELS.join('|')})\\.(update|delete)\\(`,
      'g',
    )

    for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(path.join(routesDir, file), 'utf8')
      source.split('\n').forEach((line, index) => {
        pattern.lastIndex = 0
        const match = pattern.exec(line)
        if (match) offenders.push(`${file}:${index + 1} → ${match[0]}`)
      })
    }

    expect(offenders).toEqual([])
  })
})
