// Route tests for /api/orgs/:orgId/attributes (MAI-133, T5).
//
// The heart of this suite is the acceptance criteria: creating a custom field is a
// ROW INSERT (no migration), and the isSystem guards (spec §10.2) — a system field
// rejects delete and retype but allows rename/hide. Plus org isolation and the
// "a runtime field can never be a real column" rule (§5.1).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    objectDef: { findFirst: vi.fn() },
    attributeDef: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      // Present only so a test can prove nothing ever calls them.
      update: vi.fn(),
      delete: vi.fn(),
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
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/attributes`

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

function attributeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attr-1',
    orgId: ORG_A,
    objectId: 'obj-person',
    slug: 'renewal_month',
    name: 'Renewal month',
    description: null,
    icon: null,
    type: 'text',
    optionsJson: null,
    refObjectId: null,
    formatJson: null,
    validationJson: null,
    isIdentity: false,
    storage: 'custom',
    isMulti: false,
    isRequired: false,
    isUnique: false,
    isReadOnly: false,
    isSystem: false,
    defaultJson: null,
    sortOrder: 0,
    isArchived: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
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
  vi.clearAllMocks()
  authAs()
  // By default the target object exists in this org.
  prismaMock.objectDef.findFirst.mockResolvedValue({ id: 'obj-person' })
  prismaMock.attributeDef.findFirst.mockResolvedValue(null)
  prismaMock.attributeDef.findMany.mockResolvedValue([attributeRow()])
  prismaMock.attributeDef.create.mockResolvedValue(attributeRow())
  prismaMock.attributeDef.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.$queryRaw.mockResolvedValue([{ valueCount: 0 }])
})

// ============================================================
// POST — creating a custom field is a row insert (acceptance criterion)
// ============================================================
describe('POST /api/orgs/:orgId/attributes', () => {
  it('inserts a custom field with storage=custom and isSystem forced false', async () => {
    prismaMock.attributeDef.create.mockResolvedValue(
      attributeRow({ id: 'attr-2', slug: 'renewal_month', type: 'select' }),
    )

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      // A caller trying to sneak a system/column field must not win.
      .send({
        objectId: 'obj-person',
        slug: 'renewal_month',
        name: 'Renewal month',
        type: 'select',
        isSystem: true,
      })

    expect(res.status).toBe(201)
    // The acceptance criterion: a plain create() row insert, no migration.
    expect(prismaMock.attributeDef.create).toHaveBeenCalledTimes(1)
    const data = prismaMock.attributeDef.create.mock.calls[0][0].data
    expect(data.storage).toBe('custom')
    expect(data.isSystem).toBe(false)
    expect(data.orgId).toBe(ORG_A)
  })

  it('422s a field whose storage is column — that needs a migration', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-person', slug: 'x', name: 'X', type: 'text', storage: 'column' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('migration')
    expect(prismaMock.attributeDef.create).not.toHaveBeenCalled()
  })

  it('422s a field whose object is not in this org', async () => {
    prismaMock.objectDef.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-in-b', slug: 'x', name: 'X', type: 'text' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('object was not found')
    expect(prismaMock.attributeDef.create).not.toHaveBeenCalled()
  })

  it('422s a missing objectId, slug, name, or type', async () => {
    for (const body of [
      { slug: 'x', name: 'X', type: 'text' }, // no objectId
      { objectId: 'obj-person', name: 'X', type: 'text' }, // no slug
      { objectId: 'obj-person', slug: 'x', type: 'text' }, // no name
      { objectId: 'obj-person', slug: 'x', name: 'X' }, // no type
    ]) {
      const res = await request(app).post(URL_A).set('Authorization', AUTH).send(body)
      expect(res.status).toBe(422)
    }
    expect(prismaMock.attributeDef.create).not.toHaveBeenCalled()
  })

  it('400s an unknown type', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-person', slug: 'x', name: 'X', type: 'wormhole' })

    expect(res.status).toBe(400)
    expect(prismaMock.attributeDef.create).not.toHaveBeenCalled()
  })

  it('409s a duplicate slug on the same object (the @@unique key)', async () => {
    prismaMock.attributeDef.create.mockRejectedValue({ code: 'P2002' })

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-person', slug: 'renewal_month', name: 'Renewal', type: 'text' })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already exists')
    expect(Object.keys(res.body)).toEqual(['error'])
  })

  it('writes the org from the path, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-person', slug: 'x', name: 'X', type: 'text', orgId: ORG_B })

    expect(prismaMock.attributeDef.create.mock.calls[0][0].data.orgId).toBe(ORG_A)
  })
})

// ============================================================
// POST — org isolation
// ============================================================
describe('POST /api/orgs/:orgId/attributes — org isolation', () => {
  it('401s without auth', async () => {
    const res = await request(app)
      .post(URL_A)
      .send({ objectId: 'obj-person', slug: 'x', name: 'X', type: 'text' })

    expect(res.status).toBe(401)
    expect(prismaMock.attributeDef.create).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/attributes`)
      .set('Authorization', AUTH)
      .send({ objectId: 'obj-person', slug: 'x', name: 'X', type: 'text' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.attributeDef.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list (by object) and read
// ============================================================
describe('GET /api/orgs/:orgId/attributes', () => {
  it('filters by objectId when given, trash excluded', async () => {
    await request(app).get(`${URL_A}?objectId=obj-person`).set('Authorization', AUTH)

    expect(prismaMock.attributeDef.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
      objectId: 'obj-person',
    })
  })

  it('404s a field in another org', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/attr-in-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Field not found')
  })
})

// ============================================================
// GET — delete impact
// ============================================================
describe('GET /api/orgs/:orgId/attributes/:id/impact', () => {
  it('returns the count of records with a non-empty value', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValueOnce(attributeRow({ id: 'attr-renewal' }))
    prismaMock.$queryRaw.mockResolvedValueOnce([{ valueCount: 2 }])

    const res = await request(app).get(`${URL_A}/attr-renewal/impact`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ valueCount: 2 })
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce()
  })

  it('404s a field in another org', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValueOnce(null)

    const res = await request(app).get(`${URL_A}/attr-in-b/impact`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Field not found' })
  })
})

// ============================================================
// PATCH — the isSystem retype guard (spec §10.2)
// ============================================================
describe('PATCH /api/orgs/:orgId/attributes/:id', () => {
  it('422s RETYPING a system field, and writes nothing', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValueOnce(
      attributeRow({ id: 'sys', slug: 'attention_status', type: 'status', storage: 'column', isSystem: true }),
    )

    const res = await request(app)
      .patch(`${URL_A}/sys`)
      .set('Authorization', AUTH)
      .send({ type: 'text' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('cannot be retyped')
    expect(prismaMock.attributeDef.updateMany).not.toHaveBeenCalled()
  })

  it('422s changing the storage of a system field', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValueOnce(
      attributeRow({ id: 'sys', type: 'status', storage: 'column', isSystem: true }),
    )

    const res = await request(app)
      .patch(`${URL_A}/sys`)
      .set('Authorization', AUTH)
      .send({ storage: 'custom' })

    expect(res.status).toBe(422)
    expect(prismaMock.attributeDef.updateMany).not.toHaveBeenCalled()
  })

  it('allows RENAMING and HIDING a system field', async () => {
    prismaMock.attributeDef.findFirst
      .mockResolvedValueOnce(
        attributeRow({ id: 'sys', type: 'status', storage: 'column', isSystem: true }),
      )
      .mockResolvedValueOnce(
        attributeRow({ id: 'sys', name: 'Attention', isArchived: true, isSystem: true, storage: 'column', type: 'status' }),
      )

    const res = await request(app)
      .patch(`${URL_A}/sys`)
      .set('Authorization', AUTH)
      // Re-sending the SAME type is not a retype and must be allowed.
      .send({ name: 'Attention', isArchived: true, type: 'status' })

    expect(res.status).toBe(200)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    expect(data.name).toBe('Attention')
    expect(data.isArchived).toBe(true)
  })

  it('allows retyping a NON-system (custom) field', async () => {
    prismaMock.attributeDef.findFirst
      .mockResolvedValueOnce(attributeRow({ id: 'attr-1', type: 'text', isSystem: false }))
      .mockResolvedValueOnce(attributeRow({ id: 'attr-1', type: 'number', isSystem: false }))

    const res = await request(app)
      .patch(`${URL_A}/attr-1`)
      .set('Authorization', AUTH)
      .send({ type: 'number' })

    expect(res.status).toBe(200)
    expect(prismaMock.attributeDef.updateMany.mock.calls[0][0].data.type).toBe('number')
  })

  it('updates via an org-scoped updateMany, never update-by-id', async () => {
    prismaMock.attributeDef.findFirst
      .mockResolvedValueOnce(attributeRow({ id: 'attr-1' }))
      .mockResolvedValueOnce(attributeRow({ id: 'attr-1', name: 'Renamed' }))

    const res = await request(app)
      .patch(`${URL_A}/attr-1`)
      .set('Authorization', AUTH)
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    expect(prismaMock.attributeDef.update).not.toHaveBeenCalled()
    expect(prismaMock.attributeDef.updateMany.mock.calls[0][0].where).toEqual({
      id: 'attr-1',
      orgId: ORG_A,
      deletedAt: null,
    })
  })
})

// ============================================================
// DELETE — the isSystem delete guard (spec §10.2)
// ============================================================
describe('DELETE /api/orgs/:orgId/attributes/:id', () => {
  it('422s deleting a system field — it may only be hidden', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValueOnce(
      attributeRow({ id: 'sys', isSystem: true }),
    )

    const res = await request(app).delete(`${URL_A}/sys`).set('Authorization', AUTH)

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('cannot be deleted')
    expect(prismaMock.attributeDef.updateMany).not.toHaveBeenCalled()
  })

  it('soft-deletes a custom field via updateMany and answers 204', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValueOnce(attributeRow({ id: 'attr-1', isSystem: false }))
    prismaMock.attributeDef.updateMany.mockResolvedValue({ count: 1 })

    const res = await request(app).delete(`${URL_A}/attr-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.attributeDef.delete).not.toHaveBeenCalled()
    const call = prismaMock.attributeDef.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'attr-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
  })

  it('404s deleting a field that is already trashed or in another org', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValue(null)

    const res = await request(app).delete(`${URL_A}/gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Field not found')
  })
})

// ============================================================
// Option CRUD (MAI-351) — add / relabel / recolor / archive / restore / rename / reassign-remove
// ============================================================
describe('option CRUD', () => {
  const SELECT_OPTIONS = [
    { value: 'open', label: 'Open', color: 'option-1', order: 0, isArchived: false },
    { value: 'closed', label: 'Closed', color: 'option-2', order: 1, isArchived: false },
  ]

  function selectAttributeRow(overrides: Record<string, unknown> = {}) {
    return attributeRow({
      id: 'attr-select',
      type: 'select',
      optionsJson: SELECT_OPTIONS,
      ...overrides,
    })
  }

  beforeEach(() => {
    // The option routes load the object too (for the value migration's storage).
    prismaMock.objectDef.findFirst.mockResolvedValue({ id: 'obj-person', slug: 'person', storage: 'table' })
    prismaMock.attributeDef.findFirst.mockResolvedValue(selectAttributeRow())
    prismaMock.attributeDef.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$executeRaw.mockResolvedValue(2)
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ attributeDef: prismaMock.attributeDef, $executeRaw: prismaMock.$executeRaw, $queryRaw: prismaMock.$queryRaw }),
    )
  })

  it('adds an option and auto-assigns the next muted token', async () => {
    prismaMock.attributeDef.findFirst
      .mockResolvedValueOnce(selectAttributeRow())
      .mockResolvedValueOnce(selectAttributeRow({ optionsJson: [...SELECT_OPTIONS, { value: 'won', label: 'Won', color: 'option-3', order: 2, isArchived: false }] }))

    const res = await request(app)
      .post(`${URL_A}/attr-select/options`)
      .set('Authorization', AUTH)
      .send({ value: 'won', label: 'Won' })

    expect(res.status).toBe(201)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    const options = data.optionsJson as Array<{ value: string; color: string }>
    expect(options).toHaveLength(3)
    expect(options[2]).toMatchObject({ value: 'won', label: 'Won', color: 'option-3' })
  })

  it('409s adding an option whose value already exists', async () => {
    const res = await request(app)
      .post(`${URL_A}/attr-select/options`)
      .set('Authorization', AUTH)
      .send({ value: 'open', label: 'Open again' })

    expect(res.status).toBe(409)
    expect(prismaMock.attributeDef.updateMany).not.toHaveBeenCalled()
  })

  it('422s adding an option to a non-option field', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValue(attributeRow({ id: 'attr-text', type: 'text' }))

    const res = await request(app)
      .post(`${URL_A}/attr-text/options`)
      .set('Authorization', AUTH)
      .send({ value: 'x', label: 'X' })

    expect(res.status).toBe(422)
    expect(prismaMock.attributeDef.updateMany).not.toHaveBeenCalled()
  })

  it('archives an option (hides from new choice, keeps historic rendering)', async () => {
    const res = await request(app)
      .patch(`${URL_A}/attr-select/options/closed`)
      .set('Authorization', AUTH)
      .send({ isArchived: true })

    expect(res.status).toBe(200)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    const options = data.optionsJson as Array<{ value: string; isArchived: boolean }>
    expect(options.find((option) => option.value === 'closed')?.isArchived).toBe(true)
    expect(options.find((option) => option.value === 'open')?.isArchived).toBe(false)
  })

  it('restores an archived option', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValue(
      selectAttributeRow({ optionsJson: [{ value: 'open', label: 'Open', color: 'option-1', order: 0, isArchived: false }, { value: 'closed', label: 'Closed', color: 'option-2', order: 1, isArchived: true }] }),
    )

    const res = await request(app)
      .patch(`${URL_A}/attr-select/options/closed`)
      .set('Authorization', AUTH)
      .send({ isArchived: false })

    expect(res.status).toBe(200)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    const options = data.optionsJson as Array<{ value: string; isArchived: boolean }>
    expect(options.find((option) => option.value === 'closed')?.isArchived).toBe(false)
  })

  it('recolors an option to a muted token', async () => {
    const res = await request(app)
      .patch(`${URL_A}/attr-select/options/open`)
      .set('Authorization', AUTH)
      .send({ color: 'option-5' })

    expect(res.status).toBe(200)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    const options = data.optionsJson as Array<{ value: string; color: string }>
    expect(options.find((option) => option.value === 'open')?.color).toBe('option-5')
  })

  it('400s recoloring to a raw hex', async () => {
    const res = await request(app)
      .patch(`${URL_A}/attr-select/options/open`)
      .set('Authorization', AUTH)
      .send({ color: '#0e7490' })

    expect(res.status).toBe(400)
    expect(prismaMock.attributeDef.updateMany).not.toHaveBeenCalled()
  })

  it('renames a value, migrating records atomically and returning the count', async () => {
    const res = await request(app)
      .post(`${URL_A}/attr-select/options/closed/rename`)
      .set('Authorization', AUTH)
      .send({ value: 'closed_won' })

    expect(res.status).toBe(200)
    expect(res.body.valueCount).toBe(2)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    const options = data.optionsJson as Array<{ value: string }>
    expect(options.map((option) => option.value)).toEqual(['open', 'closed_won'])
  })

  it('409s renaming to a value that already exists', async () => {
    const res = await request(app)
      .post(`${URL_A}/attr-select/options/closed/rename`)
      .set('Authorization', AUTH)
      .send({ value: 'open' })

    expect(res.status).toBe(409)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('reassigns records to another option, then removes the option', async () => {
    const res = await request(app)
      .delete(`${URL_A}/attr-select/options/closed`)
      .set('Authorization', AUTH)
      .send({ reassignTo: 'open' })

    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    const data = prismaMock.attributeDef.updateMany.mock.calls[0][0].data
    const options = data.optionsJson as Array<{ value: string }>
    expect(options.map((option) => option.value)).toEqual(['open'])
  })

  it('422s reassigning to a value that is not an option', async () => {
    const res = await request(app)
      .delete(`${URL_A}/attr-select/options/closed`)
      .set('Authorization', AUTH)
      .send({ reassignTo: 'nope' })

    expect(res.status).toBe(422)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('returns the record count for a value via the impact endpoint', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ count: 7n }])

    const res = await request(app).get(`${URL_A}/attr-select/options/closed/impact`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ valueCount: 7 })
  })

  it('404s an option route on a field in another org', async () => {
    prismaMock.attributeDef.findFirst.mockResolvedValue(null)

    const res = await request(app).patch(`${URL_A}/attr-in-b/options/open`).set('Authorization', AUTH).send({ isArchived: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Field not found')
  })
})
