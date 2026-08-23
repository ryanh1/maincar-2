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
  verb?: string
  objectType?: string
  objectId?: string
  actorUserId?: string | null
  createdAt?: Date
  readAt?: Date | null
  archivedAt?: Date | null
  snoozedUntil?: Date | null
}): Promise<{ id: string }> {
  const object = await prisma.notificationObject.create({
    data: {
      orgId: args.orgId,
      eventKey: `notification-${Date.now()}-${Math.random()}`,
      actorUserId: args.actorUserId ?? null,
      verb: args.verb ?? 'mentioned',
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
  it('returns one readable card for a folded bundle and applies its lifecycle action to the bundle row', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
    const actors = await Promise.all(['Ana', 'Sam', 'Jules'].map(async (firstName, index) => {
      const actor = await prisma.user.create({
        data: {
          firebaseUid: `fb_bundle_${suffix}_${index}`,
          email: `bundle_${suffix}_${index}@example.com`,
          firstName,
          lastName: 'Commenter',
          currentOrgId: org.orgId,
        },
      })
      await prisma.membership.create({ data: { userId: actor.id, orgId: org.orgId, roles: ['basic'] } })
      return actor
    }))
    const objects = await Promise.all(actors.map((actor, index) => prisma.notificationObject.create({
      data: {
        orgId: org.orgId,
        eventKey: `bundle-comment-${suffix}-${index}`,
        actorUserId: actor.id,
        verb: 'commented',
        objectType: 'deal',
        objectId: 'acme-deal',
        sourceSnapshot: { title: 'Acme deal', preview: 'A comment was added.' },
      },
    })))
    const bundle = await prisma.notification.create({
      data: {
        orgId: org.orgId,
        notificationObjectId: objects[0].id,
        recipientUserId: recipient.userId,
        batchKey: `${recipient.userId}:comment:acme-deal`,
        objectIds: objects.map((object) => object.id),
        deliveryMode: 'batched',
      },
    })

    const listed = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications`)
      .set('Authorization', as(recipient.firebaseUid))

    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({
      total: 1,
      notifications: [{
        id: bundle.id,
        bundleSize: 3,
        summary: 'Ana and 2 others commented on the Acme deal',
      }],
    })

    const archived = await request(app)
      .patch(`/api/orgs/${org.orgId}/notifications/${bundle.id}`)
      .set('Authorization', as(recipient.firebaseUid))
      .send({ action: 'archive' })

    expect(archived.status).toBe(200)
    expect(await prisma.notification.findFirstOrThrow({ where: { id: bundle.id, orgId: org.orgId } })).toMatchObject({
      archivedAt: expect.any(Date),
      objectIds: objects.map((object) => object.id),
    })
  })

  it('lists only the recipient’s active inbox rows with pagination and safe source state', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const call = await seedCall(prisma, { orgId: org.orgId, userId: org.adminUserId })
    const visible = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      objectId: call.id,
      actorUserId: org.adminUserId,
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
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
    })

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications?page=1&limit=1`)
      .set('Authorization', as(recipient.firebaseUid))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 1 })
    expect(res.body.notifications).toHaveLength(1)
    expect(res.body.notifications[0]).toMatchObject({
      id: visible.id,
      actor: { name: 'Avery Admin', imageUrl: null },
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
    const returned = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      snoozedUntil: new Date('2000-01-01T00:00:00.000Z'),
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

    const inboxRes = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications`)
      .set('Authorization', as(recipient.firebaseUid))
    expect(inboxRes.status).toBe(200)
    expect(inboxRes.body.notifications.map((row: { id: string }) => row.id)).toContain(returned.id)
  })

  it('filters the non-archived inbox by unread state, event type, and object type', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const matching = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      verb: 'mentioned',
      objectType: 'company',
    })
    await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      verb: 'assigned',
      objectType: 'company',
    })
    await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      verb: 'mentioned',
      objectType: 'deal',
    })
    await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      verb: 'mentioned',
      objectType: 'company',
      readAt: new Date(),
    })
    const snoozed = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      verb: 'mentioned',
      objectType: 'company',
      snoozedUntil: new Date('2099-01-01T00:00:00.000Z'),
    })

    const inbox = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications`)
      .set('Authorization', as(recipient.firebaseUid))
    expect(inbox.body.notifications.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([matching.id, snoozed.id]))

    const filtered = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications?read=false&type=mentioned&objectType=company`)
      .set('Authorization', as(recipient.firebaseUid))
    expect(filtered.status).toBe(200)
    expect(filtered.body.notifications.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([matching.id, snoozed.id]))
    expect(filtered.body.notifications).toHaveLength(2)
  })

  it('resolves a live note mention to the record link that gives it context', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const recipient = await seedMember(prisma, org.orgId)
    const company = await prisma.company.create({ data: { orgId: org.orgId, name: 'Acme' } })
    const note = await prisma.note.create({
      data: {
        orgId: org.orgId,
        authorUserId: org.adminUserId,
        bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Please review.' }] }] },
        bodyText: 'Please review.',
      },
    })
    await prisma.recordLink.create({
      data: {
        orgId: org.orgId,
        noteId: note.id,
        fromObject: 'note',
        fromId: note.id,
        toObject: 'company',
        toId: company.id,
        attribute: null,
      },
    })
    const notification = await createNotification({
      orgId: org.orgId,
      recipientUserId: recipient.userId,
      objectType: 'note',
      objectId: note.id,
    })

    const res = await request(app)
      .get(`/api/orgs/${org.orgId}/notifications`)
      .set('Authorization', as(recipient.firebaseUid))

    expect(res.status).toBe(200)
    expect(res.body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: notification.id,
        source: expect.objectContaining({
          status: 'available',
          type: 'note',
          route: `/orgs/${org.orgId}/records/company?recordId=${company.id}`,
        }),
      }),
    ]))
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
