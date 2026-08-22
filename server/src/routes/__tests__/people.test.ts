// Route tests for /api/orgs/:orgId/people (MAI-130, T2).
//
// The rules the database cannot enforce are the heart of this suite: the identity
// anchor (a person needs a name part, an email, a phone, or a linkedinUrl, else
// 422), org isolation (a non-member is 404 before any row is read; every write is
// scoped by orgId, never update-by-id), E.164 normalization, and idempotent
// re-add of a phone/email via upsert. The exact-one-primary invariant, which needs
// real row state, is proven against Postgres in people.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => {
  const phone = {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    // Present only so a test can prove nothing ever calls them.
    update: vi.fn(),
    delete: vi.fn(),
  }
  const email = {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  const base = {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    person: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    personPhone: phone,
    personEmail: email,
    // Field history (MAI-136): the PATCH writes its history rows in the same
    // transaction as the update, and reads the attribute defs to shape-check them.
    objectDef: { findFirst: vi.fn() },
    attributeDef: { findMany: vi.fn() },
    fieldHistory: { createMany: vi.fn() },
  }
  return {
    prismaMock: {
      ...base,
      // The routes run their multi-step writes in a transaction; the mock just
      // runs the callback with the same delegates.
      $transaction: vi.fn(async (cb: (tx: typeof base) => unknown) => cb(base)),
    },
    verifyTokenMock: vi.fn(),
  }
})

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

import app from '../../app.js'

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/people`

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

function phoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ph-1',
    orgId: ORG_A,
    personId: 'p-1',
    e164: '+12025550100',
    extension: null,
    label: 'mobile',
    status: 'unverified',
    reason: null,
    isDnc: false,
    dncReason: null,
    lineType: null,
    lineTypeCheckedAt: null,
    source: null,
    isPrimary: true,
    timesDialed: 0,
    lastDialedAt: null,
    timesConnected: 0,
    lastConnectedAt: null,
    bestTimeToCall: null,
    lastVerifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function emailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'em-1',
    orgId: ORG_A,
    personId: 'p-1',
    address: 'jane@acme.com',
    label: 'work',
    status: 'unverified',
    reason: null,
    isDnc: false,
    dncReason: null,
    source: null,
    isPrimary: true,
    lastVerifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function personRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    orgId: ORG_A,
    firstName: 'Jane',
    lastName: 'Doe',
    preferredFirstName: null,
    title: null,
    linkedinUrl: null,
    companyId: null,
    ownerUserId: null,
    timeZone: null,
    persona: null,
    attentionStatus: 'on_deck',
    attentionReason: null,
    callbackDate: null,
    source: null,
    lastContactedAt: null,
    nameAudioUrl: null,
    customJson: {},
    mergedIntoId: null,
    deletedById: null,
    isArchived: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    phones: [],
    addresses: [],
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
  // Person defaults.
  prismaMock.person.findFirst.mockResolvedValue(null)
  prismaMock.person.findFirstOrThrow.mockResolvedValue(personRow())
  prismaMock.person.findMany.mockResolvedValue([personRow()])
  prismaMock.person.count.mockResolvedValue(1)
  prismaMock.person.create.mockResolvedValue(personRow())
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 })
  // Company (for companyId checks).
  prismaMock.company.findFirst.mockResolvedValue(null)
  // Phone/email defaults — reconcile reads findMany, writes updateMany.
  prismaMock.personPhone.findFirst.mockResolvedValue(null)
  prismaMock.personPhone.findFirstOrThrow.mockResolvedValue(phoneRow())
  prismaMock.personPhone.findMany.mockResolvedValue([])
  prismaMock.personPhone.create.mockResolvedValue(phoneRow())
  prismaMock.personPhone.upsert.mockResolvedValue(phoneRow())
  prismaMock.personPhone.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.personPhone.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.personEmail.findFirst.mockResolvedValue(null)
  prismaMock.personEmail.findFirstOrThrow.mockResolvedValue(emailRow())
  prismaMock.personEmail.findMany.mockResolvedValue([])
  prismaMock.personEmail.create.mockResolvedValue(emailRow())
  prismaMock.personEmail.upsert.mockResolvedValue(emailRow())
  prismaMock.personEmail.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.personEmail.deleteMany.mockResolvedValue({ count: 1 })
  // Field history (MAI-136). No seeded ObjectDef by default, so the shape check
  // finds no definitions and the history rows are written unvalidated.
  prismaMock.objectDef.findFirst.mockResolvedValue(null)
  prismaMock.attributeDef.findMany.mockResolvedValue([])
  prismaMock.fieldHistory.createMany.mockResolvedValue({ count: 1 })
})

// ============================================================
// POST — the identity-anchor rule (spec §5.15)
// ============================================================
describe('POST /api/orgs/:orgId/people — identity anchor', () => {
  it('creates a person from only a name', async () => {
    prismaMock.person.findFirstOrThrow.mockResolvedValue(personRow({ firstName: 'Solo', lastName: null }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ firstName: 'Solo' })

    expect(res.status).toBe(201)
    expect(res.body.person.displayName).toBe('Solo')
  })

  it('creates a person from only a phone (anchor lives in a child row)', async () => {
    prismaMock.person.findFirstOrThrow.mockResolvedValue(
      personRow({ firstName: null, lastName: null, phones: [phoneRow()] }),
    )

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ phones: [{ e164: '+12025550100' }] })

    expect(res.status).toBe(201)
    expect(prismaMock.person.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.personPhone.create).toHaveBeenCalledTimes(1)
  })

  it('creates a person from only an email', async () => {
    prismaMock.person.findFirstOrThrow.mockResolvedValue(
      personRow({ firstName: null, lastName: null, addresses: [emailRow()] }),
    )

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ emails: [{ address: 'jane@acme.com' }] })

    expect(res.status).toBe(201)
    expect(prismaMock.personEmail.create).toHaveBeenCalledTimes(1)
  })

  it('422s a create with no identity anchor, and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ persona: 'champion', title: 'VP' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('at least one')
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })

  it('422s a create whose only name is an empty string (empty → absent)', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ firstName: '   ', lastName: '' })

    expect(res.status).toBe(422)
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — the contract
// ============================================================
describe('POST /api/orgs/:orgId/people', () => {
  it('writes the org from the path, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ firstName: 'Jane', orgId: ORG_B, id: 'attacker-chosen' })

    const data = prismaMock.person.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    expect(data.id).toBeUndefined()
  })

  it('normalizes empty optional fields to absent, never ""', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ firstName: 'Jane', title: '  ', source: '' })

    const data = prismaMock.person.create.mock.calls[0][0].data
    expect(data.title).toBeUndefined()
    expect(data.source).toBeUndefined()
  })

  it('normalizes a nested phone e164 to E.164 before writing', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ firstName: 'Jane', phones: [{ e164: '(202) 555-0134' }] })

    expect(prismaMock.personPhone.create.mock.calls[0][0].data.e164).toBe('+12025550134')
  })

  it('422s a companyId that is not a company in this org', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ firstName: 'Jane', companyId: 'co-in-org-b' })

    expect(res.status).toBe(422)
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'co-in-org-b', orgId: ORG_A, deletedAt: null },
    })
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })

  it('400s a nested phone whose number cannot be an E.164', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ firstName: 'Jane', phones: [{ e164: '123' }] })

    expect(res.status).toBe(400)
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/people — org isolation', () => {
  it('401s without auth, and writes nothing', async () => {
    const res = await request(app).post(URL_A).send({ firstName: 'Jane' })

    expect(res.status).toBe(401)
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/people`)
      .set('Authorization', AUTH)
      .send({ firstName: 'Jane' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ firstName: 'Jane' })

    expect(res.status).toBe(404)
    expect(prismaMock.person.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list
// ============================================================
describe('GET /api/orgs/:orgId/people', () => {
  it('returns the org’s people with the pagination envelope, trash excluded', async () => {
    prismaMock.person.findMany.mockResolvedValue([personRow({ id: 'p1' }), personRow({ id: 'p2' })])
    prismaMock.person.count.mockResolvedValue(2)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.people.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2'])
    expect(res.body.total).toBe(2)
    expect(prismaMock.person.count).toHaveBeenCalledWith({ where: { orgId: ORG_A, deletedAt: null } })
    expect(prismaMock.person.findMany.mock.calls[0][0].where).toEqual({ orgId: ORG_A, deletedAt: null })
  })

  it('searches name parts by q', async () => {
    await request(app).get(`${URL_A}?q=jan`).set('Authorization', AUTH)

    expect(prismaMock.person.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
      OR: [
        { firstName: { contains: 'jan', mode: 'insensitive' } },
        { lastName: { contains: 'jan', mode: 'insensitive' } },
        { preferredFirstName: { contains: 'jan', mode: 'insensitive' } },
      ],
    })
  })

  it('filters to one company when companyId is given', async () => {
    await request(app).get(`${URL_A}?companyId=co-9`).set('Authorization', AUTH)

    expect(prismaMock.person.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
      companyId: 'co-9',
    })
  })
})

// ============================================================
// GET /:id — one person
// ============================================================
describe('GET /api/orgs/:orgId/people/:id', () => {
  it('reads by id AND orgId together, includes phones/emails, and hides internals', async () => {
    prismaMock.person.findFirst.mockResolvedValue(
      personRow({ id: 'p-9', phones: [phoneRow()], addresses: [emailRow()] }),
    )

    const res = await request(app).get(`${URL_A}/p-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.person.id).toBe('p-9')
    expect(res.body.person.phones).toHaveLength(1)
    expect(res.body.person.emails).toHaveLength(1)
    expect(prismaMock.person.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-9', orgId: ORG_A, deletedAt: null },
      include: { phones: true, addresses: true },
    })
    expect(res.body.person.orgId).toBeUndefined()
    expect(res.body.person.deletedById).toBeUndefined()
  })

  it('404s a person that belongs to another org — never a 403', async () => {
    prismaMock.person.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/p-in-org-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Person not found')
  })
})

// ============================================================
// PATCH /:id — update, anchor re-checked on the merged row
// ============================================================
describe('PATCH /api/orgs/:orgId/people/:id', () => {
  it('updates via an org-scoped updateMany, never update-by-id', async () => {
    prismaMock.person.findFirst
      .mockResolvedValueOnce({ ...personRow({ id: 'p-1' }), _count: { phones: 0, addresses: 0 } })
      .mockResolvedValueOnce(personRow({ id: 'p-1', title: 'VP Sales' }))

    const res = await request(app)
      .patch(`${URL_A}/p-1`)
      .set('Authorization', AUTH)
      .send({ title: 'VP Sales' })

    expect(res.status).toBe(200)
    expect(prismaMock.person.update).not.toHaveBeenCalled()
    const call = prismaMock.person.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'p-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.title).toBe('VP Sales')
  })

  it('merge-patches one custom value without losing existing values', async () => {
    prismaMock.person.findFirst
      .mockResolvedValueOnce({ ...personRow({ id: 'p-1', customJson: { legacy: 'keep' } }), _count: { phones: 0, addresses: 0 } })
      .mockResolvedValueOnce(personRow({ id: 'p-1', customJson: { legacy: 'keep', website: 'https://maincar.com' } }))
    const res = await request(app).patch(`${URL_A}/p-1`).set('Authorization', AUTH).send({ customValues: { website: 'https://maincar.com' } })
    expect(res.status).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls[0][0].data.customJson).toEqual({ legacy: 'keep', website: 'https://maincar.com' })
  })

  // --- Field history (MAI-136 T8, spec §5.7) ---
  it('writes a FieldHistory row for a changed title, inside the update transaction', async () => {
    prismaMock.person.findFirst
      .mockResolvedValueOnce({
        ...personRow({ id: 'p-1', title: 'SDR' }),
        _count: { phones: 0, addresses: 0 },
      })
      .mockResolvedValueOnce(personRow({ id: 'p-1', title: 'VP Sales' }))

    const res = await request(app)
      .patch(`${URL_A}/p-1`)
      .set('Authorization', AUTH)
      .send({ title: 'VP Sales' })

    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect(prismaMock.fieldHistory.createMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.fieldHistory.createMany.mock.calls[0][0].data).toEqual([
      {
        orgId: ORG_A,
        objectSlug: 'person',
        recordId: 'p-1',
        attribute: 'title',
        oldJson: 'SDR',
        newJson: 'VP Sales',
        changedByUserId: 'user-a',
        changeSource: 'user',
        reason: null,
      },
    ])
  })

  it('writes no history when the submitted value matches what is already stored', async () => {
    prismaMock.person.findFirst
      .mockResolvedValueOnce({
        ...personRow({ id: 'p-1', title: 'SDR' }),
        _count: { phones: 0, addresses: 0 },
      })
      .mockResolvedValueOnce(personRow({ id: 'p-1', title: 'SDR' }))

    const res = await request(app)
      .patch(`${URL_A}/p-1`)
      .set('Authorization', AUTH)
      .send({ title: 'SDR' })

    expect(res.status).toBe(200)
    expect(prismaMock.fieldHistory.createMany).not.toHaveBeenCalled()
  })

  it('422s an update that would clear the last identity anchor (no children)', async () => {
    prismaMock.person.findFirst.mockResolvedValueOnce({
      ...personRow({ id: 'p-1', firstName: 'Solo', lastName: null, linkedinUrl: null }),
      _count: { phones: 0, addresses: 0 },
    })

    const res = await request(app)
      .patch(`${URL_A}/p-1`)
      .set('Authorization', AUTH)
      .send({ firstName: '' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('at least one')
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })

  it('allows clearing the name when a phone still anchors the person', async () => {
    prismaMock.person.findFirst
      .mockResolvedValueOnce({
        ...personRow({ id: 'p-1', firstName: 'Solo', lastName: null, linkedinUrl: null }),
        _count: { phones: 1, addresses: 0 },
      })
      .mockResolvedValueOnce(personRow({ id: 'p-1', firstName: null }))

    const res = await request(app).patch(`${URL_A}/p-1`).set('Authorization', AUTH).send({ firstName: '' })

    expect(res.status).toBe(200)
    // Cleared to NULL, not "".
    expect(prismaMock.person.updateMany.mock.calls[0][0].data.firstName).toBeNull()
  })

  it('rejects managing children through the person PATCH body', async () => {
    // The body is rejected before the row is even read, so no findFirst is stubbed.
    const res = await request(app)
      .patch(`${URL_A}/p-1`)
      .set('Authorization', AUTH)
      .send({ phones: [{ e164: '+12025550100' }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('/phones and /emails')
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })

  it('404s an update to a person in another org', async () => {
    prismaMock.person.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(`${URL_A}/p-in-org-b`)
      .set('Authorization', AUTH)
      .send({ title: 'x' })

    expect(res.status).toBe(404)
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE /:id — soft-delete into the trash
// ============================================================
describe('DELETE /api/orgs/:orgId/people/:id', () => {
  it('soft-deletes via an org-scoped updateMany and answers 204', async () => {
    const res = await request(app).delete(`${URL_A}/p-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.person.delete).not.toHaveBeenCalled()
    const call = prismaMock.person.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'p-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
    expect(call.data.deletedById).toBe('user-a')
  })

  it('404s deleting a person already trashed or in another org', async () => {
    prismaMock.person.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/p-gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
  })
})

// ============================================================
// POST /:id/phones — add / idempotent re-add
// ============================================================
describe('POST /api/orgs/:orgId/people/:id/phones', () => {
  beforeEach(() => {
    // The person must exist for a nested write.
    prismaMock.person.findFirst.mockResolvedValue(personRow({ id: 'p-1' }))
  })

  it('adds a phone via upsert (idempotent re-add), normalizing the number', async () => {
    prismaMock.personPhone.findFirstOrThrow.mockResolvedValue(phoneRow({ e164: '+12025550134' }))

    const res = await request(app)
      .post(`${URL_A}/p-1/phones`)
      .set('Authorization', AUTH)
      .send({ e164: '202-555-0134', label: 'mobile' })

    expect(res.status).toBe(201)
    // upsert, not create: re-adding the same number cannot throw a unique error.
    expect(prismaMock.personPhone.upsert).toHaveBeenCalledTimes(1)
    const call = prismaMock.personPhone.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ personId_e164: { personId: 'p-1', e164: '+12025550134' } })
    expect(call.create.e164).toBe('+12025550134')
    // isPrimary is decided by reconcile, never trusted from the create payload.
    expect(call.create.isPrimary).toBe(false)
  })

  it('does not overwrite a retained dead status on re-add (only sent fields)', async () => {
    const res = await request(app)
      .post(`${URL_A}/p-1/phones`)
      .set('Authorization', AUTH)
      .send({ e164: '+12025550100', label: 'work' })

    expect(res.status).toBe(201)
    // The re-add sent only a label, so the upsert's update touches only label —
    // a stored dead status/reason is retained.
    expect(prismaMock.personPhone.upsert.mock.calls[0][0].update).toEqual({ label: 'work' })
  })

  it('400s an unparseable number', async () => {
    const res = await request(app)
      .post(`${URL_A}/p-1/phones`)
      .set('Authorization', AUTH)
      .send({ e164: 'nope' })

    expect(res.status).toBe(400)
    expect(prismaMock.personPhone.upsert).not.toHaveBeenCalled()
  })

  it('404s adding a phone to a person in another org', async () => {
    prismaMock.person.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(`${URL_A}/p-in-org-b/phones`)
      .set('Authorization', AUTH)
      .send({ e164: '+12025550100' })

    expect(res.status).toBe(404)
    expect(prismaMock.personPhone.upsert).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE /:id/phones/:phoneId — remove + auto-promote reconcile
// ============================================================
describe('DELETE /api/orgs/:orgId/people/:id/phones/:phoneId', () => {
  beforeEach(() => {
    prismaMock.person.findFirst.mockResolvedValue(personRow({ id: 'p-1' }))
  })

  it('deletes via an org-scoped deleteMany, then reconciles the primary', async () => {
    // After delete, one phone remains and it has no primary → reconcile promotes it.
    prismaMock.personPhone.findMany.mockResolvedValue([{ id: 'ph-2', isPrimary: false }])

    const res = await request(app).delete(`${URL_A}/p-1/phones/ph-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.personPhone.delete).not.toHaveBeenCalled()
    expect(prismaMock.personPhone.deleteMany).toHaveBeenCalledWith({
      where: { id: 'ph-1', personId: 'p-1', orgId: ORG_A },
    })
    // Reconcile promoted the survivor to primary.
    expect(prismaMock.personPhone.updateMany).toHaveBeenCalledWith({
      where: { personId: 'p-1', orgId: ORG_A, id: 'ph-2', isPrimary: false },
      data: { isPrimary: true },
    })
  })

  it('404s deleting a phone that is not on this person', async () => {
    prismaMock.personPhone.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/p-1/phones/ph-gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
  })
})

// ============================================================
// POST /:id/emails — add / idempotent re-add
// ============================================================
describe('POST /api/orgs/:orgId/people/:id/emails', () => {
  beforeEach(() => {
    prismaMock.person.findFirst.mockResolvedValue(personRow({ id: 'p-1' }))
  })

  it('adds an email via upsert, lowercasing the address', async () => {
    prismaMock.personEmail.findFirstOrThrow.mockResolvedValue(emailRow({ address: 'jane@acme.com' }))

    const res = await request(app)
      .post(`${URL_A}/p-1/emails`)
      .set('Authorization', AUTH)
      .send({ address: 'Jane@ACME.com' })

    expect(res.status).toBe(201)
    expect(prismaMock.personEmail.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.personEmail.upsert.mock.calls[0][0].where).toEqual({
      personId_address: { personId: 'p-1', address: 'jane@acme.com' },
    })
  })

  it('400s an invalid address', async () => {
    const res = await request(app)
      .post(`${URL_A}/p-1/emails`)
      .set('Authorization', AUTH)
      .send({ address: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(prismaMock.personEmail.upsert).not.toHaveBeenCalled()
  })
})
