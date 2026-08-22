// Call-comment route contract (MAI-244). The API adds collaboration to one call
// without ever trusting caller-supplied tenancy, authors, anchors, or mentions.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    call: { findFirst: vi.fn() },
    transcript: { findFirst: vi.fn() },
    callComment: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    callCommentReaction: { createMany: vi.fn(), deleteMany: vi.fn() },
    $queryRaw: vi.fn(),
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

const NOW = new Date('2026-08-22T17:10:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const CALL_A = 'call-a'
const URL_A = `/api/orgs/${ORG_A}/calls/${CALL_A}/comments`

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function userRow() {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.example', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
    currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW,
  }
}

function membershipRow() {
  return {
    id: 'membership-a', userId: 'user-a', orgId: ORG_A, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  }
}

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comment-1', orgId: ORG_A, callId: CALL_A, parentId: null, authorUserId: 'user-a',
    bodyJson: doc('Original'), bodyText: 'Original', atMs: 400, anchorEndMs: null,
    anchorQuote: null, selectionStartChar: null, selectionEndChar: null, transcriptId: null,
    deletedAt: null, createdAt: NOW, updatedAt: NOW,
    author: { id: 'user-a', firstName: 'Al', lastName: 'Pha', imageUrl: null }, reactions: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.example' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membershipRow())
  prismaMock.call.findFirst.mockResolvedValue({ id: CALL_A })
  prismaMock.transcript.findFirst.mockResolvedValue({ id: 'transcript-1' })
  prismaMock.callComment.findFirst.mockResolvedValue(commentRow())
  prismaMock.callComment.findMany.mockResolvedValue([])
  prismaMock.callComment.count.mockResolvedValue(0)
  prismaMock.callComment.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.callComment.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.callCommentReaction.createMany.mockResolvedValue({ count: 1 })
  prismaMock.callCommentReaction.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.$queryRaw.mockResolvedValue([{ id: 'comment-1' }])
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock))
})

describe('GET /api/orgs/:orgId/calls/:callId/comments', () => {
  it('lists paged root threads with their ordered replies, all scoped to the call and org', async () => {
    prismaMock.callComment.findMany.mockResolvedValue([
      commentRow({ replies: [commentRow({ id: 'reply-1', parentId: 'comment-1', atMs: null })] }),
    ])
    prismaMock.callComment.count.mockResolvedValue(1)

    const res = await request(app).get(`${URL_A}?page=2&limit=10`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 1, page: 2, limit: 10 })
    expect(res.body.comments[0]).toMatchObject({ id: 'comment-1', atMs: 400 })
    expect(res.body.comments[0].replies).toMatchObject([{ id: 'reply-1', parentId: 'comment-1', atMs: null }])
    expect(prismaMock.callComment.count).toHaveBeenCalledWith({
      where: { orgId: ORG_A, callId: CALL_A, parentId: null },
    })
    expect(prismaMock.callComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: ORG_A, callId: CALL_A, parentId: null }, skip: 10, take: 10,
    }))
  })
})

describe('POST /api/orgs/:orgId/calls/:callId/comments', () => {
  it('creates a root comment anchored to the exact media moment and derives plain text', async () => {
    prismaMock.callComment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'comment-new', parentId: null, deletedAt: null, ...data, createdAt: NOW, updatedAt: NOW, parent: null,
      author: { id: 'user-a', firstName: 'Al', lastName: 'Pha', imageUrl: null }, reactions: [],
    }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        atMs: 0,
        anchorEndMs: 1_250,
        anchorQuote: 'A real moment in the call.',
        selectionStartChar: 12,
        selectionEndChar: 37,
        transcriptId: 'transcript-1',
        bodyJson: doc('Can we follow up on this?'),
      })

    expect(res.status).toBe(201)
    expect(res.body.comment).toMatchObject({
      id: 'comment-new', atMs: 0, bodyText: 'Can we follow up on this?', parentId: null,
    })
    expect(prismaMock.callComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG_A,
        callId: CALL_A,
        authorUserId: 'user-a',
        atMs: 0,
        bodyText: 'Can we follow up on this?',
      }),
      include: expect.any(Object),
    })
  })

  it('rejects an untimed root and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('Where is this anchored?') })

    expect(res.status).toBe(400)
    expect(prismaMock.callComment.create).not.toHaveBeenCalled()
  })

  it('rejects a forged mention before it writes the comment', async () => {
    prismaMock.membership.findMany.mockResolvedValue([])

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        atMs: 600,
        bodyJson: {
          type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'mention', attrs: { id: 'foreign-user' } }, { type: 'text', text: ' can you review?' },
          ] }],
        },
      })

    expect(res.status).toBe(422)
    expect(prismaMock.callComment.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/orgs/:orgId/calls/:callId/comments/:commentId/replies', () => {
  it('adds one reply below a root without copying or accepting a new media anchor', async () => {
    prismaMock.callComment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => (
      commentRow({ id: 'reply-1', ...data, parentId: 'comment-1', atMs: null })
    ))

    const res = await request(app)
      .post(`${URL_A}/comment-1/replies`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('I will take it.') })

    expect(res.status).toBe(201)
    expect(res.body.comment).toMatchObject({ id: 'reply-1', parentId: 'comment-1', atMs: null })
    expect(prismaMock.callComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: ORG_A, callId: CALL_A, parentId: 'comment-1', atMs: undefined }),
      include: expect.any(Object),
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('rejects a second reply level before it writes', async () => {
    prismaMock.callComment.findFirst.mockResolvedValue(commentRow({ id: 'reply-1', parentId: 'comment-1', atMs: null }))

    const res = await request(app)
      .post(`${URL_A}/reply-1/replies`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('Too deep.') })

    expect(res.status).toBe(400)
    expect(prismaMock.callComment.create).not.toHaveBeenCalled()
  })
})

describe('PATCH and DELETE /api/orgs/:orgId/calls/:callId/comments/:commentId', () => {
  it('lets only the author update a live comment and always re-derives its plain text', async () => {
    prismaMock.callComment.findFirst
      .mockResolvedValueOnce(commentRow())
      .mockResolvedValueOnce(commentRow({ bodyJson: doc('Updated'), bodyText: 'Updated' }))

    const res = await request(app)
      .patch(`${URL_A}/comment-1`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('Updated'), bodyText: 'A forged derived value' })

    expect(res.status).toBe(200)
    expect(res.body.comment.bodyText).toBe('Updated')
    expect(prismaMock.callComment.updateMany).toHaveBeenCalledWith({
      where: { id: 'comment-1', orgId: ORG_A, callId: CALL_A, authorUserId: 'user-a', deletedAt: null },
      data: expect.objectContaining({ bodyText: 'Updated' }),
    })
  })

  it('leaves a deleted root as a tombstone when it has replies', async () => {
    prismaMock.callComment.findFirst.mockResolvedValue(commentRow({ replies: [{ id: 'reply-1' }] }))

    const res = await request(app).delete(`${URL_A}/comment-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.callComment.updateMany).toHaveBeenCalledWith({
      where: { id: 'comment-1', orgId: ORG_A, callId: CALL_A, authorUserId: 'user-a', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(prismaMock.callComment.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })
})

describe('PUT and DELETE /api/orgs/:orgId/calls/:callId/comments/:commentId/reactions/:emoji', () => {
  it('makes the same reaction idempotent through the unique database key', async () => {
    const res = await request(app).put(`${URL_A}/comment-1/reactions/👍`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.callCommentReaction.createMany).toHaveBeenCalledWith({
      data: { orgId: ORG_A, commentId: 'comment-1', userId: 'user-a', emoji: '👍' },
      skipDuplicates: true,
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('treats deleting an already-absent personal reaction as a successful no-op', async () => {
    prismaMock.callCommentReaction.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/comment-1/reactions/👍`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.callCommentReaction.deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, commentId: 'comment-1', userId: 'user-a', emoji: '👍' },
    })
  })
})
