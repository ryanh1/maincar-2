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
  }, 60_000)

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

    // A field the compiler deliberately excludes (record_reference) is a clean 400,
    // not a silently-wrong match over its serialized JSON.
    const unfilterable = await request(app)
      .post(`/api/orgs/${orgId}/objects/${personObject.id}/list`)
      .set('Authorization', as(adminFirebaseUid))
      .send({ filter: { type: 'condition', field: 'companyId', operator: 'eq', value: 'x' } })
    expect(unfilterable.status).toBe(400)
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
})
