// MAI-8 — the half of the guardrail matrix that only a REAL Postgres can prove.
//
// The mocked suite (guardrails.test.ts) can prove the routes ASK for a lock, a
// scoped write and a unique key. It cannot prove Postgres HONOURS them: a mocked
// `$queryRaw` returns whatever the test says, and a mocked upsert never meets
// @@unique([userId, orgId]).
//
// So this file runs the REAL route code — the actual Express app, over supertest —
// against the per-run schema globalSetup created, by pointing the app's own Prisma
// singleton at it. Delete the FOR UPDATE lock from members.ts and G3 fails here.
// Run with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock, revokeTokensMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  revokeTokensMock: vi.fn(),
}))

// Firebase is the one thing that stays mocked: a test must never reach it, and
// the bearer token IS the firebaseUid here, so any seeded user can sign in.
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
  revokeFirebaseRefreshTokens: revokeTokensMock,
}))

/**
 * The app's Prisma singleton, aimed at THIS run's schema.
 *
 * Replacing db.js rather than passing a client in is what lets the routes run
 * unmodified — the thing under test is the route, not a copy of its body.
 *
 * Two schema settings, not one. The adapter's `schema` option only qualifies
 * PRISMA-generated SQL; the last-admin guard is RAW SQL with an unqualified
 * table name, so the session's `search_path` has to point at the schema as well.
 * Production runs on the default schema and needs neither.
 */
vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')

  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  url.searchParams.set('options', `-c search_path=${schema},public`)

  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema })
  return { default: new PrismaClient({ adapter }) }
})

import app from '../../app.js'
// The mocked module: the very client the routes write through.
import prisma from '../../db.js'
import { seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { ADMIN_ROLES } from '../../lib/roles.js'

const LAST_ADMIN_ERROR =
  'Promote someone else to admin first. An org always keeps at least one admin.'

/** The bearer token IS the firebaseUid, so any seeded user can call a route. */
function as(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

function activeAdmins(orgId: string): Promise<number> {
  return prisma.membership.count({
    where: { orgId, isActive: true, roles: { hasSome: [...ADMIN_ROLES] } },
  })
}

/** Adds a member and returns their firebaseUid alongside the ids. */
async function seedMemberWithUid(orgId: string, roles?: string[]) {
  const member = await seedMember(prisma, orgId, roles ? { roles } : {})
  return member
}

beforeAll(() => {
  verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  revokeTokensMock.mockResolvedValue(undefined)
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface Guardrail {
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

runMatrix('membership guardrails (integration, real Postgres, real routes)', [
  {
    id: 'G3',
    rule: 'two CONCURRENT demotions of the last two admins: exactly one succeeds, and an admin remains',
    async check() {
      // Each admin demotes the other, at the same moment. There is no third
      // caller available: a refusal only happens when the org is down to two
      // admin-authority holders, and every caller must hold admin authority, so
      // the two racers ARE the two admins.
      //
      // That leaves one uninteresting outcome: if the first request commits
      // before the second one's admin gate reads, the second is simply no longer
      // an admin and gets 403 — the requests never overlapped, so nothing about
      // the lock was tested. That attempt is retried rather than accepted, so a
      // pass here always means two requests really were inside the guard together.
      let raced: { ok: number; refused: number; adminsLeft: number } | null = null

      for (let attempt = 0; attempt < 5 && !raced; attempt += 1) {
        const org = await seedOrgWithAdmin(prisma)
        const first = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
        const second = await seedMemberWithUid(org.orgId, ['admin'])

        // A warm connection for each caller, so the race is between the two
        // transactions rather than between two cold pool checkouts.
        await request(app)
          .get(`/api/orgs/${org.orgId}/members`)
          .set('Authorization', as(first.firebaseUid))
        await request(app)
          .get(`/api/orgs/${org.orgId}/members`)
          .set('Authorization', as(second.firebaseUid))

        const [a, b] = await Promise.all([
          request(app)
            .patch(`/api/orgs/${org.orgId}/members/${second.userId}`)
            .set('Authorization', as(first.firebaseUid))
            .send({ roles: ['basic'] }),
          request(app)
            .patch(`/api/orgs/${org.orgId}/members/${org.adminUserId}`)
            .set('Authorization', as(second.firebaseUid))
            .send({ roles: ['basic'] }),
        ])

        const adminsLeft = await activeAdmins(org.orgId)
        // Whatever the interleaving, the org never ends up with nobody in charge.
        expect(adminsLeft).toBe(1)

        const ok = [a, b].filter((r) => r.status === 200).length
        const refusal = [a, b].find((r) => r.status === 409)
        if (refusal) {
          expect(refusal.body.error).toBe(LAST_ADMIN_ERROR)
          raced = { ok, refused: refusal.status, adminsLeft }
        }
      }

      // Without the FOR UPDATE lock both requests read "2 admins" and both
      // commit, which is two 200s and an org with no admin.
      expect(raced, 'the two requests never overlapped in 5 attempts').not.toBeNull()
      expect(raced!.ok).toBe(1)
      expect(raced!.adminsLeft).toBe(1)
    },
  },
  {
    id: 'G4',
    rule: 'an INACTIVE admin membership does not count towards the admin total',
    async check() {
      const org = await seedOrgWithAdmin(prisma)
      const ghost = await seedMemberWithUid(org.orgId, ['admin'])
      await prisma.membership.updateMany({
        where: { userId: ghost.userId, orgId: org.orgId },
        data: { isActive: false },
      })
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })

      // Two rows carry "admin"; only one of them is a live seat.
      const res = await request(app)
        .patch(`/api/orgs/${org.orgId}/members/${org.adminUserId}`)
        .set('Authorization', as(admin.firebaseUid))
        .send({ roles: ['basic'] })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe(LAST_ADMIN_ERROR)
      const still = await prisma.membership.findFirstOrThrow({
        where: { userId: org.adminUserId, orgId: org.orgId },
      })
      expect(still.roles).toContain('admin')
    },
  },
  {
    id: 'G5',
    rule: 'the OWNER counts as admin authority, so the last plain admin may be demoted',
    async check() {
      const org = await seedOrgWithAdmin(prisma)
      // Turn the seeded admin into the owner, and add one plain admin.
      await prisma.membership.updateMany({
        where: { userId: org.adminUserId, orgId: org.orgId },
        data: { roles: ['owner'] },
      })
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
      const admin = await seedMemberWithUid(org.orgId, ['admin'])

      const res = await request(app)
        .patch(`/api/orgs/${org.orgId}/members/${admin.userId}`)
        .set('Authorization', as(owner.firebaseUid))
        .send({ roles: ['basic'] })

      // Allowed: the owner administers the org without carrying "admin".
      expect(res.status).toBe(200)
      expect(res.body.member.roles).toEqual(['basic'])
      expect(await activeAdmins(org.orgId)).toBe(1)
    },
  },
  {
    id: 'G9',
    rule: 'an invitation row hand-edited to grant "owner" is refused at accept, as unavailable',
    async check() {
      const org = await seedOrgWithAdmin(prisma)
      const invitee = await seedMemberWithUid(org.orgId)
      // A second org, so the invite is into somewhere they are not already.
      const target = await seedOrgWithAdmin(prisma)

      // Written straight to the database, exactly as a hand-edit would be: the
      // create route would have refused this role set.
      const invitation = await prisma.invitation.create({
        data: {
          token: `owner-grant-${Date.now()}`,
          email: invitee.email,
          orgId: target.orgId,
          roles: ['owner'],
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedByUserId: target.adminUserId,
        },
      })

      const res = await request(app)
        .post(`/api/invitations/${invitation.token}/accept`)
        .set('Authorization', as(invitee.firebaseUid))

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Invitation unavailable' })
      const seats = await prisma.membership.count({
        where: { userId: invitee.userId, orgId: target.orgId },
      })
      expect(seats).toBe(0)
    },
  },
  {
    id: 'G16',
    rule: 'a deactivated member of an org gets 404 from that org on their very next request',
    async check() {
      const org = await seedOrgWithAdmin(prisma)
      const member = await seedMemberWithUid(org.orgId)

      const before = await request(app)
        .get(`/api/orgs/${org.orgId}/members`)
        .set('Authorization', as(member.firebaseUid))
      expect(before.status).toBe(200)

      await prisma.membership.updateMany({
        where: { userId: member.userId, orgId: org.orgId },
        data: { isActive: false },
      })

      const after = await request(app)
        .get(`/api/orgs/${org.orgId}/members`)
        .set('Authorization', as(member.firebaseUid))
      expect(after.status).toBe(404)
      expect(after.body.error).toBe('Organization not found')
    },
  },
  {
    id: 'G18',
    rule: 'removal from Org A leaves the same person working in Org B',
    async check() {
      const orgA = await seedOrgWithAdmin(prisma)
      const orgB = await seedOrgWithAdmin(prisma)
      const person = await seedMemberWithUid(orgA.orgId)
      await prisma.membership.create({
        data: { userId: person.userId, orgId: orgB.orgId, roles: ['basic'] },
      })
      const adminA = await prisma.user.findUniqueOrThrow({ where: { id: orgA.adminUserId } })

      const removed = await request(app)
        .delete(`/api/orgs/${orgA.orgId}/members/${person.userId}`)
        .set('Authorization', as(adminA.firebaseUid))
      expect(removed.status).toBe(200)

      const inA = await request(app)
        .get(`/api/orgs/${orgA.orgId}/members`)
        .set('Authorization', as(person.firebaseUid))
      const inB = await request(app)
        .get(`/api/orgs/${orgB.orgId}/members`)
        .set('Authorization', as(person.firebaseUid))

      expect(inA.status).toBe(404)
      expect(inB.status).toBe(200)
      // The account itself was never disabled, and the pointer no longer aims at
      // an org they cannot open.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: person.userId } })
      expect(user.enabled).toBe(true)
      expect(user.currentOrgId).toBeNull()
    },
  },
  {
    id: 'G22',
    rule: 're-inviting and re-accepting a removed member reactivates ONE row, never a second seat',
    async check() {
      const org = await seedOrgWithAdmin(prisma)
      const person = await seedMemberWithUid(org.orgId)
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })

      await request(app)
        .delete(`/api/orgs/${org.orgId}/members/${person.userId}`)
        .set('Authorization', as(admin.firebaseUid))
        .expect(200)

      const invited = await request(app)
        .post(`/api/team/orgs/${org.orgId}/invitations`)
        .set('Authorization', as(admin.firebaseUid))
        .send({ email: person.email, roles: ['admin'] })
      expect(invited.status).toBe(201)

      const token = decodeURIComponent(
        String(invited.body.invitation.inviteUrl).split('/join/')[1] ?? '',
      )
      const accepted = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set('Authorization', as(person.firebaseUid))

      expect(accepted.status).toBe(200)
      // @@unique([userId, orgId]) is never violated, because the row is reused.
      const seats = await prisma.membership.count({
        where: { userId: person.userId, orgId: org.orgId },
      })
      expect(seats).toBe(1)
      const seat = await prisma.membership.findFirstOrThrow({
        where: { userId: person.userId, orgId: org.orgId },
      })
      expect(seat.isActive).toBe(true)
      expect(seat.roles).toEqual(['admin'])
    },
  },
  {
    id: 'G23',
    rule: 'a double-clicked Join makes exactly one membership and one ACCEPTED invitation',
    async check() {
      const org = await seedOrgWithAdmin(prisma)
      const outsiderOrg = await seedOrgWithAdmin(prisma)
      const person = await seedMemberWithUid(outsiderOrg.orgId)
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })

      const invited = await request(app)
        .post(`/api/team/orgs/${org.orgId}/invitations`)
        .set('Authorization', as(admin.firebaseUid))
        .send({ email: person.email, roles: ['basic'] })
      expect(invited.status).toBe(201)
      const token = decodeURIComponent(
        String(invited.body.invitation.inviteUrl).split('/join/')[1] ?? '',
      )

      // Both clicks in flight at once.
      const [first, second] = await Promise.all([
        request(app)
          .post(`/api/invitations/${token}/accept`)
          .set('Authorization', as(person.firebaseUid)),
        request(app)
          .post(`/api/invitations/${token}/accept`)
          .set('Authorization', as(person.firebaseUid)),
      ])

      expect([first.status, second.status]).toEqual([200, 200])
      const seats = await prisma.membership.count({
        where: { userId: person.userId, orgId: org.orgId },
      })
      expect(seats).toBe(1)
      const accepted = await prisma.invitation.count({
        where: { orgId: org.orgId, email: person.email, status: 'ACCEPTED' },
      })
      expect(accepted).toBe(1)
    },
  },
])
