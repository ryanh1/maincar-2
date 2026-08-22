// Route tests for /api/orgs/:orgId/deals (MAI-131, T3).
//
// The rules the database cannot enforce are the heart of this suite:
//   - a deal's stage must BELONG to its pipeline (create and on a stage/pipeline
//     change), else 422;
//   - money is integer minor units, never a float — a fractional amount is 400,
//     and a value (even one larger than 2^53) round-trips exactly as a string;
//   - org isolation — a non-member is 404 before any row is read, and every write
//     is scoped by orgId via updateMany/deleteMany, never update/delete by id.
// The rest pins the CRUD contract and the DealPersonRole add/remove behaviour,
// including "the same person holds different roles on different deals".
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    membership: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    person: { findFirst: vi.fn() },
    pipeline: { findFirst: vi.fn() },
    pipelineStage: { findFirst: vi.fn() },
    activityEntry: { upsert: vi.fn() },
    fieldHistory: { createMany: vi.fn() },
    $transaction: vi.fn(),
    deal: {
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
    dealPersonRole: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
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
const URL_A = `/api/orgs/${ORG_A}/deals`

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

function dealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-1',
    orgId: ORG_A,
    name: 'Acme renewal',
    companyId: null,
    pipelineId: 'pipe-1',
    stageId: 'stage-1',
    amountMinor: 123456n,
    currency: 'USD',
    closeDate: null,
    status: 'open',
    lostReason: null,
    ownerUserId: null,
    customJson: {},
    mergedIntoId: null,
    deletedById: null,
    isArchived: false,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'role-1',
    orgId: ORG_A,
    dealId: 'deal-1',
    personId: 'person-1',
    role: 'champion',
    isPrimary: false,
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

// A pipeline+stage pair where the stage belongs to the pipeline (the good case).
function stageBelongs(pipelineId = 'pipe-1', stageId = 'stage-1'): void {
  prismaMock.pipeline.findFirst.mockResolvedValue({ id: pipelineId })
  prismaMock.pipelineStage.findFirst.mockResolvedValue({ id: stageId, pipelineId })
}

beforeEach(() => {
  vi.clearAllMocks()
  authAs()
  prismaMock.deal.findFirst.mockResolvedValue(null)
  prismaMock.deal.findMany.mockResolvedValue([dealRow()])
  prismaMock.deal.count.mockResolvedValue(1)
  prismaMock.deal.create.mockResolvedValue(dealRow())
  prismaMock.deal.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.company.findFirst.mockResolvedValue(null)
  prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1' })
  prismaMock.dealPersonRole.upsert.mockResolvedValue(roleRow())
  prismaMock.dealPersonRole.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.activityEntry.upsert.mockResolvedValue({ id: 'activity-1' })
  prismaMock.fieldHistory.createMany.mockResolvedValue({ count: 1 })
  prismaMock.$transaction.mockImplementation(async (action: (tx: typeof prismaMock) => unknown) => action(prismaMock))
  stageBelongs()
})

// ============================================================
// POST — the stage-in-pipeline rule (spec §5.4)
// ============================================================
describe('POST /api/orgs/:orgId/deals — stage must belong to the pipeline', () => {
  it('creates a deal when the stage belongs to the pipeline', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'Acme renewal', pipelineId: 'pipe-1', stageId: 'stage-1' })

    expect(res.status).toBe(201)
    expect(res.body.deal.pipelineId).toBe('pipe-1')
    expect(res.body.deal.stageId).toBe('stage-1')
    expect(prismaMock.deal.create).toHaveBeenCalledTimes(1)
  })

  it('422s when the stage belongs to a DIFFERENT pipeline, and writes nothing', async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' })
    prismaMock.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-9', pipelineId: 'pipe-OTHER' })

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-9' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('does not belong')
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })

  it('422s when the pipeline is not in this org', async () => {
    prismaMock.pipeline.findFirst.mockResolvedValue(null)
    prismaMock.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-1', pipelineId: 'pipe-1' })

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-x', stageId: 'stage-1' })

    expect(res.status).toBe(422)
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })

  it('422s a create with no pipeline/stage', async () => {
    const res = await request(app).post(URL_A).set('Authorization', AUTH).send({ name: 'X' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('pipeline and a stage')
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })

  it('422s a create with no name', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ pipelineId: 'pipe-1', stageId: 'stage-1' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('name')
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — money is integer minor units, never a float (spec §5.8)
// ============================================================
describe('POST /api/orgs/:orgId/deals — money', () => {
  it('accepts an integer amountMinor and stores it as a BigInt', async () => {
    prismaMock.deal.create.mockResolvedValue(dealRow({ amountMinor: 123456n }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1', amountMinor: 123456 })

    expect(res.status).toBe(201)
    expect(prismaMock.deal.create.mock.calls[0][0].data.amountMinor).toBe(123456n)
    expect(res.body.deal.amountMinor).toBe('123456')
  })

  it('400s a fractional amount (dollars, not minor units), and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1', amountMinor: 12.5 })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('whole number')
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })

  it('round-trips a value beyond 2^53 exactly, with no float drift', async () => {
    // 2^53 + 1 cannot be held by a JS number without loss; the BigInt column and
    // the string mapper carry it exactly.
    const big = '9007199254740993'
    prismaMock.deal.create.mockResolvedValue(dealRow({ amountMinor: BigInt(big) }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1', amountMinor: big })

    expect(res.status).toBe(201)
    expect(prismaMock.deal.create.mock.calls[0][0].data.amountMinor).toBe(BigInt(big))
    expect(res.body.deal.amountMinor).toBe(big)
  })

  it('defaults currency to USD and validates an ISO-4217 code', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1' })
    expect(prismaMock.deal.create.mock.calls[0][0].data.currency).toBe('USD')

    const bad = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1', currency: 'dollars' })
    expect(bad.status).toBe(400)
  })
})

// ============================================================
// POST — the contract
// ============================================================
describe('POST /api/orgs/:orgId/deals', () => {
  it('writes the org from the path, never the body', async () => {
    await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1', orgId: ORG_B, id: 'attacker' })

    const data = prismaMock.deal.create.mock.calls[0][0].data
    expect(data.orgId).toBe(ORG_A)
    expect(data.id).toBeUndefined()
  })

  it('422s a companyId that is not a company in this org', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1', companyId: 'co-in-org-b' })

    expect(res.status).toBe(422)
    expect(prismaMock.company.findFirst).toHaveBeenCalledWith({
      where: { id: 'co-in-org-b', orgId: ORG_A, deletedAt: null },
    })
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// POST — org isolation (mandatory — .claude/rules/testing.md)
// ============================================================
describe('POST /api/orgs/:orgId/deals — org isolation', () => {
  it('401s without auth, and writes nothing', async () => {
    const res = await request(app)
      .post(URL_A)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1' })

    expect(res.status).toBe(401)
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })

  it('404s for an org the caller does not belong to, before it writes', async () => {
    authAs(null)

    const res = await request(app)
      .post(`/api/orgs/${ORG_B}/deals`)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1' })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Organization not found')
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })

  it('404s when the org is disabled', async () => {
    authAs(membershipRow({ org: { id: ORG_A, name: 'Org A', enabled: false } }))

    const res = await request(app)
      .post(URL_A)
      .set('Authorization', AUTH)
      .send({ name: 'X', pipelineId: 'pipe-1', stageId: 'stage-1' })

    expect(res.status).toBe(404)
    expect(prismaMock.deal.create).not.toHaveBeenCalled()
  })
})

// ============================================================
// GET — list
// ============================================================
describe('GET /api/orgs/:orgId/deals', () => {
  it('returns the org’s deals with the pagination envelope, trash excluded', async () => {
    prismaMock.deal.findMany.mockResolvedValue([dealRow({ id: 'd1' }), dealRow({ id: 'd2' })])
    prismaMock.deal.count.mockResolvedValue(2)

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.deals.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2'])
    expect(res.body.total).toBe(2)
    expect(prismaMock.deal.count).toHaveBeenCalledWith({ where: { orgId: ORG_A, deletedAt: null } })
  })

  it('filters by companyId, stageId and status', async () => {
    await request(app)
      .get(`${URL_A}?companyId=co-1&stageId=stage-2&status=won`)
      .set('Authorization', AUTH)

    expect(prismaMock.deal.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG_A,
      deletedAt: null,
      companyId: 'co-1',
      stageId: 'stage-2',
      status: 'won',
    })
  })

  it('emits amountMinor as a string, never a BigInt', async () => {
    prismaMock.deal.findMany.mockResolvedValue([dealRow({ amountMinor: 500000n })])

    const res = await request(app).get(URL_A).set('Authorization', AUTH)

    expect(res.body.deals[0].amountMinor).toBe('500000')
  })
})

// ============================================================
// GET /:id — one deal, with its person-roles
// ============================================================
describe('GET /api/orgs/:orgId/deals/:id', () => {
  it('reads by id AND orgId, and includes personRoles', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(
      dealRow({ id: 'deal-9', personRoles: [roleRow({ id: 'r1' }), roleRow({ id: 'r2', role: 'influencer' })] }),
    )

    const res = await request(app).get(`${URL_A}/deal-9`).set('Authorization', AUTH)

    expect(res.status).toBe(200)
    expect(res.body.deal.id).toBe('deal-9')
    expect(res.body.deal.personRoles.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2'])
    expect(prismaMock.deal.findFirst).toHaveBeenCalledWith({
      where: { id: 'deal-9', orgId: ORG_A, deletedAt: null },
      include: { personRoles: true },
    })
    expect(res.body.deal.orgId).toBeUndefined()
  })

  it('404s a deal that belongs to another org — never a 403', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(null)

    const res = await request(app).get(`${URL_A}/deal-in-org-b`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Deal not found')
  })
})

// ============================================================
// PATCH /:id — update, re-validating the stage on a stage/pipeline change
// ============================================================
describe('PATCH /api/orgs/:orgId/deals/:id', () => {
  it('updates via an org-scoped updateMany, never update-by-id', async () => {
    prismaMock.deal.findFirst
      .mockResolvedValueOnce(dealRow({ id: 'deal-1' })) // load current
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', name: 'Renamed' })) // re-read

    const res = await request(app)
      .patch(`${URL_A}/deal-1`)
      .set('Authorization', AUTH)
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    expect(prismaMock.deal.update).not.toHaveBeenCalled()
    expect(prismaMock.deal.updateMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.deal.updateMany.mock.calls[0][0].where).toEqual({
      id: 'deal-1',
      orgId: ORG_A,
      deletedAt: null,
    })
  })

  it('merge-patches one custom value without losing existing values', async () => {
    prismaMock.deal.findFirst
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', customJson: { legacy: 'keep' } }))
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', customJson: { legacy: 'keep', website: 'https://maincar.com' } }))
    const res = await request(app).patch(`${URL_A}/deal-1`).set('Authorization', AUTH).send({ customValues: { website: 'https://maincar.com' } })
    expect(res.status).toBe(200)
    expect(prismaMock.deal.updateMany.mock.calls[0][0].data.customJson).toEqual({ legacy: 'keep', website: 'https://maincar.com' })
  })

  it('422s moving to a stage outside the deal’s pipeline', async () => {
    prismaMock.deal.findFirst.mockResolvedValueOnce(dealRow({ id: 'deal-1', pipelineId: 'pipe-1' }))
    prismaMock.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' })
    prismaMock.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-Z', pipelineId: 'pipe-OTHER' })

    const res = await request(app)
      .patch(`${URL_A}/deal-1`)
      .set('Authorization', AUTH)
      .send({ stageId: 'stage-Z' })

    expect(res.status).toBe(422)
    expect(res.body.error).toContain('does not belong')
    expect(prismaMock.deal.updateMany).not.toHaveBeenCalled()
  })

  it('writes a stage-change timeline row in the same transaction as the deal update', async () => {
    prismaMock.deal.findFirst
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', stageId: 'stage-1', updatedAt: NOW }))
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', stageId: 'stage-2' }))
    prismaMock.pipelineStage.findFirst
      .mockResolvedValueOnce({ id: 'stage-2', pipelineId: 'pipe-1' })
      .mockResolvedValueOnce({ id: 'stage-1', name: 'Discovery' })
      .mockResolvedValueOnce({ id: 'stage-2', name: 'Proposal' })

    const res = await request(app)
      .patch(`${URL_A}/deal-1`)
      .set('Authorization', AUTH)
      .send({ stageId: 'stage-2' })

    expect(res.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.deal.updateMany).toHaveBeenCalledWith({
      where: { id: 'deal-1', orgId: ORG_A, deletedAt: null },
      data: { stageId: 'stage-2' },
    })
    expect(prismaMock.fieldHistory.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          orgId: ORG_A,
          objectSlug: 'deal',
          recordId: 'deal-1',
          attribute: 'stageId',
          oldJson: 'stage-1',
          newJson: 'stage-2',
          changedByUserId: 'user-a',
          changeSource: 'user',
        }),
      ],
    })
    const upsert = prismaMock.activityEntry.upsert.mock.calls[0][0]
    expect(upsert.create).toMatchObject({
      sourceType: 'stage_change',
      summary: 'Moved Acme renewal from Discovery to Proposal',
      createdByUserId: 'user-a',
      dealId: 'deal-1',
      timelineTitle: 'Moved Acme renewal to Proposal',
      timelineSubtype: 'stage_changed',
      timelineMarker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
    })
  })

  it('clears amountMinor to NULL when sent empty, and writes a BigInt when set', async () => {
    prismaMock.deal.findFirst
      .mockResolvedValueOnce(dealRow({ id: 'deal-1' }))
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', amountMinor: null }))

    await request(app).patch(`${URL_A}/deal-1`).set('Authorization', AUTH).send({ amountMinor: '' })
    expect(prismaMock.deal.updateMany.mock.calls[0][0].data.amountMinor).toBeNull()

    vi.clearAllMocks()
    authAs()
    stageBelongs()
    prismaMock.deal.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.deal.findFirst
      .mockResolvedValueOnce(dealRow({ id: 'deal-1' }))
      .mockResolvedValueOnce(dealRow({ id: 'deal-1', amountMinor: 999n }))
    await request(app).patch(`${URL_A}/deal-1`).set('Authorization', AUTH).send({ amountMinor: 999 })
    expect(prismaMock.deal.updateMany.mock.calls[0][0].data.amountMinor).toBe(999n)
  })

  it('404s an update to a deal in another org', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .patch(`${URL_A}/deal-in-org-b`)
      .set('Authorization', AUTH)
      .send({ name: 'x' })

    expect(res.status).toBe(404)
    expect(prismaMock.deal.updateMany).not.toHaveBeenCalled()
  })
})

// ============================================================
// DELETE /:id — soft-delete into the trash
// ============================================================
describe('DELETE /api/orgs/:orgId/deals/:id', () => {
  it('soft-deletes via an org-scoped updateMany and answers 204', async () => {
    prismaMock.deal.updateMany.mockResolvedValue({ count: 1 })

    const res = await request(app).delete(`${URL_A}/deal-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.deal.delete).not.toHaveBeenCalled()
    expect(prismaMock.deal.deleteMany).not.toHaveBeenCalled()
    const call = prismaMock.deal.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'deal-1', orgId: ORG_A, deletedAt: null })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
    expect(call.data.deletedById).toBe('user-a')
  })

  it('404s deleting a deal that is already trashed or in another org', async () => {
    prismaMock.deal.updateMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/deal-gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
  })
})

// ============================================================
// Roles — the buying committee (DealPersonRole)
// ============================================================
describe('POST /api/orgs/:orgId/deals/:id/roles', () => {
  it('attaches a person to the deal and returns 201', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-1' }))
    prismaMock.dealPersonRole.upsert.mockResolvedValue(roleRow({ id: 'role-1', role: 'champion' }))

    const res = await request(app)
      .post(`${URL_A}/deal-1/roles`)
      .set('Authorization', AUTH)
      .send({ personId: 'person-1', role: 'champion' })

    expect(res.status).toBe(201)
    expect(res.body.role.role).toBe('champion')
    expect(prismaMock.dealPersonRole.upsert.mock.calls[0][0].where).toEqual({
      dealId_personId: { dealId: 'deal-1', personId: 'person-1' },
    })
  })

  it('lets the SAME person hold DIFFERENT roles on DIFFERENT deals', async () => {
    // Deal A: champion.
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-A' }))
    prismaMock.dealPersonRole.upsert.mockResolvedValue(roleRow({ dealId: 'deal-A', role: 'champion' }))
    const a = await request(app)
      .post(`${URL_A}/deal-A/roles`)
      .set('Authorization', AUTH)
      .send({ personId: 'person-1', role: 'champion' })
    expect(a.status).toBe(201)

    // Deal B: the same person, a different role.
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-B' }))
    prismaMock.dealPersonRole.upsert.mockResolvedValue(roleRow({ dealId: 'deal-B', role: 'influencer' }))
    const b = await request(app)
      .post(`${URL_A}/deal-B/roles`)
      .set('Authorization', AUTH)
      .send({ personId: 'person-1', role: 'influencer' })
    expect(b.status).toBe(201)
    expect(b.body.role.role).toBe('influencer')

    // Each write is keyed on its own (dealId, personId), so nothing collides.
    expect(prismaMock.dealPersonRole.upsert.mock.calls[0][0].where.dealId_personId.dealId).toBe('deal-A')
    expect(prismaMock.dealPersonRole.upsert.mock.calls[1][0].where.dealId_personId.dealId).toBe('deal-B')
  })

  it('422s a role for a person who is not in this org', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-1' }))
    prismaMock.person.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(`${URL_A}/deal-1/roles`)
      .set('Authorization', AUTH)
      .send({ personId: 'person-x', role: 'champion' })

    expect(res.status).toBe(422)
    expect(prismaMock.dealPersonRole.upsert).not.toHaveBeenCalled()
  })

  it('400s an unknown role value', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-1' }))

    const res = await request(app)
      .post(`${URL_A}/deal-1/roles`)
      .set('Authorization', AUTH)
      .send({ personId: 'person-1', role: 'ceo' })

    expect(res.status).toBe(400)
    expect(prismaMock.dealPersonRole.upsert).not.toHaveBeenCalled()
  })

  it('404s adding a role to a deal in another org, before it writes', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(null)

    const res = await request(app)
      .post(`${URL_A}/deal-in-org-b/roles`)
      .set('Authorization', AUTH)
      .send({ personId: 'person-1', role: 'champion' })

    expect(res.status).toBe(404)
    expect(prismaMock.dealPersonRole.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/orgs/:orgId/deals/:id/roles/:roleId', () => {
  it('removes a role via an org-scoped deleteMany and answers 204', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-1' }))
    prismaMock.dealPersonRole.deleteMany.mockResolvedValue({ count: 1 })

    const res = await request(app).delete(`${URL_A}/deal-1/roles/role-1`).set('Authorization', AUTH)

    expect(res.status).toBe(204)
    expect(prismaMock.dealPersonRole.delete).not.toHaveBeenCalled()
    expect(prismaMock.dealPersonRole.deleteMany).toHaveBeenCalledWith({
      where: { id: 'role-1', dealId: 'deal-1', orgId: ORG_A },
    })
  })

  it('404s removing a role that does not exist on this deal', async () => {
    prismaMock.deal.findFirst.mockResolvedValue(dealRow({ id: 'deal-1' }))
    prismaMock.dealPersonRole.deleteMany.mockResolvedValue({ count: 0 })

    const res = await request(app).delete(`${URL_A}/deal-1/roles/role-gone`).set('Authorization', AUTH)

    expect(res.status).toBe(404)
  })
})
