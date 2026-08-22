import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import { fanOutNotification } from '../notifications.js'

describe('NotificationObject fan-out (integration, real Postgres)', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    const { createTestPrisma } = await import('../../test/integration/testPrisma.js')
    prisma = createTestPrisma()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('fans one event out once per valid recipient, suppresses its actor, and cannot cross orgs', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const teammate = await seedMember(prisma, a.orgId)
    const foreignUser = await seedMember(prisma, b.orgId)
    const event = {
      orgId: a.orgId,
      eventKey: 'call-comment:comment-1:mentions:v1',
      actorUserId: a.adminUserId,
      verb: 'mentioned',
      object: {
        type: 'call_comment',
        id: 'comment-1',
        sourceSnapshot: { title: 'Comment on Acme discovery call', preview: 'Can you take this?' },
      },
      recipientUserIds: [a.adminUserId, teammate.userId, foreignUser.userId, teammate.userId],
    }

    const first = await fanOutNotification(prisma, event)
    const retried = await fanOutNotification(prisma, event)

    expect(first).toEqual({
      notificationObjectId: expect.any(String),
      recipientUserIds: [teammate.userId],
      rejectedRecipientUserIds: [foreignUser.userId],
    })
    expect(retried).toEqual(first)

    const objects = await prisma.notificationObject.findMany({ where: { orgId: a.orgId } })
    expect(objects).toHaveLength(1)
    expect(objects[0]).toMatchObject({
      orgId: a.orgId,
      eventKey: event.eventKey,
      actorUserId: a.adminUserId,
      verb: 'mentioned',
      objectType: 'call_comment',
      objectId: 'comment-1',
      sourceSnapshot: { title: 'Comment on Acme discovery call', preview: 'Can you take this?' },
    })

    const rows = await prisma.notification.findMany({
      where: { orgId: a.orgId },
      orderBy: { recipientUserId: 'asc' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      notificationObjectId: objects[0].id,
      recipientUserId: teammate.userId,
      readAt: null,
      archivedAt: null,
      snoozedUntil: null,
    })
    expect(await prisma.notification.count({ where: { orgId: b.orgId } })).toBe(0)
  })

  it('does not fan out to an inactive member', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const inactive = await seedMember(prisma, org.orgId)
    await prisma.membership.updateMany({
      where: { orgId: org.orgId, userId: inactive.userId },
      data: { isActive: false },
    })

    const result = await fanOutNotification(prisma, {
      orgId: org.orgId,
      eventKey: 'call-comment:comment-2:mentions:v1',
      actorUserId: org.adminUserId,
      verb: 'mentioned',
      object: {
        type: 'call_comment',
        id: 'comment-2',
        sourceSnapshot: { title: 'Comment on Acme discovery call' },
      },
      recipientUserIds: [inactive.userId],
    })

    expect(result.recipientUserIds).toEqual([])
    expect(result.rejectedRecipientUserIds).toEqual([inactive.userId])
    expect(await prisma.notification.count({ where: { orgId: org.orgId } })).toBe(0)
  })
})
