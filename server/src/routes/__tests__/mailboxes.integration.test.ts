// Integration tests for the mailbox routes against a REAL Postgres schema, driving the
// ACTUAL Express app over supertest (see vitest.integration.config.ts and
// src/test/integration/*).
//
// The unit suite (mailboxes.test.ts) stubs setPrimaryMailbox/deleteMailbox, so it only
// proves the route's control flow. This proves the property those stubs stand in for,
// end to end through the HTTP route: two CONCURRENT promotes of two mailboxes leave
// exactly one primary — never two, never zero — because the clear-and-set is one
// transaction serialized on a row lock. It also proves the list route returns the real
// public shape and that another org's id is 404 over the wire.
//
// The app's own Prisma singleton is pointed at this run's schema, so the routes run
// unmodified — the thing under test is the route, not a copy of its body. Run with
// `npm run test:integration`, Docker up.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

// Firebase stays mocked: a test must never reach it, and the bearer token IS the
// firebaseUid, so any seeded user can sign in.
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

// The app's Prisma singleton, aimed at THIS run's schema — the same mechanism the
// guardrail integration suite uses so the real routes write through it.
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
import prisma from '../../db.js'
import { upsertMailAccount } from '../../lib/mail/mailAccounts.js'
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const as = (firebaseUid: string): string => `Bearer ${firebaseUid}`

/** Seed an OAuthConnection + its mailbox (via the real upsert) for a rep. */
async function connectMailbox(
  org: { orgId: string; adminUserId: string },
  opts: { provider: string; providerAccountId: string; emailAddress: string },
): Promise<string> {
  const conn = await prisma.oAuthConnection.create({
    data: {
      orgId: org.orgId,
      userId: org.adminUserId,
      provider: opts.provider,
      providerAccountId: opts.providerAccountId,
      emailAddress: opts.emailAddress,
      refreshToken: 'v1.a.b.c',
    },
  })
  const box = await upsertMailAccount({
    orgId: org.orgId,
    userId: org.adminUserId,
    connectionId: conn.id,
    provider: opts.provider,
    emailAddress: opts.emailAddress,
  })
  return box.id
}

const primaryCount = (orgId: string, userId: string) =>
  prisma.mailAccount.count({ where: { orgId, userId, isPrimary: true } })

describe('mailbox routes (integration, real Postgres, real routes)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('GET lists the rep’s mailboxes in the token-free public shape, primary and all', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
    await connectMailbox(org, { provider: 'google', providerAccountId: 'sub_list', emailAddress: 'list@example.com' })

    const res = await request(app).get(`/api/mailboxes/orgs/${org.orgId}`).set('Authorization', as(admin.firebaseUid))

    expect(res.status).toBe(200)
    expect(res.body.mailboxes).toHaveLength(1)
    const box = res.body.mailboxes[0]
    expect(box.emailAddress).toBe('list@example.com')
    expect(box.isPrimary).toBe(true) // first-connect primary
    expect(box.providerLabel).toBe('Google')
    expect(box).not.toHaveProperty('refreshToken')
    expect(JSON.stringify(res.body)).not.toContain('v1.a.b.c')
  })

  it('POST …/primary moves the flag and returns the WHOLE list with exactly one primary', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
    await connectMailbox(org, { provider: 'google', providerAccountId: 'sub_p1', emailAddress: 'p1@example.com' })
    const secondId = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_p2',
      emailAddress: 'p2@example.com',
    })

    const res = await request(app)
      .post(`/api/mailboxes/orgs/${org.orgId}/${secondId}/primary`)
      .set('Authorization', as(admin.firebaseUid))

    expect(res.status).toBe(200)
    expect(res.body.mailboxes).toHaveLength(2)
    const primaries = res.body.mailboxes.filter((b: { isPrimary: boolean }) => b.isPrimary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].id).toBe(secondId)
    expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
  })

  it('two CONCURRENT promotes over the route still leave exactly one primary', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
    const boxA = await connectMailbox(org, { provider: 'google', providerAccountId: 'sub_ra', emailAddress: 'ra@example.com' })
    const boxB = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_rb',
      emailAddress: 'rb@example.com',
    })
    const url = (id: string) => `/api/mailboxes/orgs/${org.orgId}/${id}/primary`

    for (let i = 0; i < 8; i += 1) {
      const [resA, resB] = await Promise.all([
        request(app).post(url(boxA)).set('Authorization', as(admin.firebaseUid)),
        request(app).post(url(boxB)).set('Authorization', as(admin.firebaseUid)),
      ])

      expect(resA.status).toBe(200)
      expect(resB.status).toBe(200)
      // Each committed response reflects a state with exactly one primary — never two,
      // never zero — and the database agrees.
      for (const res of [resA, resB]) {
        expect(res.body.mailboxes.filter((b: { isPrimary: boolean }) => b.isPrimary)).toHaveLength(1)
      }
      expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
    }
  })

  it('DELETE removes the mailbox and promotes the newest remaining, over the route', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: org.adminUserId } })
    const firstId = await connectMailbox(org, {
      provider: 'google',
      providerAccountId: 'sub_d1',
      emailAddress: 'd1@example.com',
    })
    const firstConnectionId = (
      await prisma.mailAccount.findUniqueOrThrow({ where: { id: firstId } })
    ).connectionId
    const secondId = await connectMailbox(org, {
      provider: 'microsoft',
      providerAccountId: 'oid_d2',
      emailAddress: 'd2@example.com',
    })

    // first is primary; deleting it must promote the newest remaining (second).
    const res = await request(app)
      .delete(`/api/mailboxes/orgs/${org.orgId}/${firstId}`)
      .set('Authorization', as(admin.firebaseUid))

    expect(res.status).toBe(200)
    expect(res.body.mailboxes).toHaveLength(1)
    expect(res.body.mailboxes[0].id).toBe(secondId)
    expect(res.body.mailboxes[0].isPrimary).toBe(true)
    expect(await primaryCount(org.orgId, org.adminUserId)).toBe(1)
    expect(
      await prisma.oAuthConnection.findUnique({ where: { id: firstConnectionId } }),
    ).toBeNull()
  })

  it('a mailbox id from another org is 404 over the route, and untouched', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    const adminB = await prisma.user.findUniqueOrThrow({ where: { id: orgB.adminUserId } })
    const boxAId = await connectMailbox(orgA, {
      provider: 'google',
      providerAccountId: 'sub_cross',
      emailAddress: 'cross@example.com',
    })

    // Org B's admin is a real member of org B, but names org A's mailbox id in the
    // path scoped to org B — it is simply not found there.
    const promote = await request(app)
      .post(`/api/mailboxes/orgs/${orgB.orgId}/${boxAId}/primary`)
      .set('Authorization', as(adminB.firebaseUid))
    expect(promote.status).toBe(404)

    const del = await request(app)
      .delete(`/api/mailboxes/orgs/${orgB.orgId}/${boxAId}`)
      .set('Authorization', as(adminB.firebaseUid))
    expect(del.status).toBe(404)

    // Org A's mailbox survives, still primary.
    expect((await prisma.mailAccount.findUniqueOrThrow({ where: { id: boxAId } })).isPrimary).toBe(true)
  })
})
