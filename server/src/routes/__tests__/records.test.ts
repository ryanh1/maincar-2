// Route tests for /api/orgs/:orgId/records (MAI-135, T7).
//
// The unit suite mocks Prisma and the GIN filter, so it proves the route WIRING:
// every valuesJson write goes through the one validator, the org comes from the
// path, a table-backed object is refused, a record_reference writes a RecordLink,
// and reads/writes are org-scoped. Real row state, real constraints, and the real
// GIN index are proven by records.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock, filterMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    objectDef: { findFirst: vi.fn(), findMany: vi.fn() },
    attributeDef: { findMany: vi.fn() },
    record: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    recordLink: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    activityEntry: { upsert: vi.fn() },
    // Field history (MAI-136): a values change writes its history rows inside the
    // same transaction as the update.
    fieldHistory: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  verifyTokenMock: vi.fn(),
  filterMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../crm/recordFilter.js', () => ({ filterRecordsByContainment: filterMock }))
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
const URL_A = `/api/orgs/${ORG_A}/records`

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
function objectRow(overrides: Record<string, unknown> = {}) {
  return { id: 'obj-project', slug: 'project', name: 'Project', storage: 'record', timelineEventsEnabled: false, ...overrides }
}
function attrRow(overrides: Record<string, unknown> & { slug: string; type: string }) {
  return {
    id: `attr-${overrides.slug}`, orgId: ORG_A, objectId: 'obj-project', name: overrides.slug,
    description: null, icon: null, optionsJson: null, refObjectId: null, formatJson: null,
    validationJson: null, isIdentity: false, storage: 'custom', isMulti: false, isRequired: false,
    isUnique: false, isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0,
    isArchived: false, deletedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}
function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1', orgId: ORG_A, objectId: 'obj-project', valuesJson: {}, isArchived: false,
    deletedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
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
  // The transaction runs its callback against the mock client itself.
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock))
  prismaMock.objectDef.findFirst.mockResolvedValue(objectRow())
  prismaMock.objectDef.findMany.mockResolvedValue([])
  prismaMock.attributeDef.findMany.mockResolvedValue([
    attrRow({ slug: 'title', type: 'text', isRequired: true }),
    attrRow({ slug: 'count', type: 'number' }),
  ])
  prismaMock.record.findFirst.mockResolvedValue(null)
  prismaMock.record.findMany.mockResolvedValue([recordRow()])
  prismaMock.record.create.mockResolvedValue(recordRow({ id: 'rec-new', valuesJson: { title: 'Acme' } }))
  prismaMock.record.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.recordLink.findMany.mockResolvedValue([])
  prismaMock.recordLink.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.recordLink.create.mockResolvedValue({})
  prismaMock.activityEntry.upsert.mockResolvedValue({ id: 'activity-1' })
  prismaMock.fieldHistory.createMany.mockResolvedValue({ count: 1 })
  filterMock.mockResolvedValue([])
})

// ============================================================
// POST — create, validation, and the org boundary
// ============================================================
describe('POST /api/orgs/:orgId/records', () => {
  it('creates a record, forcing orgId from the path and storing validated values', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', orgId: ORG_B, values: { title: '  Acme  ', count: 3 } })

    expect(res.status).toBe(201)
    const data = prismaMock.record.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    // Whitespace trimmed by the validator before it lands.
    expect(data.valuesJson).toEqual({ title: 'Acme', count: 3 })
  })

  it('projects creation only when the custom object has explicitly opted into timeline events', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(objectRow({ timelineEventsEnabled: true }))

    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { title: 'Acme' } })

    const activity = prismaMock.activityEntry.upsert.mock.calls[0][0].create
    expect(activity).toMatchObject({
      orgId: ORG_A, sourceType: 'custom', sourceId: 'rec-new',
      timelineSubtype: 'created', timelineIntensity: 1,
    })
  })

  it('does not project a custom record when its object has not opted in', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { title: 'Acme' } })

    expect(prismaMock.activityEntry.upsert).not.toHaveBeenCalled()
  })

  it('422s a create whose value has the wrong type (validator)', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { title: 'Acme', count: 'lots' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('must be a number')
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })

  it('422s a create missing a required field (validator)', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { count: 1 } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('required')
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })

  it('422s a create against a table-backed object — records is for custom objects only', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(objectRow({ slug: 'person', storage: 'table' }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-person', values: { title: 'x' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('table-backed')
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })

  it('422s a create for an object not in this org', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-x', values: { title: 'x' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('not found in this org')
  })

  it('422s a unique clash the injected GIN checker reports', async () => {
    prismaMock.attributeDef.findMany.mockResolvedValue([
      attrRow({ slug: 'sku', type: 'text', isUnique: true, isRequired: true }),
    ])
    // Another record already holds this value.
    filterMock.mockResolvedValue([{ id: 'other', valuesJson: { sku: 'A1' } }])

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { sku: 'A1' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('unique')
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })

  it('401s without auth and writes nothing', async () => {
    const res = await request(app).post(URL_A).send({ objectId: 'obj-project', values: {} })
    expect(res.status).toBe(401)
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)
    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/records`)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { title: 'x' } })

    expect(res.status).toBe(404)
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — record_reference writes a RecordLink (spec §5.4)
// ============================================================
describe('POST /api/orgs/:orgId/records — references', () => {
  beforeEach(() => {
    prismaMock.attributeDef.findMany.mockResolvedValue([
      attrRow({ slug: 'client', type: 'record_reference', refObjectId: 'obj-company' }),
    ])
    // resolveRefTargets: the referenced object is a record-backed custom object.
    prismaMock.objectDef.findMany.mockResolvedValue([
      { id: 'obj-company', slug: 'company_custom', storage: 'record' },
    ])
    // verifyReferenceTargets: the target record exists; create returns the new row.
    prismaMock.record.findFirst.mockResolvedValue(recordRow({ id: 'rec-target', objectId: 'obj-company' }))
    prismaMock.record.create.mockResolvedValue(recordRow({ id: 'rec-new', valuesJson: { client: 'rec-target' } }))
  })

  it('writes a RecordLink edge for the reference, inside the transaction', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { client: 'rec-target' } })

    expect(res.status).toBe(201)
    expect(prismaMock.recordLink.create).toHaveBeenCalledOnce()
    const link = prismaMock.recordLink.create.mock.calls[0][0].data
    expect(link).toMatchObject({
      orgId: ORG_A, fromObject: 'record', fromId: 'rec-new',
      attribute: 'client', toObject: 'company_custom', toId: 'rec-target',
    })
  })

  it('422s when the referenced record does not exist', async () => {
    prismaMock.record.findFirst.mockResolvedValue(null) // target missing

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-project', values: { client: 'ghost' } })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('does not exist')
    expect(prismaMock.record.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list, GIN filter, and single read
// ============================================================
describe('GET /api/orgs/:orgId/records', () => {
  it('400s a list with no objectId', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)
    expect(res.status).toBe(400)
  })

  it('lists records for an object, trash excluded, org-scoped', async () => {
    prismaMock.record.findMany.mockResolvedValue([recordRow({ id: 'r1' }), recordRow({ id: 'r2' })])
    const res = await request(app).get(`${URL_A}?objectId=obj-project`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.records.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2'])
    expect(prismaMock.record.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A, objectId: 'obj-project', deletedAt: null,
    })
    expect(filterMock).not.toHaveBeenCalled()
  })

  it('routes a ?match= filter through the GIN containment helper', async () => {
    filterMock.mockResolvedValue([recordRow({ id: 'hit', valuesJson: { status: 'active' } })])
    const res = await request(app)
      .get(`${URL_A}?objectId=obj-project&match=${encodeURIComponent('{"status":"active"}')}`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.records[0].id).toBe('hit')
    expect(filterMock).toHaveBeenCalledWith(prismaMock, {
      orgId: ORG_A, objectId: 'obj-project', match: { status: 'active' },
    })
    expect(prismaMock.record.findMany).not.toHaveBeenCalled()
  })

  it('400s a ?match= that is not valid JSON', async () => {
    const res = await request(app)
      .get(`${URL_A}?objectId=obj-project&match=not-json`)
      .set('Authorization', AUTH)
    expect(res.status).toBe(400)
  })

  it('reads one record with its resolved links, by id AND orgId', async () => {
    prismaMock.record.findFirst.mockResolvedValue(recordRow({ id: 'rec-9', valuesJson: { title: 'Acme' } }))
    prismaMock.recordLink.findMany.mockResolvedValue([
      { attribute: 'client', toObject: 'company_custom', toId: 'rec-target' },
    ])

    const res = await request(app).get(`${URL_A}/rec-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.record.values).toEqual({ title: 'Acme' })
    expect(res.body.record.links).toEqual([
      { attribute: 'client', toObject: 'company_custom', toId: 'rec-target' },
    ])
    expect(res.body.record.orgId).toBeUndefined()
    expect(prismaMock.record.findFirst.mock.calls[0][0].where).toEqual({
      id: 'rec-9', orgId: ORG_A, deletedAt: null,
    })
  })

  it('404s a record in another org — never a 403', async () => {
    prismaMock.record.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/rec-elsewhere`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})

// ============================================================
// PATCH / DELETE
// ============================================================
describe('PATCH /api/orgs/:orgId/records/:id', () => {
  it('merges values through the validator and writes via org-scoped updateMany', async () => {
    prismaMock.record.findFirst
      .mockResolvedValueOnce(recordRow({ id: 'rec-1', valuesJson: { title: 'Old', count: 1 } })) // load
      .mockResolvedValueOnce(recordRow({ id: 'rec-1', valuesJson: { title: 'New', count: 1 } })) // re-read

    const res = await request(app)
      .patch(`${URL_A}/rec-1`)
      .set('Authorization', AUTH)
      .send({ values: { title: 'New' } })

    expect(res.status).toBe(200)
    expect(prismaMock.record.update).not.toHaveBeenCalled()
    const call = prismaMock.record.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'rec-1', orgId: ORG_A, deletedAt: null })
    // count survives, title changes — the merge, not a replace.
    expect(call.data.valuesJson).toEqual({ title: 'New', count: 1 })
  })

  // --- Field history (MAI-136 T8, spec §5.7) ---
  it('writes a FieldHistory row per changed value, in the same transaction', async () => {
    prismaMock.record.findFirst
      .mockResolvedValueOnce(recordRow({ id: 'rec-1', valuesJson: { title: 'Old', count: 1 } }))
      .mockResolvedValueOnce(recordRow({ id: 'rec-1', valuesJson: { title: 'New', count: 1 } }))

    const res = await request(app)
      .patch(`${URL_A}/rec-1`)
      .set('Authorization', AUTH)
      .send({ values: { title: 'New' } })

    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalled()
    // Only `title` moved — `count` was merged unchanged and writes no history row.
    expect(prismaMock.fieldHistory.createMany.mock.calls[0][0].data).toEqual([
      {
        orgId: ORG_A,
        objectSlug: 'project',
        recordId: 'rec-1',
        attribute: 'title',
        oldJson: 'Old',
        newJson: 'New',
        changedByUserId: 'user-a',
        changeSource: 'user',
        reason: null,
      },
    ])
  })

  it('writes no history when only the archive flag changes', async () => {
    prismaMock.record.findFirst
      .mockResolvedValueOnce(recordRow({ id: 'rec-1', valuesJson: { title: 'Old' } }))
      .mockResolvedValueOnce(recordRow({ id: 'rec-1', valuesJson: { title: 'Old' }, isArchived: true }))

    const res = await request(app)
      .patch(`${URL_A}/rec-1`)
      .set('Authorization', AUTH)
      .send({ isArchived: true })

    expect(res.status).toBe(200)
    expect(prismaMock.fieldHistory.createMany).not.toHaveBeenCalled()
  })

  it('404s an update to a record in another org', async () => {
    prismaMock.record.findFirst.mockResolvedValue(null)
    const res = await request(app)
      .patch(`${URL_A}/rec-x`)
      .set('Authorization', AUTH)
      .send({ values: { title: 'x' } })
    expect(res.status).toBe(404)
    expect(prismaMock.record.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/records/:id', () => {
  it('soft-deletes via updateMany and answers 204', async () => {
    prismaMock.record.updateMany.mockResolvedValue({ count: 1 })
    const res = await request(app).delete(`${URL_A}/rec-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.record.delete).not.toHaveBeenCalled()
    const call = prismaMock.record.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'rec-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
  })

  it('404s deleting a record already trashed or in another org', async () => {
    prismaMock.record.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app).delete(`${URL_A}/gone`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})
