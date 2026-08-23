// An integration test against a REAL Postgres schema (see vitest.integration.config.ts
// and src/test/integration/*), for MAI-163's data plane: POST /:id/list.
//
// The mocked suite cannot prove this feature at all — it is built entirely on raw
// SQL ($queryRaw), so a mocked Prisma client would just be told what to return. This
// file proves, against real rows and the real JSONB/typed columns:
//   - 50k rows on a "record"-storage (custom) object page correctly in ~150-row
//     cursor chunks, with no row skipped or repeated across a run of pages;
//   - a sort change re-windows (first page differs, orders correctly) without
//     walking the whole set;
//   - a filter's totalCount is exact against a known subset;
//   - the SAME endpoint works over table-storage standard objects with customJson,
//     including Call, so the raw query cannot assume a column that its schema lacks.
// Run with `npm run test:integration`, with Docker up.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
  revokeFirebaseRefreshTokens: vi.fn(),
}))

// Same seam as guardrails.integration.test.ts: replace the app's Prisma singleton
// so the real route code runs, unmodified, against this run's isolated schema.
vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')

  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  url.searchParams.set('options', `-c search_path=${schema},public`)

  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema })
  return { default: new PrismaClient({ adapter }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'
import type { Prisma } from '../../generated/prisma/client.js'

function as(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

beforeAll(() => {
  verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/orgs/:orgId/objects/:id/list (integration, real Postgres)', () => {
  // A custom (record-backed) object with a numeric field and a select field, so
  // sort/filter can be proven on both a real typed cast and an equality match.
  async function seedWidgetObject(orgId: string): Promise<string> {
    const obj = await prisma.objectDef.create({
      data: { orgId, slug: `widget_${Date.now()}`, name: 'Widget', namePlural: 'Widgets', storage: 'record', isStandard: false },
    })
    await prisma.attributeDef.createMany({
      data: [
        { orgId, objectId: obj.id, slug: 'name', name: 'Name', type: 'text', storage: 'custom', sortOrder: 0 },
        { orgId, objectId: obj.id, slug: 'rank', name: 'Rank', type: 'number', storage: 'custom', sortOrder: 1 },
        {
          orgId,
          objectId: obj.id,
          slug: 'status',
          name: 'Status',
          type: 'select',
          storage: 'custom',
          sortOrder: 2,
          optionsJson: [
            { value: 'active', label: 'Active', isArchived: false },
            { value: 'done', label: 'Done', isArchived: false },
          ] as unknown as Prisma.InputJsonValue,
        },
      ],
    })
    return obj.id
  }

  it('paginates 50k rows in cursor chunks, re-windows on a sort change, and reports an exact filtered count', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma)
    const objectId = await seedWidgetObject(orgId)

    const TOTAL = 50_000
    const ACTIVE_COUNT = 20_000 // rank < 20000 gets status "active"; the rest "done"
    const BATCH = 2_000
    for (let start = 0; start < TOTAL; start += BATCH) {
      const data = Array.from({ length: Math.min(BATCH, TOTAL - start) }, (_, i) => {
        const rank = start + i
        return {
          orgId,
          objectId,
          valuesJson: {
            name: `Widget ${rank}`,
            rank,
            status: rank < ACTIVE_COUNT ? 'active' : 'done',
          } as unknown as Prisma.InputJsonValue,
        }
      })
      await prisma.record.createMany({ data })
    }

    // --- totalCount is exact for the whole object, unfiltered ---
    const firstPage = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ sort: { field: 'rank', direction: 'asc' }, limit: 150 })
    expect(firstPage.status).toBe(200)
    expect(firstPage.body.totalCount).toBe(TOTAL)
    expect(firstPage.body.rows).toHaveLength(150)
    expect(firstPage.body.rows[0].rank).toBe(0)
    expect(firstPage.body.rows[149].rank).toBe(149)
    expect(firstPage.body.nextCursor).toBeTruthy()

    // --- cursor-chunked windows: walk a few pages, prove no gap/repeat/reload ---
    let cursor: string = firstPage.body.nextCursor
    let expectedRank = 150
    for (let page = 0; page < 5; page++) {
      const res = await request(app)
        .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
        .set('Authorization', as(adminFirebaseUid))
        .send({ sort: { field: 'rank', direction: 'asc' }, cursor, limit: 150 })
      expect(res.status).toBe(200)
      expect(res.body.rows).toHaveLength(150)
      for (const row of res.body.rows) {
        expect(row.rank).toBe(expectedRank)
        expectedRank += 1
      }
      cursor = res.body.nextCursor
      expect(cursor).toBeTruthy()
    }

    // --- sort change re-windows without a full load: desc gives a fresh, different first page ---
    const descPage = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ sort: { field: 'rank', direction: 'desc' }, limit: 150 })
    expect(descPage.status).toBe(200)
    expect(descPage.body.rows[0].rank).toBe(TOTAL - 1)
    expect(descPage.body.rows[149].rank).toBe(TOTAL - 150)

    // --- filtered count is exact ---
    const filtered = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ filter: { type: 'condition', field: 'status', operator: 'eq', value: 'active' }, limit: 150 })
    expect(filtered.status).toBe(200)
    expect(filtered.body.totalCount).toBe(ACTIVE_COUNT)
    expect(filtered.body.rows.every((r: { status: string }) => r.status === 'active')).toBe(true)

    // --- a filter tree (AND group) narrows further, still exact ---
    const anded = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({
        filter: {
          type: 'group',
          op: 'and',
          children: [
            { type: 'condition', field: 'status', operator: 'eq', value: 'active' },
            { type: 'condition', field: 'rank', operator: 'lt', value: 100 },
          ],
        },
        limit: 150,
      })
    expect(anded.status).toBe(200)
    expect(anded.body.totalCount).toBe(100)

    // --- grouped descriptors are aggregated in Postgres over the full filtered
    // set, while the row window stays at the requested page size ---
    const grouped = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({
        groupBy: ['status'],
        filter: { type: 'condition', field: 'rank', operator: 'lt', value: 1_100 },
        sort: { field: 'rank', direction: 'desc' },
        limit: 50,
      })
    expect(grouped.status).toBe(200)
    expect(grouped.body.rows).toHaveLength(50)
    expect(grouped.body.totalCount).toBe(1_100)
    expect(grouped.body.groups).toEqual([
      { key: '["active"]', value: 'active', count: 1_100, sum: { rank: '604450' }, avg: { rank: '549.5' } },
    ])
  }, 60_000)

  it('returns counted related rails without changing the root record query', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma)
    const objects = await Promise.all([
      prisma.objectDef.create({ data: { orgId, slug: 'company', name: 'Company', namePlural: 'Companies', storage: 'record', isStandard: false } }),
      prisma.objectDef.create({ data: { orgId, slug: 'person', name: 'Person', namePlural: 'People', storage: 'record', isStandard: false } }),
      prisma.objectDef.create({ data: { orgId, slug: 'deal', name: 'Deal', namePlural: 'Deals', storage: 'record', isStandard: false } }),
    ])
    const [company, person, deal] = objects
    const personCompany = await prisma.attributeDef.create({ data: { orgId, objectId: person.id, slug: 'company', name: 'Company', type: 'record_reference', storage: 'custom', refObjectId: company.id } })
    const dealCompany = await prisma.attributeDef.create({ data: { orgId, objectId: deal.id, slug: 'company', name: 'Company', type: 'record_reference', storage: 'custom', refObjectId: company.id } })
    await Promise.all([
      prisma.attributeDef.create({ data: { orgId, objectId: company.id, slug: 'name', name: 'Name', type: 'text', storage: 'custom', isIdentity: true } }),
      prisma.attributeDef.create({ data: { orgId, objectId: person.id, slug: 'name', name: 'Name', type: 'text', storage: 'custom', isIdentity: true } }),
      prisma.attributeDef.create({ data: { orgId, objectId: deal.id, slug: 'name', name: 'Name', type: 'text', storage: 'custom', isIdentity: true } }),
    ])
    const companyRecord = await prisma.record.create({ data: { orgId, objectId: company.id, valuesJson: { name: 'Acme' } } })
    const personRecord = await prisma.record.create({ data: { orgId, objectId: person.id, valuesJson: { name: 'Dana', company: companyRecord.id } } })
    const dealRecord = await prisma.record.create({ data: { orgId, objectId: deal.id, valuesJson: { name: 'Renewal', company: companyRecord.id } } })
    await prisma.recordLink.createMany({ data: [
      { orgId, fromObject: 'record', fromId: personRecord.id, attribute: personCompany.slug, toObject: 'company', toId: companyRecord.id },
      { orgId, fromObject: 'record', fromId: dealRecord.id, attribute: dealCompany.slug, toObject: 'company', toId: companyRecord.id },
    ] })

    const companyRail = await request(app)
      .get(`/api/orgs/${orgId}/objects/${company.id}/records/${companyRecord.id}/related`)
      .set('Authorization', as(adminFirebaseUid))
    expect(companyRail.status).toBe(200)
    expect(companyRail.body.related).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'People', count: 1, records: [expect.objectContaining({ id: personRecord.id })] }),
      expect.objectContaining({ label: 'Deals', count: 1, records: [expect.objectContaining({ id: dealRecord.id })] }),
    ]))

    const personRail = await request(app)
      .get(`/api/orgs/${orgId}/objects/${person.id}/records/${personRecord.id}/related`)
      .set('Authorization', as(adminFirebaseUid))
    expect(personRail.status).toBe(200)
    expect(personRail.body.related).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Company', count: 1 }),
      expect.objectContaining({ label: 'Deals', count: 1, records: [expect.objectContaining({ id: dealRecord.id })] }),
    ]))
  })

  it('rejects an unknown filter field and an unsupported operator with 400', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma)
    const objectId = await seedWidgetObject(orgId)

    const badField = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ filter: { type: 'condition', field: 'not_a_real_field', operator: 'eq', value: 'x' } })
    expect(badField.status).toBe(400)

    const badOperator = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ filter: { type: 'condition', field: 'rank', operator: 'contains', value: '1' } })
    expect(badOperator.status).toBe(400)
  })

  it('combines absent and empty text values into one no-value section', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma)
    const objectId = await seedWidgetObject(orgId)
    await prisma.record.createMany({
      data: [
        { orgId, objectId, valuesJson: { name: 'Present', status: 'active' } as unknown as Prisma.InputJsonValue },
        { orgId, objectId, valuesJson: { name: 'Empty', status: '' } as unknown as Prisma.InputJsonValue },
        { orgId, objectId, valuesJson: { name: 'Absent' } as unknown as Prisma.InputJsonValue },
      ],
    })

    const res = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ groupBy: ['status'] })

    expect(res.status).toBe(200)
    expect(res.body.groups).toEqual([
      { key: '["active"]', value: 'active', count: 1 },
      { key: '[null]', value: '(No value)', count: 2 },
    ])
  })

  it('orders by every sort level and keeps the next cursor stable across a page boundary', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma)
    const objectId = await seedWidgetObject(orgId)

    const rows = Array.from({ length: 51 }, (_, index) => ({
      orgId,
      objectId,
      valuesJson: {
        name: `Widget ${String(index).padStart(2, '0')}`,
        rank: index < 2 ? 1 : index === 50 ? null : 2,
        status: index === 0 ? 'done' : 'active',
      } as unknown as Prisma.InputJsonValue,
    }))
    await prisma.record.createMany({ data: rows })

    const sort = [
      { field: 'rank', direction: 'asc' },
      { field: 'status', direction: 'asc' },
    ]
    const firstPage = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ sort, limit: 50 })

    expect(firstPage.status).toBe(200)
    expect(firstPage.body.rows).toHaveLength(50)
    expect(firstPage.body.rows.slice(0, 2).map((row: { rank: number; status: string }) => [row.rank, row.status])).toEqual([
      [1, 'active'],
      [1, 'done'],
    ])
    expect(firstPage.body.nextCursor).toBeTruthy()

    const secondPage = await request(app)
      .post(`/api/orgs/${orgId}/objects/${objectId}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ sort, cursor: firstPage.body.nextCursor, limit: 50 })

    expect(secondPage.status).toBe(200)
    expect(secondPage.body.rows).toHaveLength(1)
    expect(secondPage.body.rows[0]).toMatchObject({ rank: null, status: 'active', name: 'Widget 50' })
    expect(secondPage.body.nextCursor).toBeNull()
  })

  it('works over a "table"-storage standard object (Person: typed columns + customJson)', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma, { seed: true })
    const personObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'person' } })

    // firstName/attentionStatus are real columns; x_url is a seeded custom field
    // living in customJson (standardObjects.ts) — exercise both in one filter.
    await prisma.person.createMany({
      data: [
        { orgId, firstName: 'Alice', ownerUserId: 'owner-a', attentionStatus: 'on_deck', customJson: { x_url: 'https://x.com/alice' } },
        { orgId, firstName: 'Bob', ownerUserId: 'owner-b', attentionStatus: 'on_hold', customJson: {} },
        { orgId, firstName: 'Carol', ownerUserId: 'owner-a', attentionStatus: 'on_deck', customJson: { x_url: 'https://x.com/carol' } },
      ],
    })

    const res = await request(app)
      .post(`/api/orgs/${orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({
        filter: { type: 'condition', field: 'attentionStatus', operator: 'eq', value: 'on_deck' },
        sort: { field: 'firstName', direction: 'asc' },
      })
    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(2)
    expect(res.body.rows.map((r: { firstName: string }) => r.firstName)).toEqual(['Alice', 'Carol'])
    expect(res.body.rows[0].x_url).toBe('https://x.com/alice')

    // A report drill uses the same grid endpoint. Owner is a stored user id, so
    // its exact value must be a usable server-side filter rather than forcing a
    // client-side, incomplete subset.
    const ownerFiltered = await request(app)
      .post(`/api/orgs/${orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ filter: { type: 'condition', field: 'ownerUserId', operator: 'eq', value: 'owner-a' } })
    expect(ownerFiltered.status).toBe(200)
    expect(ownerFiltered.body.totalCount).toBe(2)
    expect(ownerFiltered.body.rows.map((row: { firstName: string }) => row.firstName).sort()).toEqual(['Alice', 'Carol'])

    // Grouping is allowed on a scalar record reference even though filtering it
    // remains deliberately unsupported, and absent values have a visible section.
    const groupedByCompany = await request(app)
      .post(`/api/orgs/${orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ groupBy: ['companyId'], sort: { field: 'firstName', direction: 'asc' } })
    expect(groupedByCompany.status).toBe(200)
    expect(groupedByCompany.body.groups).toEqual([
      { key: '[null]', value: '(No value)', count: 3 },
    ])

    // A field the compiler deliberately excludes (record_reference) is a clean 400,
    // not a silently-wrong match over its serialized JSON.
    const unfilterable = await request(app)
      .post(`/api/orgs/${orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ filter: { type: 'condition', field: 'companyId', operator: 'eq', value: 'x' } })
    expect(unfilterable.status).toBe(400)
  })

  it('groups table-storage Deals by Stage, returning exact currency aggregates and a second level', async () => {
    const { orgId, adminFirebaseUid } = await seedOrgWithAdmin(prisma, { seed: true })
    const dealObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'deal' } })
    const pipeline = await prisma.pipeline.create({ data: { orgId, name: 'New Business', isDefault: true } })
    const [discovery, proposal] = await Promise.all([
      prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: 'Discovery', sortOrder: 1 } }),
      prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: 'Proposal', sortOrder: 2 } }),
    ])
    await prisma.deal.createMany({
      data: [
        { orgId, name: 'Alpha', pipelineId: pipeline.id, stageId: discovery.id, amountMinor: 180_000n },
        { orgId, name: 'Bravo', pipelineId: pipeline.id, stageId: discovery.id, amountMinor: 300_000n },
        { orgId, name: 'Charlie', pipelineId: pipeline.id, stageId: proposal.id, amountMinor: 100_000n },
      ],
    })

    const res = await request(app)
      .post(`/api/orgs/${orgId}/objects/${dealObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ groupBy: ['status', 'stageId'], sort: { field: 'name', direction: 'asc' }, limit: 50 })

    expect(res.status).toBe(200)
    expect(res.body.rows).toHaveLength(3)
    expect(res.body.groups).toMatchObject([
      {
        key: '["open"]',
        value: 'open',
        count: 3,
        sum: { amountMinor: '580000' },
        avg: { amountMinor: '193333.333333333333' },
      },
    ])
    expect(res.body.groups[0].children).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: `["open","${discovery.id}"]`, count: 2, sum: { amountMinor: '480000' } }),
      expect.objectContaining({ key: `["open","${proposal.id}"]`, count: 1, sum: { amountMinor: '100000' } }),
    ]))
  })

  it('works over Call, which also has the table-storage customJson bag', async () => {
    const { orgId, adminFirebaseUid, adminUserId } = await seedOrgWithAdmin(prisma, { seed: true })
    const callObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId, slug: 'call' } })
    const call = await prisma.call.create({
      data: {
        orgId,
        userId: adminUserId,
        fromE164: '+12025550100',
        toE164: '+12025550101',
        direction: 'outbound',
        customJson: { disposition: 'Demo booked' },
      },
    })

    const res = await request(app)
      .post(`/api/orgs/${orgId}/objects/${callObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(1)
    expect(res.body.rows[0].id).toBe(call.id)
  })

  it('uses the live, deduplicating Team scope for owner-backed rows, counts, and pages only', async () => {
    const org = await seedOrgWithAdmin(prisma, { seed: true })
    const jordan = await seedMember(prisma, org.orgId)
    const personObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId: org.orgId, slug: 'person' } })
    const callObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId: org.orgId, slug: 'call' } })

    const revenue = await prisma.team.create({
      data: {
        orgId: org.orgId,
        name: 'Revenue',
        leadUserId: jordan.userId,
        members: { create: [{ orgId: org.orgId, userId: jordan.userId }, { orgId: org.orgId, userId: org.adminUserId }] },
      },
    })
    await prisma.team.create({
      data: {
        orgId: org.orgId,
        name: 'Outbound',
        leadUserId: jordan.userId,
        members: { create: [{ orgId: org.orgId, userId: jordan.userId }] },
      },
    })
    const empty = await prisma.team.create({ data: { orgId: org.orgId, name: 'Empty', leadUserId: jordan.userId } })
    const [jordanPerson, adminPerson] = await Promise.all([
      prisma.person.create({ data: { orgId: org.orgId, firstName: 'Jordan', ownerUserId: jordan.userId } }),
      prisma.person.create({ data: { orgId: org.orgId, firstName: 'Avery', ownerUserId: org.adminUserId } }),
    ])
    await prisma.person.create({ data: { orgId: org.orgId, firstName: 'Unassigned' } })

    const specific = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ teamScope: { teamIds: [revenue.id] } })
    expect(specific.status).toBe(200)
    expect(specific.body.totalCount).toBe(2)
    expect(specific.body.rows.map((row: { id: string }) => row.id).sort()).toEqual([adminPerson.id, jordanPerson.id].sort())

    const ledByJordan = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ teamScope: { leadUserIds: [jordan.userId] } })
    expect(ledByJordan.status).toBe(200)
    expect(ledByJordan.body.totalCount).toBe(2)
    expect(new Set(ledByJordan.body.rows.map((row: { id: string }) => row.id)).size).toBe(2)

    await prisma.team.updateMany({ where: { id: revenue.id, orgId: org.orgId }, data: { leadUserId: org.adminUserId } })
    const liveLead = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ teamScope: { leadUserIds: [jordan.userId] } })
    expect(liveLead.status).toBe(200)
    expect(liveLead.body.totalCount).toBe(1)
    expect(liveLead.body.rows[0].id).toBe(jordanPerson.id)

    const emptyTeam = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ teamScope: { teamIds: [empty.id] } })
    expect(emptyTeam.status).toBe(200)
    expect(emptyTeam.body).toMatchObject({ rows: [], totalCount: 0, nextCursor: null })

    const unsupported = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${callObject.id}/list`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ teamScope: { teamIds: [revenue.id] } })
    expect(unsupported.status).toBe(400)
  })

  it('runs export, add-to-list, delete, and owner-change actions from compact selections', async () => {
    const org = await seedOrgWithAdmin(prisma, { seed: true })
    const objectId = await seedWidgetObject(org.orgId)
    const object = await prisma.objectDef.findFirstOrThrow({ where: { id: objectId, orgId: org.orgId } })
    const [activeOne, activeTwo, done] = await Promise.all([
      prisma.record.create({ data: { orgId: org.orgId, objectId, valuesJson: { name: 'One', rank: 1, status: 'active' } } }),
      prisma.record.create({ data: { orgId: org.orgId, objectId, valuesJson: { name: 'Two', rank: 2, status: 'active' } } }),
      prisma.record.create({ data: { orgId: org.orgId, objectId, valuesJson: { name: 'Three', rank: 3, status: 'done' } } }),
    ])
    const list = await prisma.list.create({ data: { orgId: org.orgId, name: 'Priority widgets', slug: `priority-widgets-${Date.now()}`, objectSlug: object.slug } })
    const activeSelection = { mode: 'filter', filter: { type: 'condition', field: 'status', operator: 'eq', value: 'active' } }

    const exported = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${objectId}/bulk`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ selection: activeSelection, action: { type: 'export' } })
    expect(exported.status).toBe(200)
    expect(exported.body.totalCount).toBe(2)
    expect(exported.body.rows.map((row: { id: string }) => row.id).sort()).toEqual([activeOne.id, activeTwo.id].sort())

    const added = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${objectId}/bulk`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ selection: activeSelection, action: { type: 'addToList', listId: list.id } })
    expect(added.status).toBe(200)
    expect(added.body.affectedCount).toBe(2)
    expect((await prisma.listEntry.findMany({ where: { orgId: org.orgId, listId: list.id } })).map((entry) => entry.targetId).sort()).toEqual([activeOne.id, activeTwo.id].sort())

    const deleted = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${objectId}/bulk`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ selection: activeSelection, action: { type: 'delete' } })
    expect(deleted.status).toBe(200)
    expect(deleted.body.affectedCount).toBe(2)
    expect((await prisma.record.findFirstOrThrow({ where: { id: done.id, orgId: org.orgId } })).deletedAt).toBeNull()
    expect((await prisma.record.findFirstOrThrow({ where: { id: activeOne.id, orgId: org.orgId } })).deletedAt).not.toBeNull()

    const personObject = await prisma.objectDef.findFirstOrThrow({ where: { orgId: org.orgId, slug: 'person' } })
    const owner = await seedMember(prisma, org.orgId)
    const person = await prisma.person.create({ data: { orgId: org.orgId, firstName: 'Ada' } })
    const ownerChanged = await request(app)
      .post(`/api/orgs/${org.orgId}/objects/${personObject.id}/bulk`)
      .set('Authorization', as(org.adminFirebaseUid))
      .send({ selection: { mode: 'ids', ids: [person.id] }, action: { type: 'changeOwner', ownerUserId: owner.userId } })
    expect(ownerChanged.status).toBe(200)
    expect(ownerChanged.body.affectedCount).toBe(1)
    expect((await prisma.person.findFirstOrThrow({ where: { id: person.id, orgId: org.orgId } })).ownerUserId).toBe(owner.userId)
  })
})
