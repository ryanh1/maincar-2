import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

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
import { seedCall, seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

function as(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

async function createNotification(args: {
  orgId: string
  recipientUserId: string
  objectType?: string
  objectId?: string
  createdAt?: Date
  readAt?: Date | null
  archivedAt?: Date | null
  snoozedUntil?: Date | null
}): Promise<{ id: string }> {
  const object = await prisma.notificationObject.create({
    data: {
      orgId: args.orgId,
      eventKey: `notification-${Date.now()}-${Math.random()}`,
      verb: 'mentioned',
      objectType: args.objectType ?? 'call',
      objectId: args.objectId ?? 'missing-call',
      sourceSnapshot: { title: 'Comment on a call', preview: 'Please take a look.' },
    },
  })
  return prisma.notification.create({
    data: {
      orgId: args.orgId,
      notificationObjectId: object.id,
      recipientUserId: args.recipientUserId,
      readAt: args.readAt ?? null,
      archivedAt: args.archivedAt ?? null,
      snoozedUntil: args.snoozedUntil ?? null,
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    },
    select: { id: true },
  })
}

beforeAll(() => {
  verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('notification inbox API (integration, real Postgres)', () => {
  it('lists only the recipient’s active inbox rows with pagination and safe source state', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const visible = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      objectId: call.id,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
    })
    const older = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
    })
    await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
      archivedAt: new Date(),
    })
    await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      snoozedUntil: new Date('2099-01-01T00:00:00.000Z'),
    })

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications?page=1&limit=1`)
      .set('Authorization', as(recipient.firebaseUid))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 2, page: 1, limit: 1 })
    expect(res.body.notifications).toHaveLength(1)
    expect(res.body.notifications[0]).toMatchObject({
      id: visible.id,
      source: {
        status: 'available',
        type: 'call',
        route: `/orgs/${org.orgId}/calls/${call.id}`,
        title: 'Comment on a call',
        preview: 'Please take a look.',
      },
    })
    expect(res.body.notifications[0].source).not.toHaveProperty('call')

    const secondPage = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications?page=2&limit=1`)
      .set('Authorization', as(recipient.firebaseUid))
    expect(secondPage.status).toBe(200)
    expect(secondPage.body.notifications.map((row: { id: string }) => row.id)).toEqual([older.id])
  })

  it('filters archived and snoozed rows, and marks missing sources unavailable without leaking live data', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const archived = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      archivedAt: new Date(),
    })
    const snoozed = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      snoozedUntil: new Date('2099-01-01T00:00:00.000Z'),
    })

    const archivedRes = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications?view=archived`)
      .set('Authorization', as(recipient.firebaseUid))
    expect(archivedRes.status).toBe(200)
    expect(archivedRes.body.notifications.map((row: { id: string }) => row.id)).toEqual([archived.id])

    const snoozedRes = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications?view=snoozed`)
      .set('Authorization', as(recipient.firebaseUid))
    expect(snoozedRes.status).toBe(200)
    expect(snoozedRes.body.notifications).toHaveLength(1)
    expect(snoozedRes.body.notifications[0]).toMatchObject({
      id: snoozed.id,
      source: { status: 'unavailable', title: 'Comment on a call', preview: 'Please take a look.' },
    })
    expect(snoozedRes.body.notifications[0].source).not.toHaveProperty('route')
  })

  it('applies every individual lifecycle action to the recipient row only', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const notification = await createNotification({ orgId: org.orgId, recipientUserId: recipient.userId })
    const url = `/api/orgs/${org.orgId}/notifications/${notification.id}`

    async function apply(body: Record<string, string>): Promise<void> {
      const res = await request(app).patch(url).set('Authorization', as(recipient.firebaseUid)).send(body)
      expect(res.status).toBe(200)
    }
    async function row() {
      return prisma.notification.findFirstOrThrow({ where: { id: notification.id, orgId: org.orgId } })
    }

    await apply({ action: 'read' })
    expect((await row()).readAt).not.toBeNull()
    await apply({ action: 'unread' })
    expect((await row()).readAt).toBeNull()
    await apply({ action: 'archive' })
    expect((await row()).archivedAt).not.toBeNull()
    await apply({ action: 'unarchive' })
    expect((await row()).archivedAt).toBeNull()
    await apply({ action: 'snooze', snoozedUntil: '2099-01-01T00:00:00.000Z' })
    expect((await row()).snoozedUntil?.toISOString()).toBe('2099-01-01T00:00:00.000Z')
    await apply({ action: 'unsnooze' })
    expect((await row()).snoozedUntil).toBeNull()
  })

  it('makes bulk actions atomic and refuses notification ids outside the recipient and org scope', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const colleague = await seedMember(prisma, org.orgId)
    const first = await createNotification({ orgId: org.orgId, recipientUserId: recipient.userId })
    const second = await createNotification({ orgId: org.orgId, recipientUserId: recipient.userId })
    const someoneElses = await createNotification({ orgId: org.orgId, recipientUserId: colleague.userId })
    const url = `/api/orgs/${org.orgId}/notifications/bulk`

    const rejected = await request(app)
      .post(url)
      .set('Authorization', as(recipient.firebaseUid))
      .send({ action: 'archive', notificationIds: [first.id, someoneElses.id] })
    expect(rejected.status).toBe(404)
    expect(await prisma.notification.findFirstOrThrow({ where: { id: first.id, orgId: org.orgId } })).toMatchObject({ archivedAt: null })

    const applied = await request(app)
      .post(url)
      .set('Authorization', as(recipient.firebaseUid))
      .send({ action: 'archive', notificationIds: [first.id, second.id] })
    expect(applied.status).toBe(200)
    expect(applied.body).toEqual({ updated: 2 })
    expect(await prisma.notification.count({ where: { orgId: org.orgId, recipientUserId: recipient.userId, archivedAt: { not: null } } })).toBe(2)
  })

  it('returns 404 before listing notifications for a user outside the requested org', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const outsider = await seedOrgWithAdmin(prisma)

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications`)
      .set('Authorization', as(outsider.adminFirebaseUid))

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Organization not found' })
  })

  it('does not mutate a notification from another org when the recipient belongs to both orgs', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    await prisma.membership.create({
      data: { userId: orgA.adminUserId, orgId: orgB.orgId, roles: ['basic'] },
    })
    const notification = await createNotification({
      orgId: orgB.orgId,
      recipientUserId: orgA.adminUserId,
    })

    const res = await request(app)
      .patch(`/api/orgs/${orgA.orgId}/notifications/${notification.id}`)
      .set('Authorization', as(orgA.adminFirebaseUid))
      .send({ action: 'read' })

    expect(res.status).toBe(404)
    expect(await prisma.notification.findFirstOrThrow({ where: { id: notification.id, orgId: orgB.orgId } }))
      .toMatchObject({ readAt: null })
  })
})
