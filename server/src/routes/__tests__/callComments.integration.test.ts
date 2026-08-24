// MAI-244 acceptance coverage against a real Postgres schema. Unlike the route
// unit suite, these tests prove the durable tenant filters, unique reaction key,
// cascades, and the complete authenticated HTTP journey together.
import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { createTestPrisma, seedCall, seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

let prisma: PrismaClient
let app: express.Express
let activeUserId = ''

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function mentionDoc(userIds: string[], text: string) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        ...userIds.map((id) => ({ type: 'mention', attrs: { id, kind: 'teammate', label: id } })),
        { type: 'text', text },
      ],
    }],
  }
}

function url(orgId: string, callId: string) {
  return `/api/orgs/${orgId}/calls/${callId}/comments`
}

beforeAll(async () => {
  prisma = createTestPrisma()
  vi.resetModules()
  vi.doMock('../../db.js', () => ({ default: prisma }))
  vi.doMock('../../middleware/auth.js', () => ({
    requireAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
      ;(req as express.Request & { user?: { id: string } }).user = { id: activeUserId }
      next()
    },
  }))
  const { default: callCommentsRouter } = await import('../callComments.js')
  const { default: notificationsRouter } = await import('../notifications.js')
  app = express()
  app.use(express.json())
  app.use('/api/orgs/:orgId/calls/:callId/comments', callCommentsRouter)
  app.use('/api/orgs/:orgId/notifications', notificationsRouter)
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(() => {
  activeUserId = ''
})

describe('Timed call comments (integration, real Postgres)', () => {
  it('rejects missing or inverted anchors and forged active-org mentions before writing', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: a.orgId, userId: a.adminUserId })
    activeUserId = a.adminUserId

    await request(app)
      .post(url(a.orgId, call.id))
      .send({ bodyJson: doc('No moment') })
      .expect(400)
    await request(app)
      .post(url(a.orgId, call.id))
      .send({ atMs: 800, anchorEndMs: 799, bodyJson: doc('Backwards selection') })
      .expect(400)
    await request(app)
      .post(url(a.orgId, call.id))
      .send({
        atMs: 0,
        bodyJson: {
          type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'mention', attrs: { id: b.adminUserId } }, { type: 'text', text: ' forged' },
          ] }],
        },
      })
      .expect(422)

    expect(await prisma.callComment.count({ where: { orgId: a.orgId, callId: call.id } })).toBe(0)
  })

  it('keeps the root’s exact anchor through transcript replacement, permits one reply, and hides the call from another org', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const b = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: a.orgId, userId: a.adminUserId })
    activeUserId = a.adminUserId

    const root = await request(app)
      .post(url(a.orgId, call.id))
      .send({ atMs: 0, anchorEndMs: 1_250, anchorQuote: 'Original pass', bodyJson: doc('Discuss this.') })
      .expect(201)
    const rootId = root.body.comment.id as string

    await request(app)
      .post(`${url(a.orgId, call.id)}/${rootId}/replies`)
      .send({ bodyJson: doc('I will own the follow-up.') })
      .expect(201)
    const reply = await prisma.callComment.findFirstOrThrow({ where: { orgId: a.orgId, callId: call.id, parentId: rootId } })
    expect(reply.atMs).toBeNull()

    await request(app)
      .post(`${url(a.orgId, call.id)}/${reply.id}/replies`)
      .send({ bodyJson: doc('A second reply level is forbidden.') })
      .expect(400)

    await prisma.transcript.create({ data: { orgId: a.orgId, callId: call.id, provider: 'deepgram', plainText: 'Replacement pass' } })
    const reread = await prisma.callComment.findFirstOrThrow({ where: { id: rootId, orgId: a.orgId, callId: call.id } })
    expect(reread.atMs).toBe(0)
    expect(reread.anchorEndMs).toBe(1_250)
    expect(reread.anchorQuote).toBe('Original pass')

    activeUserId = b.adminUserId
    await request(app).get(url(a.orgId, call.id)).expect(404)
  })

  it('makes reactions idempotent, tombstones a parent, and physically deletes a leaf with its reactions', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: a.orgId, userId: a.adminUserId })
    activeUserId = a.adminUserId

    const root = await request(app)
      .post(url(a.orgId, call.id))
      .send({ atMs: 1_500, bodyJson: doc('Please review.') })
      .expect(201)
    const rootId = root.body.comment.id as string
    const reply = await request(app)
      .post(`${url(a.orgId, call.id)}/${rootId}/replies`)
      .send({ bodyJson: doc('Reviewed.') })
      .expect(201)
    const replyId = reply.body.comment.id as string

    await request(app).put(`${url(a.orgId, call.id)}/${replyId}/reactions/👍`).expect(204)
    await request(app).put(`${url(a.orgId, call.id)}/${replyId}/reactions/👍`).expect(204)
    expect(await prisma.callCommentReaction.count({ where: { orgId: a.orgId, commentId: replyId } })).toBe(1)

    await request(app).delete(`${url(a.orgId, call.id)}/${rootId}`).expect(204)
    const tombstone = await prisma.callComment.findFirstOrThrow({ where: { id: rootId, orgId: a.orgId, callId: call.id } })
    expect(tombstone.deletedAt).not.toBeNull()
    expect(await prisma.callComment.count({ where: { orgId: a.orgId, parentId: rootId } })).toBe(1)

    await request(app).delete(`${url(a.orgId, call.id)}/${replyId}`).expect(204)
    expect(await prisma.callComment.findFirst({ where: { id: replyId, orgId: a.orgId, callId: call.id } })).toBeNull()
    expect(await prisma.callCommentReaction.count({ where: { orgId: a.orgId, commentId: replyId } })).toBe(0)
  })

  it('rejects an inactive teammate mention through the shared resolver', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: a.orgId, userId: a.adminUserId })
    const teammate = await seedMember(prisma, a.orgId)
    await prisma.membership.updateMany({ where: { id: teammate.membershipId, orgId: a.orgId }, data: { isActive: false } })
    activeUserId = a.adminUserId

    await request(app)
      .post(url(a.orgId, call.id))
      .send({
        atMs: 10,
        bodyJson: {
          type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'mention', attrs: { id: teammate.userId } }, { type: 'text', text: ' is no longer active.' },
          ] }],
        },
      })
      .expect(422)
  })

  it('fans out only new teammate mentions and resolves a safe exact-moment notification destination', async () => {
    const a = await seedOrgWithAdmin(prisma)
    const call = await seedCall(prisma, { orgId: a.orgId, userId: a.adminUserId })
    const firstTeammate = await seedMember(prisma, a.orgId)
    const secondTeammate = await seedMember(prisma, a.orgId)
    activeUserId = a.adminUserId

    const created = await request(app)
      .post(url(a.orgId, call.id))
      .send({
        atMs: 2_750,
        bodyJson: mentionDoc([firstTeammate.userId, a.adminUserId], ' review this moment.'),
      })
      .expect(201)
    const commentId = created.body.comment.id as string

    expect(await prisma.notificationObject.count({
      where: { orgId: a.orgId, eventKey: `call_comment:${commentId}:mentions:v1` },
    })).toBe(1)
    expect(await prisma.notification.count({
      where: { orgId: a.orgId, recipientUserId: firstTeammate.userId },
    })).toBe(1)
    expect(await prisma.notification.count({
      where: { orgId: a.orgId, recipientUserId: a.adminUserId },
    })).toBe(0)

    const editedBody = mentionDoc(
      [firstTeammate.userId, secondTeammate.userId, a.adminUserId],
      ' both review this moment.',
    )
    await request(app)
      .patch(`${url(a.orgId, call.id)}/${commentId}`)
      .send({ bodyJson: editedBody })
      .expect(200)
    await request(app)
      .patch(`${url(a.orgId, call.id)}/${commentId}`)
      .send({ bodyJson: editedBody })
      .expect(200)

    expect(await prisma.notificationObject.count({
      where: { orgId: a.orgId, eventKey: `call_comment:${commentId}:mentions:v1` },
    })).toBe(1)
    expect(await prisma.notification.count({
      where: {
        orgId: a.orgId,
        recipientUserId: { in: [firstTeammate.userId, secondTeammate.userId] },
      },
    })).toBe(2)

    activeUserId = firstTeammate.userId
    const available = await request(app)
      .get(`/api/orgs/${a.orgId}/notifications?objectType=call`)
      .expect(200)
    expect(available.body.notifications).toHaveLength(1)
    expect(available.body.notifications[0].source).toMatchObject({
      status: 'available',
      type: 'call',
      title: 'You were mentioned in a call comment',
      route: `/orgs/${a.orgId}/calls/${call.id}?mode=comments&commentId=${commentId}`,
    })

    activeUserId = a.adminUserId
    await request(app).delete(`${url(a.orgId, call.id)}/${commentId}`).expect(204)

    activeUserId = firstTeammate.userId
    const unavailable = await request(app)
      .get(`/api/orgs/${a.orgId}/notifications`)
      .expect(200)
    expect(unavailable.body.notifications[0].source).toMatchObject({
      status: 'unavailable',
      type: 'call',
      title: 'You were mentioned in a call comment',
      preview: expect.stringContaining('review this moment'),
    })
    expect(unavailable.body.notifications[0].source).not.toHaveProperty('route')
  })
})
