// Route tests for /api/orgs/:orgId/objects (MAI-133, T5).
//
// The heart of this suite is the two guards the database cannot enforce (spec
// §10.2): a standard ObjectDef can be hidden but never archived or deleted, and a
// user-created object is always storage="record"/isStandard=false. The rest pins
// the create/read/update/delete contract and org isolation.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    objectDef: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    attributeDef: { findMany: vi.fn() },
    fieldHistory: { findMany: vi.fn(), createMany: vi.fn() },
    record: { count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    person: { findFirst: vi.fn(), updateMany: vi.fn() },
    company: { findFirst: vi.fn(), updateMany: vi.fn() },
    deal: { findFirst: vi.fn(), updateMany: vi.fn() },
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
const URL_A = `/api/orgs/${ORG_A}/objects`

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
    timeZone: 'America/New_York',
    currentOrgId: ORG_A,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-a',
    userId: 'user-a',
    orgId: ORG_A,
    roles: ['basic'],
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    org: { id: ORG_A, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
    ...overrides,
  }
}

function objectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'obj-1',
    orgId: ORG_A,
    slug: 'project',
    name: 'Project',
    namePlural: 'Projects',
    icon: null,
    iconColor: null,
    storage: 'record',
    isStandard: false,
    isFirstClass: true,
    timelineEventsEnabled: false,
    isHidden: false,
    isArchived: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function attributeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attr-name',
    orgId: ORG_A,
    objectId: 'obj-1',
    slug: 'name',
    name: 'Name',
    type: 'text',
    storage: 'custom',
    isMulti: false,
    isReadOnly: false,
    isRequired: false,
    isUnique: false,
    optionsJson: null,
    validationJson: null,
    isArchived: false,
    deletedAt: null,
    ...overrides,
  }
}

function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.resetAllMocks()
  authAs()
  prismaMock.objectDef.findFirst.mockResolvedValue(null)
  prismaMock.objectDef.findMany.mockResolvedValue([objectRow()])
  prismaMock.objectDef.create.mockResolvedValue(objectRow())
  prismaMock.objectDef.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.attributeDef.findMany.mockResolvedValue([])
  prismaMock.fieldHistory.findMany.mockResolvedValue([])
  prismaMock.fieldHistory.createMany.mockResolvedValue({ count: 1 })
  prismaMock.record.count.mockResolvedValue(0)
  prismaMock.record.findFirst.mockResolvedValue(null)
  prismaMock.record.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.person.findFirst.mockResolvedValue(null)
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.company.findFirst.mockResolvedValue(null)
  prismaMock.company.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.deal.findFirst.mockResolvedValue(null)
  prismaMock.deal.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock))
  prismaMock.$queryRaw.mockResolvedValue([])
})

// ============================================================
// POST — bulk editField (MAI-451)
// ============================================================
describe('POST /api/orgs/:orgId/objects/:id/bulk — editField', () => {
  it('writes a record-backed field and its old/new FieldHistory row together', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow())
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([attributeRow()])
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'record-1', createdAt: NOW, updatedAt: NOW, valuesJson: { name: 'Before' }, __sortKey0: 'record-1' }])
      .mockResolvedValueOnce([{ count: '1' }])
    prismaMock.record.findFirst.mockResolvedValueOnce({
      id: 'record-1', orgId: ORG_A, objectId: 'obj-1', deletedAt: null, valuesJson: { name: 'Before' },
    })

    const res = await request(app)
      .post(`${URL_A}/obj-1/bulk`)
      .set('Authorization', AUTH)
      .send({ selection: { mode: 'ids', ids: ['record-1'] }, action: { type: 'editField', attribute: 'name', value: 'After' } })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ affectedCount: 1 })
    expect(prismaMock.record.updateMany).toHaveBeenCalledWith({
      where: { id: 'record-1', orgId: ORG_A, objectId: 'obj-1', deletedAt: null },
      data: { valuesJson: { name: 'After' } },
    })
    expect(prismaMock.fieldHistory.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        orgId: ORG_A,
        objectSlug: 'project',
        recordId: 'record-1',
        attribute: 'name',
        oldJson: 'Before',
        newJson: 'After',
        changedByUserId: 'user-a',
      })],
    })
  })

  it('writes a table-backed field through updateMany and records its old/new history', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow({ id: 'obj-person', slug: 'person', storage: 'table' }))
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([attributeRow({ objectId: 'obj-person', slug: 'title', name: 'Title', storage: 'column' })])
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'person-1', createdAt: NOW, updatedAt: NOW, title: 'Before', customJson: {}, __sortKey0: 'person-1' }])
      .mockResolvedValueOnce([{ count: '1' }])

    const res = await request(app)
      .post(`${URL_A}/obj-person/bulk`)
      .set('Authorization', AUTH)
      .send({ selection: { mode: 'ids', ids: ['person-1'] }, action: { type: 'editField', attribute: 'title', value: 'After' } })

    expect(res.status).toBe(200)
    expect(prismaMock.person.updateMany).toHaveBeenCalledWith({
      where: { id: 'person-1', orgId: ORG_A, deletedAt: null },
      data: { title: 'After' },
    })
    expect(prismaMock.fieldHistory.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ attribute: 'title', oldJson: 'Before', newJson: 'After' })],
    })
  })

  it.each([
    ['missing', attributeRow({ slug: 'other' }), 'Unknown field'],
    ['read-only', attributeRow({ isReadOnly: true }), 'read-only'],
    ['list-backed', attributeRow({ storage: 'list' }), 'list'],
    ['wrong type', attributeRow({ type: 'number' }), 'must be a number'],
  ])('422s a %s field edit before selecting or writing rows', async (_case, attribute, error) => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow())
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([attribute])

    const res = await request(app)
      .post(`${URL_A}/obj-1/bulk`)
      .set('Authorization', AUTH)
      .send({ selection: { mode: 'ids', ids: ['record-1'] }, action: { type: 'editField', attribute: 'name', value: 'not-a-number' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain(error)
    expect(prismaMock.record.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('404s an explicit selected id outside the organization before any write', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow())
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([attributeRow()])
    prismaMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }])

    const res = await request(app)
      .post(`${URL_A}/obj-1/bulk`)
      .set('Authorization', AUTH)
      .send({ selection: { mode: 'ids', ids: ['record-in-other-org'] }, action: { type: 'editField', attribute: 'name', value: 'After' } })

    expect(res.status).toBe(404)
    expect(prismaMock.record.updateMany).not.toHaveBeenCalled()
  })

  it('rejects edits above the inline 200-row ceiling before writing', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow())
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([attributeRow()])
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'record-1', createdAt: NOW, updatedAt: NOW, valuesJson: {}, __sortKey0: 'record-1' }])
      .mockResolvedValueOnce([{ count: '201' }])

    const res = await request(app)
      .post(`${URL_A}/obj-1/bulk`)
      .set('Authorization', AUTH)
      .send({ selection: { mode: 'ids', ids: ['record-1'] }, action: { type: 'editField', attribute: 'name', value: 'After' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('more than 200')
    expect(prismaMock.record.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — create a custom object
// ============================================================
describe('POST /api/orgs/:orgId/objects', () => {
  it('creates a custom object, forcing storage=record and isStandard=false', async () => {
    prismaMock.objectDef.create.mockResolvedValue(objectRow({ id: 'obj-2', slug: 'invoice' }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      // A caller trying to sneak a table-backed standard object must not win.
      .send({ slug: 'invoice', name: 'Invoice', namePlural: 'Invoices', storage: 'table', isStandard: true })

    expect(res.status).toBe(201)
    const data = prismaMock.objectDef.create.mock.calls[0][0].data
    expect(data.storage).toBe('record')
    expect(data.isStandard).toBe(false)
    expect(data.orgId).toBe(ORG_A)
  })

  it('stores the custom-object timeline opt-in explicitly, defaulting it off', async () => {
    await request(app).post(URL_A).set('Authorization', AUTH).send({ slug: 'invoice', name: 'Invoice', namePlural: 'Invoices' })
    expect(prismaMock.objectDef.create.mock.calls[0][0].data.timelineEventsEnabled).toBe(false)

    prismaMock.objectDef.findFirst
      .mockResolvedValueOnce(objectRow())
      .mockResolvedValueOnce(objectRow({ timelineEventsEnabled: true }))
    const res = await request(app).patch(`${URL_A}/obj-1`).set('Authorization', AUTH).send({ timelineEventsEnabled: true })
    expect(res.status).toBe(200)
    expect(prismaMock.objectDef.updateMany.mock.calls[0][0].data.timelineEventsEnabled).toBe(true)
    expect(res.body.object.timelineEventsEnabled).toBe(true)
  })

  it('writes the org from the path, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ slug: 'project', name: 'Project', namePlural: 'Projects', orgId: ORG_B, id: 'attacker' })

    const data = prismaMock.objectDef.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    expect(data.id).toBeUndefined()
  })

  it('422s a create with no slug', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Project', namePlural: 'Projects' })

    expect(res.status).toBe(422)
    expect(prismaMock.objectDef.create).not.toHaveBeenCalled()
  })

  it('422s a create missing a name or plural name', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ slug: 'project', name: 'Project' })

    expect(res.status).toBe(422)
    expect(prismaMock.objectDef.create).not.toHaveBeenCalled()
  })

  it('400s a slug that is not lowercase snake', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ slug: 'Not A Slug', name: 'X', namePlural: 'Xs' })

    expect(res.status).toBe(400)
    expect(prismaMock.objectDef.create).not.toHaveBeenCalled()
  })

  it('409s a duplicate slug in the same org (the @@unique key)', async () => {
    prismaMock.objectDef.create.mockRejectedValue({ code: 'P2002' })

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ slug: 'project', name: 'Project', namePlural: 'Projects' })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already exists')
    expect(Object.keys(res.body)).toEqual(['error'])
  })
})

// ============================================================
// POST — org isolation
// ============================================================
describe('POST /api/orgs/:orgId/objects — org isolation', () => {
  it('401s without auth, and writes nothing', async () => {
    const res = await request(app).post(URL_A).send({ slug: 'x', name: 'X', namePlural: 'Xs' })

    expect(res.status).toBe(401)
    expect(prismaMock.objectDef.create).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/objects`)
      .set('Authorization', AUTH)
      .send({ slug: 'x', name: 'X', namePlural: 'Xs' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.objectDef.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list and read
// ============================================================
describe('GET /api/orgs/:orgId/objects', () => {
  it('returns the org’s objects, trash excluded', async () => {
    prismaMock.objectDef.findMany.mockResolvedValue([objectRow({ id: 'o1' }), objectRow({ id: 'o2' })])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.objects.map((o: { id: string }) => o.id)).toEqual(['o1', 'o2'])
    expect(prismaMock.objectDef.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
    })
  })

  it('reports server-owned list and grid-create capabilities', async () => {
    prismaMock.objectDef.findMany.mockResolvedValue([
      objectRow({ id: 'person', slug: 'person', storage: 'table' }),
      objectRow({ id: 'company', slug: 'company', storage: 'table' }),
      objectRow({ id: 'deal', slug: 'deal', storage: 'table' }),
      objectRow({ id: 'call', slug: 'call', storage: 'table' }),
      objectRow({ id: 'email', slug: 'email', storage: 'table' }),
      objectRow({ id: 'sms', slug: 'sms', storage: 'table' }),
      objectRow({ id: 'meeting', slug: 'meeting', storage: 'table' }),
      objectRow({ id: 'task', slug: 'task', storage: 'table' }),
      objectRow({ id: 'note', slug: 'note', storage: 'table' }),
      objectRow({ id: 'project', slug: 'project', storage: 'record' }),
    ])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.objects.map((object: { slug: string; capabilities: { list: boolean }; isGridCreateSupported: boolean }) => ({
      slug: object.slug,
      list: object.capabilities.list,
      isGridCreateSupported: object.isGridCreateSupported,
    }))).toEqual([
      { slug: 'person', list: true, isGridCreateSupported: true },
      { slug: 'company', list: true, isGridCreateSupported: true },
      { slug: 'deal', list: true, isGridCreateSupported: false },
      { slug: 'call', list: true, isGridCreateSupported: false },
      { slug: 'email', list: false, isGridCreateSupported: false },
      { slug: 'sms', list: false, isGridCreateSupported: false },
      { slug: 'meeting', list: false, isGridCreateSupported: false },
      { slug: 'task', list: false, isGridCreateSupported: false },
      { slug: 'note', list: false, isGridCreateSupported: false },
      { slug: 'project', list: true, isGridCreateSupported: true },
    ])
  })

  it('reads one object with its attributes, by id AND orgId', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(
      objectRow({ id: 'obj-9', attributes: [] }),
    )

    const res = await request(app).get(`${URL_A}/obj-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.object.id).toBe('obj-9')
    expect(res.body.object.attributes).toEqual([])
    expect(res.body.object.orgId).toBeUndefined()
    expect(prismaMock.objectDef.findFirst.mock.calls[0][0].where).toEqual({
      id: 'obj-9',
      orgId: ORG_A,
      deletedAt: null,
    })
  })

  it('404s an object in another org — never a 403', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/obj-in-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Object not found')
  })
})

// ============================================================
// GET — delete impact
// ============================================================
describe('GET /api/orgs/:orgId/objects/:id/impact', () => {
  it('returns active record and inbound-reference counts without conflating like-named fields', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow({ id: 'obj-client', slug: 'client' }))
    prismaMock.record.count.mockResolvedValueOnce(2)
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([
      { id: 'attr-project-client', objectId: 'obj-project', slug: 'client', name: 'Client', object: { name: 'Project' } },
      { id: 'attr-task-client', objectId: 'obj-task', slug: 'client', name: 'Client', object: { name: 'Task' } },
    ])
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { objectId: 'obj-project', attribute: 'client', count: 1 },
      { objectId: 'obj-task', attribute: 'client', count: 1 },
    ])

    const res = await request(app).get(`${URL_A}/obj-client/impact`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      recordCount: 2,
      references: [
        { objectName: 'Project', fieldName: 'Client', count: 1 },
        { objectName: 'Task', fieldName: 'Client', count: 1 },
      ],
    })
    expect(prismaMock.record.count).toHaveBeenCalledWith({
      where: { orgId: ORG_A, objectId: 'obj-client', deletedAt: null },
    })
  })

  it('returns zero counts for an empty object and 404s an object in another org', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow())
    const empty = await request(app).get(`${URL_A}/obj-1/impact`).set('Authorization', AUTH)
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual({ recordCount: 0, references: [] })

    prismaMock.objectDef.findFirst.mockResolvedValueOnce(null)
    const foreign = await request(app).get(`${URL_A}/obj-in-b/impact`).set('Authorization', AUTH)
    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual({ error: 'Object not found' })
  })
})

// ============================================================
// GET — change-highlight data
// ============================================================
describe('GET /api/orgs/:orgId/objects/:id/field-changes', () => {
  it('returns counts and the latest transition only for the object’s live fields', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow({ id: 'obj-person', slug: 'person' }))
    prismaMock.attributeDef.findMany.mockResolvedValueOnce([{ id: 'attr-title', slug: 'title' }])
    prismaMock.fieldHistory.findMany.mockResolvedValueOnce([
      {
        id: 'history-3', recordId: 'person-1', attribute: 'title', oldJson: 'AE', newJson: 'Director',
        changedAt: new Date('2026-08-21T11:00:00.000Z'),
      },
      {
        id: 'history-2', recordId: 'person-1', attribute: 'title', oldJson: 'SDR', newJson: 'AE',
        changedAt: new Date('2026-08-20T11:00:00.000Z'),
      },
      {
        id: 'history-1', recordId: 'person-1', attribute: 'title', oldJson: 'BDR', newJson: 'SDR',
        changedAt: new Date('2026-08-19T11:00:00.000Z'),
      },
    ])

    const res = await request(app)
      .get(`${URL_A}/obj-person/field-changes?days=7`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.changes).toEqual([
      {
        recordId: 'person-1', attributeId: 'attr-title', changeCount: 3,
        previousValue: 'AE', currentValue: 'Director', changedAt: '2026-08-21T11:00:00.000Z',
      },
    ])
    expect(prismaMock.attributeDef.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_A, objectId: 'obj-person', isArchived: false, deletedAt: null },
      select: { id: true, slug: true },
    })
    expect(prismaMock.fieldHistory.findMany.mock.calls[0][0].where.attribute).toEqual({ in: ['title'] })
  })

  it('rejects invalid windows and a foreign object before reading history', async () => {
    const invalid = await request(app).get(`${URL_A}/obj-1/field-changes?days=0`).set('Authorization', AUTH)
    expect(invalid.status).toBe(400)
    expect(prismaMock.objectDef.findFirst).not.toHaveBeenCalled()

    prismaMock.objectDef.findFirst.mockResolvedValueOnce(null)
    const foreign = await request(app).get(`${URL_A}/obj-other/field-changes?days=7`).set('Authorization', AUTH)
    expect(foreign.status).toBe(404)
    expect(prismaMock.fieldHistory.findMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// PATCH — the standard-object archive guard (spec §10.2)
// ============================================================
describe('PATCH /api/orgs/:orgId/objects/:id', () => {
  it('updates via an org-scoped updateMany, never update-by-id', async () => {
    prismaMock.objectDef.findFirst
      .mockResolvedValueOnce(objectRow({ id: 'obj-1' })) // load current
      .mockResolvedValueOnce(objectRow({ id: 'obj-1', name: 'Renamed' })) // re-read

    const res = await request(app)
      .patch(`${URL_A}/obj-1`)
      .set('Authorization', AUTH)
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    expect(prismaMock.objectDef.update).not.toHaveBeenCalled()
    const call = prismaMock.objectDef.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'obj-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.name).toBe('Renamed')
  })

  it('422s archiving a standard object — it may only be hidden', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(
      objectRow({ id: 'person', slug: 'person', isStandard: true }),
    )

    const res = await request(app)
      .patch(`${URL_A}/person`)
      .set('Authorization', AUTH)
      .send({ isArchived: true })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('cannot be archived')
    expect(prismaMock.objectDef.updateMany).not.toHaveBeenCalled()
  })

  it('allows HIDING a standard object', async () => {
    prismaMock.objectDef.findFirst
      .mockResolvedValueOnce(objectRow({ id: 'person', slug: 'person', isStandard: true }))
      .mockResolvedValueOnce(objectRow({ id: 'person', slug: 'person', isStandard: true, isHidden: true }))

    const res = await request(app)
      .patch(`${URL_A}/person`)
      .set('Authorization', AUTH)
      .send({ isHidden: true })

    expect(res.status).toBe(200)
    expect(prismaMock.objectDef.updateMany.mock.calls[0][0].data.isHidden).toBe(true)
  })

  it('allows ARCHIVING a custom object', async () => {
    prismaMock.objectDef.findFirst
      .mockResolvedValueOnce(objectRow({ id: 'obj-1', isStandard: false }))
      .mockResolvedValueOnce(objectRow({ id: 'obj-1', isArchived: true }))

    const res = await request(app)
      .patch(`${URL_A}/obj-1`)
      .set('Authorization', AUTH)
      .send({ isArchived: true })

    expect(res.status).toBe(200)
    expect(prismaMock.objectDef.updateMany.mock.calls[0][0].data.isArchived).toBe(true)
  })

  it('404s an update to an object in another org', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(`${URL_A}/obj-in-b`)
      .set('Authorization', AUTH)
      .send({ name: 'x' })

    expect(res.status).toBe(404)
    expect(prismaMock.objectDef.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE — the standard-object delete guard (spec §10.2)
// ============================================================
describe('DELETE /api/orgs/:orgId/objects/:id', () => {
  it('422s deleting a standard object — it may only be hidden', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(
      objectRow({ id: 'person', slug: 'person', isStandard: true }),
    )

    const res = await request(app).delete(`${URL_A}/person`).set('Authorization', AUTH)

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('cannot be deleted')
    expect(prismaMock.objectDef.updateMany).not.toHaveBeenCalled()
  })

  it('soft-deletes a custom object via updateMany and answers 204', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(objectRow({ id: 'obj-1', isStandard: false }))
    prismaMock.objectDef.updateMany.mockResolvedValue({ count: 1 })

    const res = await request(app).delete(`${URL_A}/obj-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.objectDef.delete).not.toHaveBeenCalled()
    const call = prismaMock.objectDef.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'obj-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
  })

  it('404s deleting an object that is already trashed or in another org', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(null)

    const res = await request(app).delete(`${URL_A}/gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Object not found')
  })
})

// ============================================================
// GET — related peek rails (MAI-184)
// ============================================================
describe('GET /api/orgs/:orgId/objects/:id/records/:recordId/related', () => {
  it('returns correctly shaped inbound People and Deals rails for a Company', async () => {
    const companyAttributes = [attributeRow({ objectId: 'obj-company', slug: 'name', name: 'Name', storage: 'column' })]
    const personAttributes = [
      attributeRow({ objectId: 'obj-person', slug: 'firstName', name: 'First name', storage: 'column', isIdentity: true }),
      attributeRow({ objectId: 'obj-person', slug: 'companyId', name: 'Company', storage: 'column', type: 'record_reference', refObjectId: 'obj-company' }),
    ]
    const dealAttributes = [
      attributeRow({ objectId: 'obj-deal', slug: 'name', name: 'Name', storage: 'column', isIdentity: true }),
      attributeRow({ objectId: 'obj-deal', slug: 'companyId', name: 'Company', storage: 'column', type: 'record_reference', refObjectId: 'obj-company' }),
    ]
    const company = objectRow({ id: 'obj-company', slug: 'company', name: 'Company', namePlural: 'Companies', storage: 'table', isStandard: true, attributes: companyAttributes })
    const person = objectRow({ id: 'obj-person', slug: 'person', name: 'Person', namePlural: 'People', storage: 'table', isStandard: true, attributes: personAttributes })
    const deal = objectRow({ id: 'obj-deal', slug: 'deal', name: 'Deal', namePlural: 'Deals', storage: 'table', isStandard: true, attributes: dealAttributes })
    prismaMock.objectDef.findFirst.mockResolvedValueOnce(company)
    prismaMock.objectDef.findMany.mockResolvedValueOnce([company, person, deal])
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: 'company-1', createdAt: NOW, updatedAt: NOW, name: 'Acme', customJson: {}, __sortKey0: NOW }])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ id: 'person-1' }])
      .mockResolvedValueOnce([{ id: 'deal-1' }])
      .mockResolvedValueOnce([{ id: 'person-1', createdAt: NOW, updatedAt: NOW, firstName: 'Dana', customJson: {}, __sortKey0: NOW }])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ id: 'deal-1', createdAt: NOW, updatedAt: NOW, name: 'Expansion', customJson: {}, __sortKey0: NOW }])
      .mockResolvedValueOnce([{ count: '1' }])

    const res = await request(app)
      .get(`${URL_A}/obj-company/records/company-1/related`)
      .set('Authorization', AUTH)

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.related).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'People', count: 1, object: expect.objectContaining({ slug: 'person' }), records: [expect.objectContaining({ id: 'person-1', firstName: 'Dana' })] }),
      expect.objectContaining({ label: 'Deals', count: 1, object: expect.objectContaining({ slug: 'deal' }), records: [expect.objectContaining({ id: 'deal-1', name: 'Expansion' })] }),
    ]))
  })
})
