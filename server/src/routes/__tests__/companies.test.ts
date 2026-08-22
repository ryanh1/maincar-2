// Route tests for /api/orgs/:orgId/companies (MAI-129, T1).
//
// The two rules the database cannot enforce are the heart of this suite: the
// identity-anchor rule (create/patch with no name|domain|linkedinUrl is 422) and
// org isolation (a non-member is 404 before any row is read, and every write is
// scoped by orgId, never update-by-id). The rest pins the create/read/update/
// delete contract and the empty-to-absent normalization.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// vi.hoisted() builds the mocks, vi.mock() swaps the modules, and `app.js` is
// imported LAST so the mocks are in place when its module graph loads.
const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    company: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
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

const NOW = new Date('2026-08-20T12:00:00.000Z')
const AUTH = 'Bearer fake-token'
const ORG_A = 'org-a'
const ORG_B = 'org-b'
const URL_A = `/api/orgs/${ORG_A}/companies`

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

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'co-1',
    orgId: ORG_A,
    name: 'Google',
    legalName: null,
    companyType: null,
    domain: 'google.com',
    alternateDomains: [],
    linkedinUrl: null,
    industry: null,
    sizeEmployees: null,
    logoUrl: null,
    mergedIntoId: null,
    deletedById: null,
    parentCompanyId: null,
    ownerUserId: null,
    attentionStatus: 'on_deck',
    attentionReason: null,
    callbackDate: null,
    source: null,
    customJson: {},
    isArchived: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Signs the caller in. `membership` is what they hold in the org they ask about. */
function authAs(membership: ReturnType<typeof membershipRow> | null = membershipRow()): void {
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@orga.com' })
  prismaMock.user.findUnique.mockResolvedValue(userRow())
  prismaMock.user.findUniqueOrThrow.mockResolvedValue(userRow())
  prismaMock.membership.findFirst.mockResolvedValue(membership)
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.company.findFirst.mockResolvedValue(null)
  prismaMock.company.findMany.mockResolvedValue([companyRow()])
  prismaMock.company.count.mockResolvedValue(1)
  prismaMock.company.create.mockResolvedValue(companyRow())
  prismaMock.company.updateMany.mockResolvedValue({ count: 1 })
})

// ============================================================
// POST — the identity-anchor rule (spec §5.15)
// ============================================================
describe('POST /api/orgs/:orgId/companies — identity anchor', () => {
  it('creates a company from only a domain, and the display name is the domain', async () => {
    prismaMock.company.create.mockResolvedValue(
      companyRow({ id: 'co-2', name: null, domain: 'acme.com' }),
    )

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ domain: 'acme.com' })

    expect(res.status).toBe(201)
    expect(res.body.company.name).toBeNull()
    expect(res.body.company.domain).toBe('acme.com')
    expect(res.body.company.displayName).toBe('acme.com')
  })

  it('creates a company from only a name', async () => {
    prismaMock.company.create.mockResolvedValue(companyRow({ name: 'Solo', domain: null }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ name: 'Solo' })

    expect(res.status).toBe(201)
    expect(res.body.company.displayName).toBe('Solo')
  })

  it('creates a company from only a linkedinUrl', async () => {
    prismaMock.company.create.mockResolvedValue(
      companyRow({ name: null, domain: null, linkedinUrl: 'https://linkedin.com/company/x' }),
    )

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ linkedinUrl: 'https://linkedin.com/company/x' })

    expect(res.status).toBe(201)
    // No name and no domain, so the display name falls all the way back.
    expect(res.body.company.displayName).toBe('Untitled company')
  })

  it('422s a create with no identity anchor, and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ companyType: 'saas', industry: 'tech' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('at least one')
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })

  it('422s a create whose only anchor is an empty string (empty → absent)', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: '   ', domain: '' })

    expect(res.status).toBe(422)
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — the contract
// ============================================================
describe('POST /api/orgs/:orgId/companies', () => {
  it('writes the org from the path, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Google', orgId: ORG_B, id: 'attacker-chosen' })

    expect(prismaMock.company.create).toHaveBeenCalledTimes(1)
    const data = prismaMock.company.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    expect(data.id).toBeUndefined()
  })

  it('normalizes empty optional fields to absent, never ""', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Google', legalName: '  ', industry: '' })

    const data = prismaMock.company.create.mock.calls[0][0].data
    expect(data.legalName).toBeUndefined()
    expect(data.industry).toBeUndefined()
  })

  it('409s a duplicate domain in the same org (the @@unique key), reported cleanly', async () => {
    prismaMock.company.create.mockRejectedValue({ code: 'P2002' })

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ domain: 'google.com' })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already exists')
    expect(Object.keys(res.body)).toEqual(['error'])
  })

  it('does not treat two anchorless-domain companies as a collision at the route level', async () => {
    // NULL domains do not collide under the unique index, so the route must not
    // pre-reject a create that omits the domain — it just needs another anchor.
    prismaMock.company.create.mockResolvedValue(companyRow({ name: 'NoDomain', domain: null }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ name: 'NoDomain' })

    expect(res.status).toBe(201)
    expect(prismaMock.company.create.mock.calls[0][0].data.domain).toBeUndefined()
  })

  it('400s a domain that is a full URL rather than a bare host', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ domain: 'https://google.com/path' })

    expect(res.status).toBe(400)
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })

  it('422s a parentCompanyId that is not a company in this org', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null) // parent lookup finds nothing

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Child', parentCompanyId: 'co-in-org-b' })

    expect(res.status).toBe(422)
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'co-in-org-b', orgId: ORG_A, deletedAt: null },
    })
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/companies — org isolation', () => {
  it('401s without auth, and writes nothing', async () => {
    const res = await request(app).post(URL_A).send({ name: 'Google' })

    expect(res.status).toBe(401)
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/companies`)
      .set('Authorization', AUTH)
      .send({ name: 'Google' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ name: 'Google' })

    expect(res.status).toBe(404)
    expect(prismaMock.company.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list
// ============================================================
describe('GET /api/orgs/:orgId/companies', () => {
  it('returns the org’s companies with the pagination envelope, trash excluded', async () => {
    prismaMock.company.findMany.mockResolvedValue([companyRow({ id: 'c1' }), companyRow({ id: 'c2' })])
    prismaMock.company.count.mockResolvedValue(2)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.companies.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2'])
    expect(res.body.total).toBe(2)
    // Both the count and the page are scoped to the org and hide the trash.
    expect(prismaMock.company.count).toHaveBeenCalledWith({ where: { orgId: ORG_A, deletedAt: null } })
    expect(prismaMock.company.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
    })
  })

  it('searches name and domain by q', async () => {
    await request(app).get(`${URL_A}?q=goog`).set('Authorization', AUTH)

    expect(prismaMock.company.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
      OR: [
        { name: { contains: 'goog', mode: 'insensitive' } },
        { domain: { contains: 'goog', mode: 'insensitive' } },
      ],
    })
  })

  it('exposes a computed displayName that falls back to the domain', async () => {
    prismaMock.company.findMany.mockResolvedValue([companyRow({ name: null, domain: 'acme.com' })])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.companies[0].displayName).toBe('acme.com')
  })
})

// ============================================================
// GET /:id — one company
// ============================================================
describe('GET /api/orgs/:orgId/companies/:id', () => {
  it('reads by id AND orgId together, and returns the company', async () => {
    prismaMock.company.findFirst.mockResolvedValue(companyRow({ id: 'co-9' }))

    const res = await request(app).get(`${URL_A}/co-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.company.id).toBe('co-9')
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'co-9', orgId: ORG_A, deletedAt: null },
    })
    // No tenant internals leak.
    expect(res.body.company.orgId).toBeUndefined()
    expect(res.body.company.deletedById).toBeUndefined()
  })

  it('404s a company that belongs to another org — never a 403', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/co-in-org-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Company not found')
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'co-in-org-b', orgId: ORG_A, deletedAt: null },
    })
  })

  it('404s for an org the caller does not belong to, before it reads', async () => {
    authAs(null)

    const res = await request(app)
      .get(`/api/orgs/${ORG_B}/companies/co-9`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled()
  })
})

// ============================================================
// PATCH /:id — update, with the anchor re-checked on the merged row
// ============================================================
describe('PATCH /api/orgs/:orgId/companies/:id', () => {
  it('updates via an org-scoped updateMany, never update-by-id', async () => {
    prismaMock.company.findFirst
      .mockResolvedValueOnce(companyRow({ id: 'co-1' })) // load current
      .mockResolvedValueOnce(companyRow({ id: 'co-1', industry: 'fintech' })) // re-read

    const res = await request(app)
      .patch(`${URL_A}/co-1`)
      .set('Authorization', AUTH)
      .send({ industry: 'fintech' })

    expect(res.status).toBe(200)
    expect(prismaMock.company.update).not.toHaveBeenCalled()
    expect(prismaMock.company.updateMany).toHaveBeenCalledTimes(1)
    const call = prismaMock.company.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'co-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.industry).toBe('fintech')
    expect(res.body.company.industry).toBe('fintech')
  })

  it('merge-patches one custom value without losing existing values', async () => {
    prismaMock.company.findFirst
      .mockResolvedValueOnce(companyRow({ id: 'co-1', customJson: { legacy: 'keep' } }))
      .mockResolvedValueOnce(companyRow({ id: 'co-1', customJson: { legacy: 'keep', website: 'https://maincar.com' } }))
    const res = await request(app).patch(`${URL_A}/co-1`).set('Authorization', AUTH).send({ customValues: { website: 'https://maincar.com' } })
    expect(res.status).toBe(200)
    expect(prismaMock.company.updateMany.mock.calls[0][0].data.customJson).toEqual({ legacy: 'keep', website: 'https://maincar.com' })
  })

  it('422s an update that would clear the last identity anchor', async () => {
    // The stored row's only anchor is its name; clearing it leaves no anchor.
    prismaMock.company.findFirst.mockResolvedValueOnce(
      companyRow({ id: 'co-1', name: 'Solo', domain: null, linkedinUrl: null }),
    )

    const res = await request(app)
      .patch(`${URL_A}/co-1`)
      .set('Authorization', AUTH)
      .send({ name: '' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('at least one')
    expect(prismaMock.company.updateMany).not.toHaveBeenCalled()
  })

  it('allows clearing one anchor while another remains', async () => {
    prismaMock.company.findFirst
      .mockResolvedValueOnce(companyRow({ id: 'co-1', name: 'Google', domain: 'google.com' }))
      .mockResolvedValueOnce(companyRow({ id: 'co-1', name: null, domain: 'google.com' }))

    const res = await request(app)
      .patch(`${URL_A}/co-1`)
      .set('Authorization', AUTH)
      .send({ name: '' })

    expect(res.status).toBe(200)
    // The cleared field is written as NULL (empty → absent), not "".
    expect(prismaMock.company.updateMany.mock.calls[0][0].data.name).toBeNull()
  })

  it('422s making a company its own parent', async () => {
    prismaMock.company.findFirst.mockResolvedValueOnce(companyRow({ id: 'co-1' }))

    const res = await request(app)
      .patch(`${URL_A}/co-1`)
      .set('Authorization', AUTH)
      .send({ parentCompanyId: 'co-1' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('own parent')
    expect(prismaMock.company.updateMany).not.toHaveBeenCalled()
  })

  it('404s an update to a company in another org', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(`${URL_A}/co-in-org-b`)
      .set('Authorization', AUTH)
      .send({ industry: 'x' })

    expect(res.status).toBe(404)
    expect(prismaMock.company.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE /:id — soft-delete into the trash
// ============================================================
describe('DELETE /api/orgs/:orgId/companies/:id', () => {
  it('soft-deletes via an org-scoped updateMany and answers 204', async () => {
    prismaMock.company.updateMany.mockResolvedValue({ count: 1 })

    const res = await request(app).delete(`${URL_A}/co-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.company.delete).not.toHaveBeenCalled()
    expect(prismaMock.company.deleteMany).not.toHaveBeenCalled()
    const call = prismaMock.company.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'co-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
    expect(call.data.deletedById).toBe('user-a')
  })

  it('404s deleting a company that is already trashed or in another org', async () => {
    prismaMock.company.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/co-gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Company not found')
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)

    const res = await request(app)
      .delete(`/api/orgs/${ORG_B}/companies/co-1`)
      .set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.company.updateMany).not.toHaveBeenCalled()
  })
})
