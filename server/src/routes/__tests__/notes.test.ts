// Route tests for /api/orgs/:orgId/notes (MAI-141, T13).
//
// The unit suite mocks Prisma, so it proves the route WIRING: a note attaches to
// MANY records through the EXISTING RecordLink table (never a parallel link
// table), `bodyText` is DERIVED from bodyJson and can never be supplied, the
// author is the verified caller, the ONE feed row is written inside the SAME
// transaction as the note, and trashing a note takes its feed row with it. Real
// row state, the real cascade, and the acceptance criteria themselves are proven
// by notes.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    person: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    objectDef: { findFirst: vi.fn() },
    record: { findFirst: vi.fn() },
    note: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    recordLink: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    activityEntry: { upsert: vi.fn(), deleteMany: vi.fn() },
    notificationObject: { upsert: vi.fn() },
    notification: { createMany: vi.fn() },
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

const NOW = new Date('2026-08-21T12:00:00.000Z')
const WRITTEN = new Date('2026-08-19T09:30:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/notes`

// A minimal TipTap document.
function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function docWithTeammateMention(userId: string) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Please review this, ' },
        { type: 'mention', attrs: { id: userId, label: 'Taylor Teammate', kind: 'teammate' } },
      ],
    }],
  }
}

function docWithRecordMention(kind: 'contact' | 'company' | 'deal', id: string) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'mention', attrs: { id, label: 'Acme', kind } }],
    }],
  }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a', firebaseUid: 'uid-a', email: 'a@orga.com', firstName: 'Al', lastName: 'Pha',
    title: null, imageUrl: null, roles: ['basic'], enabled: true, timeZone: 'America/New_York',
    currentOrgId: ORG_A, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}
function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a', userId: 'user-a', orgId: ORG_A, roles: ['basic'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}
function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1', orgId: ORG_A, bodyJson: doc('They want pricing by Friday.'),
    bodyText: 'They want pricing by Friday.', authorUserId: 'user-a', deletedAt: null,
    createdAt: WRITTEN, updatedAt: NOW, ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock))
  prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1' })
  prismaMock.company.findFirst.mockResolvedValue({ id: 'co-1' })
  prismaMock.deal.findFirst.mockResolvedValue({ id: 'deal-1' })
  prismaMock.objectDef.findFirst.mockResolvedValue(null)
  prismaMock.record.findFirst.mockResolvedValue(null)
  prismaMock.note.findFirst.mockResolvedValue(noteRow())
  prismaMock.note.findMany.mockResolvedValue([noteRow()])
  prismaMock.note.count.mockResolvedValue(1)
  prismaMock.note.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => noteRow({ id: 'note-new', ...args.data }),
  )
  prismaMock.note.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.recordLink.findMany.mockResolvedValue([])
  prismaMock.recordLink.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.recordLink.createMany.mockResolvedValue({ count: 0 })
  prismaMock.activityEntry.upsert.mockResolvedValue({ id: 'feed-1' })
  prismaMock.activityEntry.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.membership.findMany.mockResolvedValue([{ userId: 'user-a' }, { userId: 'user-b' }])
  prismaMock.notificationObject.upsert.mockResolvedValue({ id: 'notification-object-1' })
  prismaMock.notification.createMany.mockResolvedValue({ count: 1 })
})

// ============================================================
// POST — the acceptance criterion: one note, many records
// ============================================================
describe('POST /api/orgs/:orgId/notes', () => {
  it('links ONE note to MANY records through the existing RecordLink table', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        bodyJson: doc('Recap of the demo.'),
        links: [
          { object: 'company', id: 'co-1' },
          { object: 'person', id: 'person-1' },
          { object: 'deal', id: 'deal-1' },
        ],
      })

    expect(res.status).toBe(201)
    const rows = prismaMock.recordLink.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.orgId).toBe(ORG_A)
      // Both halves of the T7 seam: the generic edge AND the real foreign key.
      expect(row.fromObject).toBe('note')
      expect(row.fromId).toBe('note-new')
      expect(row.noteId).toBe('note-new')
      expect(row.taskId).toBeUndefined()
      expect(row.attribute).toBeNull()
    }
    expect(rows.map((r: { toObject: string; toId: string }) => `${r.toObject}:${r.toId}`)).toEqual([
      'company:co-1', 'person:person-1', 'deal:deal-1',
    ])
    expect(res.body.note.links).toHaveLength(3)
  })

  it('derives bodyText from bodyJson — a client cannot supply its own', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        bodyJson: {
          type: 'doc',
          content: [
            { type: 'heading', content: [{ type: 'text', text: 'Next steps' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Send the deck' }] },
          ],
        },
        // A lie, ignored: bodyText is not in the schema at all.
        bodyText: 'something else entirely',
      })

    expect(res.status).toBe(201)
    const data = prismaMock.note.create.mock.calls[0][0].data
    expect(data.bodyText).toBe('Next steps\nSend the deck')
    expect(data.bodyText).not.toContain('something else')
  })

  it('takes orgId from the path and the author from the verified caller', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('hi'), orgId: ORG_B, authorUserId: 'someone-else' })

    const data = prismaMock.note.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    expect(data.authorUserId).toBe('user-a')
  })

  it('writes the ONE feed row inside the SAME transaction as the note', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        bodyJson: doc('They want pricing by Friday.'),
        links: [
          { object: 'company', id: 'co-1' },
          { object: 'person', id: 'person-1' },
        ],
      })

    // One transaction; the note, the links, and the feed row all inside it.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const upsert = prismaMock.activityEntry.upsert.mock.calls[0][0]
    // Idempotent on (orgId, sourceType, sourceId) — a re-save refreshes one row.
    expect(upsert.where.orgId_sourceType_sourceId).toEqual({
      orgId: ORG_A, sourceType: 'note', sourceId: 'note-new',
    })
    expect(upsert.create.summary).toBe('Note: They want pricing by Friday.')
    expect(upsert.create.createdByUserId).toBe('user-a')
    expect(upsert.create.direction).toBeNull()
    // The at-most-one spine link a feed row can carry, rolled up from the many.
    expect(upsert.create.companyId).toBe('co-1')
    expect(upsert.create.personId).toBe('person-1')
    expect(upsert.create.dealId).toBeNull()
  })

  it('validates a structured teammate mention and fans one durable notification out atomically', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: docWithTeammateMention('user-b') })

    expect(res.status).toBe(201)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.notificationObject.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId_eventKey: { orgId: ORG_A, eventKey: 'note:note-new:mentions:v1' } },
      create: expect.objectContaining({
        actorUserId: 'user-a',
        objectType: 'note',
        objectId: 'note-new',
        verb: 'mentioned',
      }),
    }))
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ recipientUserId: 'user-b', orgId: ORG_A })],
      skipDuplicates: true,
    })
  })

  it('rejects a forged, inactive, or foreign teammate mention before writing the note', async () => {
    prismaMock.membership.findMany.mockResolvedValue([{ userId: 'user-a' }])

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: docWithTeammateMention('user-other-org') })

    expect(res.status).toBe(422)
    expect(prismaMock.note.create).not.toHaveBeenCalled()
    expect(prismaMock.notificationObject.upsert).not.toHaveBeenCalled()
  })

  it('persists a linked record chip without trying to notify that record id as a user', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: docWithRecordMention('company', 'co-1') })

    expect(res.status).toBe(201)
    expect(prismaMock.note.create).toHaveBeenCalled()
    expect(prismaMock.notificationObject.upsert).not.toHaveBeenCalled()
  })

  it('sanitizes the document before persisting, keeping a mention identity but dropping forged attributes', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        bodyJson: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [{
              type: 'mention',
              attrs: { id: 'user-b', label: 'Taylor', kind: 'teammate', onclick: 'alert(1)' },
            }],
          }],
        },
      })

    expect(res.status).toBe(201)
    const data = prismaMock.note.create.mock.calls[0][0].data
    expect(data.bodyJson).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { id: 'user-b', label: 'Taylor', kind: 'teammate' } }],
      }],
    })
  })

  it('422s an attachment to a record that is not in this org, writing nothing', async () => {
    prismaMock.person.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('hi'), links: [{ object: 'person', id: 'person-other-org' }] })

    expect(res.status).toBe(422)
    expect(prismaMock.note.create).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.upsert).not.toHaveBeenCalled()
  })

  it('400s a body that is not a TipTap document object', async () => {
    for (const bodyJson of [undefined, 'plain text', 42, ['a']]) {
      const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ bodyJson })
      expect(res.status).toBe(400)
    }
    expect(prismaMock.note.create).not.toHaveBeenCalled()
  })

  it('saves a note whose body carries no text at all', async () => {
    // An image-only note is a real note. It still gets a feed line.
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] } })

    expect(res.status).toBe(201)
    expect(prismaMock.note.create.mock.calls[0][0].data.bodyText).toBe('')
    expect(prismaMock.activityEntry.upsert.mock.calls[0][0].create.summary).toBe('Note added')
  })

  it('404s a caller with no membership in the org', async () => {
    authAs(null)
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('hi') })
    expect(res.status).toBe(404)
    expect(prismaMock.note.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list filters and the single row
// ============================================================
describe('GET /api/orgs/:orgId/notes', () => {
  it('scopes every read to the org in the path and hides the trash', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    const where = prismaMock.note.findMany.mock.calls[0][0].where
    expect(where.orgId).toBe(ORG_A)
    expect(where.deletedAt).toBeNull()
    expect(prismaMock.note.count.mock.calls[0][0].where).toEqual(where)
  })

  it('searches the FLATTENED body, which is what bodyText is for', async () => {
    await request(app).get(`${URL_A}?q=pricing`).set('Authorization', AUTH)
    expect(prismaMock.note.findMany.mock.calls[0][0].where.bodyText).toEqual({
      contains: 'pricing', mode: 'insensitive',
    })
  })

  it('narrows to the notes on one record, through RecordLink', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([
      { noteId: 'note-7', taskId: null },
      { noteId: 'note-7', taskId: null },
      { noteId: 'note-8', taskId: null },
    ])

    await request(app).get(`${URL_A}?linkObject=deal&linkId=deal-1`).set('Authorization', AUTH)

    expect(prismaMock.recordLink.findMany.mock.calls[0][0].where).toMatchObject({
      orgId: ORG_A, fromObject: 'note', toObject: 'deal', toId: 'deal-1',
    })
    // De-duplicated: one note attached twice is still one note.
    expect(prismaMock.note.findMany.mock.calls[0][0].where.id).toEqual({ in: ['note-7', 'note-8'] })
  })

  it('returns an EMPTY page when the record has no notes, never an unfiltered one', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([])
    await request(app).get(`${URL_A}?linkObject=deal&linkId=deal-9`).set('Authorization', AUTH)
    expect(prismaMock.note.findMany.mock.calls[0][0].where.id).toEqual({ in: [] })
  })

  it('400s half an attachment filter, an over-large page, and an unknown sort', async () => {
    await request(app).get(`${URL_A}?linkId=deal-1`).set('Authorization', AUTH).expect(400)
    await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH).expect(400)
    await request(app).get(`${URL_A}?sort=bodyText`).set('Authorization', AUTH).expect(400)
  })
})

describe('GET /api/orgs/:orgId/notes/:id', () => {
  it('looks up by id AND orgId, and returns every record it is attached to', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([
      { toObject: 'company', toId: 'co-1' },
      { toObject: 'person', toId: 'person-1' },
    ])

    const res = await request(app).get(`${URL_A}/note-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.note.findFirst.mock.calls[0][0].where).toEqual({
      id: 'note-1', orgId: ORG_A, deletedAt: null,
    })
    expect(res.body.note.links).toEqual([
      { object: 'company', id: 'co-1' },
      { object: 'person', id: 'person-1' },
    ])
    // BOTH bodies cross the wire, and the tenant boundary does not.
    expect(res.body.note.bodyJson).toBeTruthy()
    expect(res.body.note.bodyText).toBe('They want pricing by Friday.')
    expect(res.body.note).not.toHaveProperty('orgId')
  })

  it('404s a note in another org exactly like one that does not exist', async () => {
    prismaMock.note.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/note-elsewhere`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})

// ============================================================
// PATCH — editing keeps the two bodies and the feed line in step
// ============================================================
describe('PATCH /api/orgs/:orgId/notes/:id', () => {
  it('re-derives bodyText and writes both columns together, org-scoped', async () => {
    await request(app)
      .patch(`${URL_A}/note-1`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('They signed.') })

    expect(prismaMock.note.update).not.toHaveBeenCalled()
    const call = prismaMock.note.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'note-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.bodyText).toBe('They signed.')
    expect(call.data.bodyJson).toBeTruthy()
  })

  it('refreshes the feed line, without moving the note in the timeline', async () => {
    await request(app)
      .patch(`${URL_A}/note-1`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('They signed.') })

    const upsert = prismaMock.activityEntry.upsert.mock.calls[0][0]
    expect(upsert.update.summary).toBe('Note: They signed.')
    // The note's own createdAt, not now: editing must not jump it to the top of a
    // history.
    expect(upsert.update.occurredAt).toEqual(WRITTEN)
  })

  it('notifies only newly added teammates when a note is edited', async () => {
    prismaMock.note.findFirst.mockResolvedValue(noteRow({ bodyJson: doc('original') }))

    const res = await request(app)
      .patch(`${URL_A}/note-1`)
      .set('Authorization', AUTH)
      .send({ bodyJson: docWithTeammateMention('user-b') })

    expect(res.status).toBe(200)
    expect(prismaMock.notificationObject.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId_eventKey: { orgId: ORG_A, eventKey: 'note:note-1:mentions:v1' } },
    }))
  })

  it('replaces the whole attachment set when links are sent, and re-rolls the feed row', async () => {
    await request(app)
      .patch(`${URL_A}/note-1`)
      .set('Authorization', AUTH)
      .send({ links: [{ object: 'deal', id: 'deal-1' }] })

    // Keyed on the real foreign key, so it can never reach another note's links.
    expect(prismaMock.recordLink.deleteMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A, noteId: 'note-1',
    })
    const upsert = prismaMock.activityEntry.upsert.mock.calls[0][0]
    expect(upsert.update.dealId).toBe('deal-1')
    expect(upsert.update.companyId).toBeNull()
  })

  it('leaves the attachments alone when links are omitted, and reuses the stored ones', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([{ toObject: 'company', toId: 'co-1' }])

    await request(app)
      .patch(`${URL_A}/note-1`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('edited') })

    expect(prismaMock.recordLink.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.upsert.mock.calls[0][0].update.companyId).toBe('co-1')
  })

  it('404s a note in another org before it writes anything', async () => {
    prismaMock.note.findFirst.mockResolvedValue(null)
    const res = await request(app)
      .patch(`${URL_A}/note-elsewhere`)
      .set('Authorization', AUTH)
      .send({ bodyJson: doc('mine now') })
    expect(res.status).toBe(404)
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.activityEntry.upsert).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE — the trash, and the cache that must not outlive the row
// ============================================================
describe('DELETE /api/orgs/:orgId/notes/:id', () => {
  it('soft-deletes the note and removes its feed row in one transaction', async () => {
    const res = await request(app).delete(`${URL_A}/note-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.note.delete).not.toHaveBeenCalled()
    const call = prismaMock.note.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'note-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
    // The feed is read without a join back, so a line for a trashed note would be
    // a line nothing stands behind.
    expect(prismaMock.activityEntry.deleteMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A, sourceType: 'note', sourceId: 'note-1',
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('404s when nothing in this org matched, and touches no feed row', async () => {
    prismaMock.note.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app).delete(`${URL_A}/note-elsewhere`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(prismaMock.activityEntry.deleteMany).not.toHaveBeenCalled()
  })
})
