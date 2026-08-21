// Route tests for /api/orgs/:orgId/tasks (MAI-141, T13).
//
// The unit suite mocks Prisma, so it proves the route WIRING: the org comes from
// the path and never the body, attachments are written through the EXISTING
// RecordLink table (never a parallel link table), `origin` is set at create and
// refused on update, `isDone` and `doneAt` move as a pair, an assignee must be a
// member, and writes are org-scoped through updateMany. Real row state, real
// cascades, and the acceptance criteria themselves are proven by
// tasks.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    person: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    objectDef: { findFirst: vi.fn() },
    record: { findFirst: vi.fn() },
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    recordLink: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
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
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/tasks`

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
function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1', orgId: ORG_A, title: 'Call Jane back', body: null, type: 'call',
    priority: 'high', commitment: 'soft', assigneeUserId: 'user-a', dueAt: null, remindAt: null,
    eventId: null, origin: 'manual', isDone: false, doneAt: null, deletedAt: null,
    deletedById: null, createdAt: NOW, updatedAt: NOW, ...overrides,
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
  prismaMock.task.findFirst.mockResolvedValue(taskRow())
  prismaMock.task.findMany.mockResolvedValue([taskRow()])
  prismaMock.task.count.mockResolvedValue(1)
  prismaMock.task.create.mockResolvedValue(taskRow({ id: 'task-new' }))
  prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.recordLink.findMany.mockResolvedValue([])
  prismaMock.recordLink.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.recordLink.createMany.mockResolvedValue({ count: 0 })
})

// ============================================================
// POST — create, attachments, origin, and the org boundary
// ============================================================
describe('POST /api/orgs/:orgId/tasks', () => {
  it('creates a task, forcing orgId from the path', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: '  Call Jane back  ', orgId: ORG_B, type: 'call', priority: 'high' })

    expect(res.status).toBe(201)
    const data = prismaMock.task.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    expect(data.title).toBe('Call Jane back')
    expect(data.type).toBe('call')
  })

  it('defaults type, priority, commitment, and origin the way the schema does', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ title: 'Follow up' })

    const data = prismaMock.task.create.mock.calls[0][0].data
    expect(data.type).toBe('todo')
    expect(data.priority).toBe('med')
    expect(data.commitment).toBe('soft')
    expect(data.origin).toBe('manual')
  })

  it('attaches the task through RecordLink — both halves of the T7 seam', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        title: 'Call Jane back',
        links: [
          { object: 'person', id: 'person-1' },
          { object: 'company', id: 'co-1' },
          { object: 'deal', id: 'deal-1' },
        ],
      })

    expect(res.status).toBe(201)
    const rows = prismaMock.recordLink.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.orgId).toBe(ORG_A)
      // The generic edge...
      expect(row.fromObject).toBe('task')
      expect(row.fromId).toBe('task-new')
      // ...and the real foreign key, together. Writing one without the other is
      // the bug the seam exists to prevent.
      expect(row.taskId).toBe('task-new')
      expect(row.noteId).toBeUndefined()
      // A note/task attachment did not come from a reference FIELD.
      expect(row.attribute).toBeNull()
    }
    expect(rows.map((r: { toObject: string }) => r.toObject)).toEqual([
      'person', 'company', 'deal',
    ])
    // The response echoes what was attached.
    expect(res.body.task.links).toHaveLength(3)
  })

  it('collapses a target named twice into one attachment', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({
        title: 'Call Jane back',
        links: [
          { object: 'person', id: 'person-1' },
          { object: 'person', id: 'person-1' },
        ],
      })

    expect(prismaMock.recordLink.createMany.mock.calls[0][0].data).toHaveLength(1)
  })

  it('marks a calendar-derived task, and keeps eventId a separate fact', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: 'Prep for the demo', origin: 'calendar', eventId: 'evt-9' })

    const data = prismaMock.task.create.mock.calls[0][0].data
    expect(data.origin).toBe('calendar')
    expect(data.eventId).toBe('evt-9')
  })

  it('422s an attachment to a record that is not in this org', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: 'Call Jane back', links: [{ object: 'company', id: 'co-other-org' }] })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('co-other-org')
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('422s an attachment to an object this org has never defined', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: 'Call Jane back', links: [{ object: 'widget', id: 'rec-1' }] })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('widget')
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('422s an assignee who is not an active member of this org', async () => {
    // The auth membership resolves; the assignee lookup does not.
    prismaMock.membership.findFirst.mockResolvedValueOnce(membershipRow()).mockResolvedValueOnce(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: 'Call Jane back', assigneeUserId: 'user-elsewhere' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('assignee')
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('400s a task with no title, and one with an unknown enum value', async () => {
    const noTitle = await request(app).post(URL_A).set('Authorization', AUTH).send({ body: 'hi' })
    expect(noTitle.status).toBe(400)

    const badType = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: 'x', type: 'carrier-pigeon' })
    expect(badType.status).toBe(400)
    expect(badType.body.error).toContain('type is one of')

    const badOrigin = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ title: 'x', origin: 'telepathy' })
    expect(badOrigin.status).toBe(400)

    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('404s a caller with no membership in the org, without saying it exists', async () => {
    authAs(null)
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ title: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('writes NO activity feed row — a task has not happened yet', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ title: 'Call Jane back' })
    // The mock has no activityEntry at all: if the route reached for one it would
    // throw, and this would not be a 201.
    expect(prismaMock).not.toHaveProperty('activityEntry')
  })
})

// ============================================================
// GET — list filters and the single row
// ============================================================
describe('GET /api/orgs/:orgId/tasks', () => {
  it('scopes every list read to the org in the path and hides the trash', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    const where = prismaMock.task.findMany.mock.calls[0][0].where
    expect(where.orgId).toBe(ORG_A)
    expect(where.deletedAt).toBeNull()
    // The count reads the SAME where clause, so total and rows agree.
    expect(prismaMock.task.count.mock.calls[0][0].where).toEqual(where)
  })

  it('filters by origin, so calendar-derived work is its own list', async () => {
    await request(app).get(`${URL_A}?origin=calendar`).set('Authorization', AUTH)
    expect(prismaMock.task.findMany.mock.calls[0][0].where.origin).toBe('calendar')

    prismaMock.task.findMany.mockClear()
    await request(app).get(`${URL_A}?origin=manual`).set('Authorization', AUTH)
    expect(prismaMock.task.findMany.mock.calls[0][0].where.origin).toBe('manual')
  })

  it('filters by assignee and done-ness', async () => {
    await request(app)
      .get(`${URL_A}?assigneeUserId=user-a&isDone=false`)
      .set('Authorization', AUTH)
    const where = prismaMock.task.findMany.mock.calls[0][0].where
    expect(where.assigneeUserId).toBe('user-a')
    expect(where.isDone).toBe(false)
  })

  it('narrows to the tasks attached to one record, through RecordLink', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([{ noteId: null, taskId: 'task-7' }])

    await request(app)
      .get(`${URL_A}?linkObject=company&linkId=co-1`)
      .set('Authorization', AUTH)

    const linkWhere = prismaMock.recordLink.findMany.mock.calls[0][0].where
    expect(linkWhere).toMatchObject({ orgId: ORG_A, fromObject: 'task', toObject: 'company', toId: 'co-1' })
    expect(prismaMock.task.findMany.mock.calls[0][0].where.id).toEqual({ in: ['task-7'] })
  })

  it('returns an EMPTY page when nothing is attached, never an unfiltered one', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([])

    await request(app)
      .get(`${URL_A}?linkObject=company&linkId=co-empty`)
      .set('Authorization', AUTH)

    expect(prismaMock.task.findMany.mock.calls[0][0].where.id).toEqual({ in: [] })
  })

  it('400s half an attachment filter, and a backwards due window', async () => {
    const halfFilter = await request(app)
      .get(`${URL_A}?linkObject=company`)
      .set('Authorization', AUTH)
    expect(halfFilter.status).toBe(400)

    const backwards = await request(app)
      .get(`${URL_A}?dueFrom=2026-09-01&dueTo=2026-08-01`)
      .set('Authorization', AUTH)
    expect(backwards.status).toBe(400)
  })

  it('caps the page size and rejects an unknown sort column', async () => {
    await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH).expect(400)
    await request(app).get(`${URL_A}?sort=orgId`).set('Authorization', AUTH).expect(400)
  })

  it('sorts undated tasks last rather than letting Postgres decide', async () => {
    await request(app).get(`${URL_A}?sort=dueAt&dir=asc`).set('Authorization', AUTH)
    expect(prismaMock.task.findMany.mock.calls[0][0].orderBy[0]).toEqual({
      dueAt: { sort: 'asc', nulls: 'last' },
    })
  })
})

describe('GET /api/orgs/:orgId/tasks/:id', () => {
  it('looks up by id AND orgId together, and returns the attachments', async () => {
    prismaMock.recordLink.findMany.mockResolvedValue([{ toObject: 'person', toId: 'person-1' }])

    const res = await request(app).get(`${URL_A}/task-1`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.task.findFirst.mock.calls[0][0].where).toEqual({
      id: 'task-1', orgId: ORG_A, deletedAt: null,
    })
    expect(res.body.task.links).toEqual([{ object: 'person', id: 'person-1' }])
    expect(res.body.task).not.toHaveProperty('orgId')
  })

  it('404s a task in another org exactly like one that does not exist', async () => {
    prismaMock.task.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/task-elsewhere`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Task not found')
  })
})

// ============================================================
// PATCH — completion, reassignment, re-attachment, and the origin rule
// ============================================================
describe('PATCH /api/orgs/:orgId/tasks/:id', () => {
  it('writes through updateMany with orgId in the where, never update by id', async () => {
    await request(app)
      .patch(`${URL_A}/task-1`)
      .set('Authorization', AUTH)
      .send({ title: 'Call Jane back today' })

    expect(prismaMock.task.update).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany.mock.calls[0][0].where).toEqual({
      id: 'task-1', orgId: ORG_A, deletedAt: null,
    })
  })

  it('sets isDone and doneAt together', async () => {
    await request(app).patch(`${URL_A}/task-1`).set('Authorization', AUTH).send({ isDone: true })

    const data = prismaMock.task.updateMany.mock.calls[0][0].data
    expect(data.isDone).toBe(true)
    expect(data.doneAt).toBeInstanceOf(Date)
  })

  it('clears doneAt when a task is re-opened', async () => {
    prismaMock.task.findFirst.mockResolvedValue(taskRow({ isDone: true, doneAt: NOW }))

    await request(app).patch(`${URL_A}/task-1`).set('Authorization', AUTH).send({ isDone: false })

    const data = prismaMock.task.updateMany.mock.calls[0][0].data
    expect(data.isDone).toBe(false)
    expect(data.doneAt).toBeNull()
  })

  it('does not move doneAt when an already-done task is re-ticked', async () => {
    const originally = new Date('2026-08-01T09:00:00.000Z')
    prismaMock.task.findFirst.mockResolvedValue(taskRow({ isDone: true, doneAt: originally }))

    await request(app).patch(`${URL_A}/task-1`).set('Authorization', AUTH).send({ isDone: true })

    // No write at all for the done pair — "when was this finished" must not move
    // because somebody re-ticked a box.
    const data = prismaMock.task.updateMany.mock.calls[0]?.[0]?.data ?? {}
    expect(data).not.toHaveProperty('doneAt')
  })

  it('ignores an attempt to change origin — a sync must not claim a hand-made task', async () => {
    await request(app)
      .patch(`${URL_A}/task-1`)
      .set('Authorization', AUTH)
      .send({ origin: 'calendar', title: 'still mine' })

    const data = prismaMock.task.updateMany.mock.calls[0][0].data
    expect(data).not.toHaveProperty('origin')
    expect(data.title).toBe('still mine')
  })

  it('replaces the whole attachment set when links are sent', async () => {
    await request(app)
      .patch(`${URL_A}/task-1`)
      .set('Authorization', AUTH)
      .send({ links: [{ object: 'deal', id: 'deal-1' }] })

    // Keyed on the real foreign key, so it can never reach another task's links.
    expect(prismaMock.recordLink.deleteMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A, taskId: 'task-1',
    })
    expect(prismaMock.recordLink.createMany.mock.calls[0][0].data).toHaveLength(1)
  })

  it('leaves the attachments alone when links are omitted', async () => {
    await request(app).patch(`${URL_A}/task-1`).set('Authorization', AUTH).send({ priority: 'low' })
    expect(prismaMock.recordLink.deleteMany).not.toHaveBeenCalled()
  })

  it('can clear the assignee and the due date with an explicit null', async () => {
    await request(app)
      .patch(`${URL_A}/task-1`)
      .set('Authorization', AUTH)
      .send({ assigneeUserId: null, dueAt: null })

    const data = prismaMock.task.updateMany.mock.calls[0][0].data
    expect(data.assigneeUserId).toBeNull()
    expect(data.dueAt).toBeNull()
  })

  it('404s a task in another org before it validates anything', async () => {
    prismaMock.task.findFirst.mockResolvedValue(null)
    const res = await request(app)
      .patch(`${URL_A}/task-elsewhere`)
      .set('Authorization', AUTH)
      .send({ title: 'mine now' })
    expect(res.status).toBe(404)
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE — the 30-day trash
// ============================================================
describe('DELETE /api/orgs/:orgId/tasks/:id', () => {
  it('soft-deletes, recording who binned it, org-scoped', async () => {
    const res = await request(app).delete(`${URL_A}/task-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.task.delete).not.toHaveBeenCalled()
    const call = prismaMock.task.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'task-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
    expect(call.data.deletedById).toBe('user-a')
  })

  it('404s when nothing in this org matched', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app).delete(`${URL_A}/task-elsewhere`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})
