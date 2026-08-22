// Route tests for /api/orgs/:orgId/lists (MAI-142, T14).
//
// The unit suite mocks Prisma, so it proves the route WIRING: a list holds
// exactly ONE object type (verified against an ObjectDef at create, and never
// patchable), an entry's objectSlug is COPIED FROM THE LIST and never accepted
// from the request, adding the same record twice is idempotent, and entry
// values are validated against list-scoped (storage="list") AttributeDef rows
// only. Real row state and the unique-constraint race are proven by
// lists.integration.test.ts.
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
    attributeDef: { findMany: vi.fn() },
    record: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    list: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    listEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
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
const URL_A = `/api/orgs/${ORG_A}/lists`

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
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'list-1', orgId: ORG_A, name: 'Q3 outbound blitz', slug: 'q3-outbound-blitz',
    objectSlug: 'person', description: null, icon: null, ownerUserId: null,
    isArchived: false, deletedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  }
}
function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1', orgId: ORG_A, listId: 'list-1', objectSlug: 'person', targetId: 'person-1',
    valuesJson: {}, position: null, addedByUserId: 'user-a',
    createdAt: NOW, updatedAt: NOW, ...overrides,
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
  prismaMock.objectDef.findFirst.mockResolvedValue({ id: 'obj-person', slug: 'person', storage: 'table' })
  prismaMock.attributeDef.findMany.mockResolvedValue([])
  prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1' })
  prismaMock.company.findFirst.mockResolvedValue({ id: 'co-1' })
  prismaMock.deal.findFirst.mockResolvedValue({ id: 'deal-1' })
  prismaMock.record.findFirst.mockResolvedValue(null)

  prismaMock.list.findFirst.mockResolvedValue(listRow())
  prismaMock.list.findMany.mockResolvedValue([listRow()])
  prismaMock.list.count.mockResolvedValue(1)
  prismaMock.list.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => listRow({ id: 'list-new', ...args.data }),
  )
  prismaMock.list.updateMany.mockResolvedValue({ count: 1 })

  prismaMock.listEntry.findFirst.mockResolvedValue(null)
  prismaMock.listEntry.findMany.mockResolvedValue([entryRow()])
  prismaMock.listEntry.count.mockResolvedValue(1)
  prismaMock.listEntry.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => entryRow({ id: 'entry-new', ...args.data }),
  )
  prismaMock.listEntry.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.listEntry.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.$queryRaw
    .mockResolvedValueOnce([{ id: 'person-1', createdAt: NOW, updatedAt: NOW, firstName: 'Ada', customJson: {} }])
    .mockResolvedValueOnce([{ count: '1' }])
})

// ============================================================
// POST /api/orgs/:orgId/lists — the "one object type per list" criterion
// ============================================================
describe('POST /api/orgs/:orgId/lists', () => {
  it('verifies objectSlug against an ObjectDef in this org before creating', async () => {
    prismaMock.list.findFirst.mockResolvedValue(null) // no slug clash
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Q3 outbound blitz', objectSlug: 'person' })

    expect(res.status).toBe(201)
    expect(prismaMock.objectDef.findFirst.mock.calls[0][0].where).toMatchObject({
      orgId: ORG_A, slug: 'person', deletedAt: null,
    })
    expect(prismaMock.list.create.mock.calls[0][0].data.objectSlug).toBe('person')
  })

  it('422s an objectSlug this org has never defined, writing nothing', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Ghost list', objectSlug: 'ufo' })

    expect(res.status).toBe(422)
    expect(prismaMock.list.create).not.toHaveBeenCalled()
  })

  it('derives the slug from the name when the caller omits it', async () => {
    prismaMock.list.findFirst.mockResolvedValueOnce(null) // slug clash check: no clash

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Q3 Outbound Blitz!', objectSlug: 'person' })

    expect(res.status).toBe(201)
    expect(prismaMock.list.create.mock.calls[0][0].data.slug).toBe('q3-outbound-blitz')
  })

  it('de-duplicates a derived slug against an existing one in the org', async () => {
    prismaMock.list.findFirst
      .mockResolvedValueOnce({ id: 'other-list' }) // "q3-outbound-blitz" taken
      .mockResolvedValueOnce(null) // "q3-outbound-blitz-2" free

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Q3 Outbound Blitz', objectSlug: 'person' })

    expect(res.status).toBe(201)
    expect(prismaMock.list.create.mock.calls[0][0].data.slug).toBe('q3-outbound-blitz-2')
  })

  it('rejects a malformed explicit slug', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Blitz', objectSlug: 'person', slug: 'Not A Slug!' })
    expect(res.status).toBe(400)
    expect(prismaMock.list.create).not.toHaveBeenCalled()
  })

  it('409s a slug clash the database catches', async () => {
    prismaMock.list.create.mockRejectedValue({ code: 'P2002' })

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Blitz', objectSlug: 'person', slug: 'q3-outbound-blitz' })

    expect(res.status).toBe(409)
  })

  it('422s an owner who is not a member of this org', async () => {
    prismaMock.membership.findFirst
      .mockResolvedValueOnce(membershipRow()) // requireMembership
      .mockResolvedValueOnce(null) // ownerIsMember

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Blitz', objectSlug: 'person', ownerUserId: 'outsider' })

    expect(res.status).toBe(422)
    expect(prismaMock.list.create).not.toHaveBeenCalled()
  })

  it('takes orgId from the path, not the body', async () => {
    prismaMock.list.findFirst.mockResolvedValue(null) // no slug clash
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Blitz', objectSlug: 'person', orgId: 'org-b' })

    expect(prismaMock.list.create.mock.calls[0][0].data.orgId).toBe(ORG_A)
  })

  it('404s a caller with no membership in the org', async () => {
    authAs(null)
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Blitz', objectSlug: 'person' })
    expect(res.status).toBe(404)
    expect(prismaMock.list.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list filters
// ============================================================
describe('GET /api/orgs/:orgId/lists', () => {
  it('scopes every read to the org in the path, hides the trash, and excludes archived by default', async () => {
    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    const where = prismaMock.list.findMany.mock.calls[0][0].where
    expect(where.orgId).toBe(ORG_A)
    expect(where.deletedAt).toBeNull()
    expect(where.isArchived).toBe(false)
    expect(prismaMock.list.count.mock.calls[0][0].where).toEqual(where)
  })

  it('filters by objectSlug and can ask for the archived lists', async () => {
    await request(app).get(`${URL_A}?objectSlug=company&isArchived=true`).set('Authorization', AUTH)
    const where = prismaMock.list.findMany.mock.calls[0][0].where
    expect(where.objectSlug).toBe('company')
    expect(where.isArchived).toBe(true)
  })

  it('400s an over-large page and an unknown sort', async () => {
    await request(app).get(`${URL_A}?limit=5000`).set('Authorization', AUTH).expect(400)
    await request(app).get(`${URL_A}?sort=objectSlug`).set('Authorization', AUTH).expect(400)
  })
})

describe('GET /api/orgs/:orgId/lists/:id', () => {
  it('looks up by id AND orgId', async () => {
    const res = await request(app).get(`${URL_A}/list-1`).set('Authorization', AUTH)
    expect(res.status).toBe(200)
    expect(prismaMock.list.findFirst.mock.calls[0][0].where).toEqual({
      id: 'list-1', orgId: ORG_A, deletedAt: null,
    })
    expect(res.body.list.objectSlug).toBe('person')
  })

  it('404s a list in another org', async () => {
    prismaMock.list.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/list-1`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})

// ============================================================
// PATCH — slug and objectSlug are never patchable
// ============================================================
describe('PATCH /api/orgs/:orgId/lists/:id', () => {
  it('renames and archives, but ignores an attempt to change slug or objectSlug', async () => {
    const res = await request(app)
      .patch(`${URL_A}/list-1`)
      .set('Authorization', AUTH)
      .send({ name: 'Renamed blitz', isArchived: true, slug: 'hacked-slug', objectSlug: 'company' })

    expect(res.status).toBe(200)
    const data = prismaMock.list.updateMany.mock.calls[0][0].data
    expect(data.name).toBe('Renamed blitz')
    expect(data.isArchived).toBe(true)
    expect(data.slug).toBeUndefined()
    expect(data.objectSlug).toBeUndefined()
  })

  it('clears description and icon on explicit null, and leaves them alone when absent', async () => {
    await request(app).patch(`${URL_A}/list-1`).set('Authorization', AUTH).send({ description: null })
    expect(prismaMock.list.updateMany.mock.calls[0][0].data).toEqual({ description: null })
  })

  it('updateMany carries id AND orgId, never id alone', async () => {
    await request(app).patch(`${URL_A}/list-1`).set('Authorization', AUTH).send({ name: 'x' })
    const where = prismaMock.list.updateMany.mock.calls[0][0].where
    expect(where).toEqual({ id: 'list-1', orgId: ORG_A, deletedAt: null })
  })

  it('404s when the row vanished mid-update', async () => {
    prismaMock.list.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app).patch(`${URL_A}/list-1`).set('Authorization', AUTH).send({ name: 'x' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/orgs/:orgId/lists/:id', () => {
  it('soft-deletes: sets deletedAt, does not touch entries', async () => {
    const res = await request(app).delete(`${URL_A}/list-1`).set('Authorization', AUTH)
    expect(res.status).toBe(204)
    const call = prismaMock.list.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'list-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
    expect(prismaMock.listEntry.deleteMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST /entries — the other two acceptance criteria
// ============================================================
describe('POST /api/orgs/:orgId/lists/:id/entries', () => {
  it("copies objectSlug from the LIST, ignoring anything the request sends", async () => {
    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'person-1', objectSlug: 'company' })

    expect(res.status).toBe(201)
    expect(prismaMock.listEntry.create.mock.calls[0][0].data.objectSlug).toBe('person')
  })

  it('is idempotent: adding the same target twice returns the EXISTING entry, not a new one', async () => {
    prismaMock.listEntry.findFirst.mockResolvedValue(entryRow({ id: 'entry-existing' }))

    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'person-1' })

    expect(res.status).toBe(200)
    expect(res.body.entry.id).toBe('entry-existing')
    expect(prismaMock.listEntry.create).not.toHaveBeenCalled()
  })

  it('422s a target that does not exist in this org, writing nothing', async () => {
    prismaMock.person.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'ghost-person' })

    expect(res.status).toBe(422)
    expect(prismaMock.listEntry.create).not.toHaveBeenCalled()
  })

  it("validates valuesJson against the object's LIST-scoped attributes only", async () => {
    prismaMock.attributeDef.findMany.mockResolvedValue([
      {
        id: 'attr-1', slug: 'stage', name: 'Stage', type: 'select', storage: 'list',
        isRequired: false, isUnique: false, isMulti: false, isReadOnly: false,
        optionsJson: [{ value: 'contacted', label: 'Contacted', color: 'blue', order: 0, isArchived: false }],
      },
    ])

    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'person-1', valuesJson: { stage: 'contacted' } })

    expect(res.status).toBe(201)
    expect(prismaMock.attributeDef.findMany.mock.calls[0][0].where).toMatchObject({ storage: 'list' })
    expect(prismaMock.listEntry.create.mock.calls[0][0].data.valuesJson).toEqual({ stage: 'contacted' })
  })

  it('422s a value that fails validation, writing no record and no entry', async () => {
    prismaMock.attributeDef.findMany.mockResolvedValue([
      {
        id: 'attr-1', slug: 'stage', name: 'Stage', type: 'select', storage: 'list',
        isRequired: false, isUnique: false, isMulti: false, isReadOnly: false,
        optionsJson: [{ value: 'contacted', label: 'Contacted', color: 'blue', order: 0, isArchived: false }],
      },
    ])

    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'person-1', valuesJson: { stage: 'not-an-option' } })

    expect(res.status).toBe(422)
    expect(prismaMock.listEntry.create).not.toHaveBeenCalled()
  })

  it('404s when the list is trashed or in another org', async () => {
    prismaMock.list.findFirst.mockResolvedValue(null)
    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'person-1' })
    expect(res.status).toBe(404)
    expect(prismaMock.listEntry.create).not.toHaveBeenCalled()
  })

  it('recovers from a create-time unique race by returning the row that won it', async () => {
    prismaMock.listEntry.create.mockRejectedValue({ code: 'P2002' })
    prismaMock.listEntry.findFirst
      .mockResolvedValueOnce(null) // the idempotent pre-check: nothing yet
      .mockResolvedValueOnce(entryRow({ id: 'entry-won-the-race' })) // read-back after the race

    const res = await request(app)
      .post(`${URL_A}/list-1/entries`)
      .set('Authorization', AUTH)
      .send({ targetId: 'person-1' })

    expect(res.status).toBe(200)
    expect(res.body.entry.id).toBe('entry-won-the-race')
  })
})

describe('GET /api/orgs/:orgId/lists/:id/entries', () => {
  it('orders by position, nulls last, and scopes to the list', async () => {
    const res = await request(app).get(`${URL_A}/list-1/entries`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(prismaMock.listEntry.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_A, listId: 'list-1' })
    expect(prismaMock.listEntry.findMany.mock.calls[0][0].orderBy[0]).toEqual({
      position: { sort: 'asc', nulls: 'last' },
    })
    expect(res.body.entries[0].values).toEqual({})
  })

  it('returns each entry’s target record and list-only values without writing the record', async () => {
    prismaMock.attributeDef.findMany.mockResolvedValue([
      { id: 'first-name', slug: 'firstName', name: 'First name', type: 'text', storage: 'column', isMulti: false },
      { id: 'stage', slug: 'stage', name: 'Stage', type: 'text', storage: 'list', isMulti: false },
    ])
    prismaMock.listEntry.findMany.mockResolvedValue([
      entryRow({ valuesJson: { stage: 'contacted' }, position: 4 }),
    ])

    const res = await request(app).get(`${URL_A}/list-1/entries`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.entries).toEqual([
      expect.objectContaining({
        targetId: 'person-1',
        position: 4,
        values: { stage: 'contacted' },
        target: expect.objectContaining({ id: 'person-1', firstName: 'Ada' }),
      }),
    ])
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('404s when the list is trashed or in another org', async () => {
    prismaMock.list.findFirst.mockResolvedValue(null)
    const res = await request(app).get(`${URL_A}/list-1/entries`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/orgs/:orgId/lists/:id/entries/:entryId', () => {
  it('merges new values over the current ones through the same one validator', async () => {
    prismaMock.listEntry.findFirst.mockResolvedValue(
      entryRow({ valuesJson: { stage: 'contacted', attempts: 2 } }),
    )
    prismaMock.attributeDef.findMany.mockResolvedValue([
      { id: 'a1', slug: 'stage', name: 'Stage', type: 'text', storage: 'list' },
      { id: 'a2', slug: 'attempts', name: 'Attempts', type: 'number', storage: 'list' },
    ])

    const res = await request(app)
      .patch(`${URL_A}/list-1/entries/entry-1`)
      .set('Authorization', AUTH)
      .send({ valuesJson: { attempts: 3 } })

    expect(res.status).toBe(200)
    expect(prismaMock.listEntry.updateMany.mock.calls[0][0].data.valuesJson).toEqual({
      stage: 'contacted', attempts: 3,
    })
  })

  it('reorders via position without touching values', async () => {
    prismaMock.listEntry.findFirst.mockResolvedValue(entryRow())
    const res = await request(app)
      .patch(`${URL_A}/list-1/entries/entry-1`)
      .set('Authorization', AUTH)
      .send({ position: 5 })

    expect(res.status).toBe(200)
    expect(prismaMock.listEntry.updateMany.mock.calls[0][0].data).toEqual({ position: 5 })
  })

  it('404s an entry not on this list', async () => {
    prismaMock.listEntry.findFirst.mockResolvedValue(null)
    const res = await request(app)
      .patch(`${URL_A}/list-1/entries/ghost`)
      .set('Authorization', AUTH)
      .send({ position: 1 })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/orgs/:orgId/lists/:id/entries/:entryId', () => {
  it('removes the entry, scoped to list AND org', async () => {
    const res = await request(app).delete(`${URL_A}/list-1/entries/entry-1`).set('Authorization', AUTH)
    expect(res.status).toBe(204)
    expect(prismaMock.listEntry.deleteMany.mock.calls[0][0].where).toEqual({
      id: 'entry-1', listId: 'list-1', orgId: ORG_A,
    })
  })

  it('404s an entry that is already gone', async () => {
    prismaMock.listEntry.deleteMany.mockResolvedValue({ count: 0 })
    const res = await request(app).delete(`${URL_A}/list-1/entries/entry-1`).set('Authorization', AUTH)
    expect(res.status).toBe(404)
  })
})
