// MAI-143's reporting path against a real PostgreSQL schema. The unit test
// proves the response contract; this proves that the registry/compiler query
// returns the hand-checked total and cannot read another org's Deals.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }))

vi.mock('../../../dependencies/firebaseAdmin.js', () => ({
  verifyFirebaseIdToken: verifyTokenMock,
  setFirebaseUserDisabled: vi.fn(),
  deleteFirebaseUser: vi.fn(),
}))

vi.mock('../../db.js', async () => {
  const { inject } = await import('vitest')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('../../generated/prisma/client.js')

  const schema = inject('testSchema')
  const url = new URL(inject('testDatabaseUrl'))
  // Raw report SQL needs the session search path, while Prisma-generated
  // membership queries use the adapter schema option.
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return { default: new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) }) }
})

import app from '../../app.js'
import prisma from '../../db.js'
import { seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

const CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

const VIEWER_DAY_CONFIG = {
  ...CONFIG,
  timeZone: { mode: 'viewer' },
  timeBucket: { field: 'createdAt', grain: 'day' },
}

const ACTIVITY_GRID_CONFIG = {
  baseObject: 'activity',
  rows: [{ field: 'sourceType' }],
  values: [{ field: 'id', aggregation: 'count' }],
  timeZone: { mode: 'viewer' },
  timeBucket: { field: 'occurredAt', grain: 'week' },
}

function authorization(firebaseUid: string): string {
  return `Bearer ${firebaseUid}`
}

async function createPipelineAndStages(orgId: string) {
  const pipeline = await prisma.pipeline.create({ data: { orgId, name: 'Sales' } })
  const [discovery, proposal] = await Promise.all([
    prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: 'Discovery', sortOrder: 1 } }),
    prisma.pipelineStage.create({ data: { orgId, pipelineId: pipeline.id, name: 'Proposal', sortOrder: 2 } }),
  ])
  return { pipeline, discovery, proposal }
}

describe('POST /api/orgs/:orgId/reports/run (integration)', () => {
  beforeAll(() => {
    verifyTokenMock.mockImplementation(async (idToken: string) => ({ uid: idToken }))
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns the hand-checked Deals total by stage and excludes another org', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const { pipeline, discovery, proposal } = await createPipelineAndStages(orgA.orgId)
    await prisma.deal.createMany({
      data: [
        { orgId: orgA.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'A', amountMinor: 1200n },
        { orgId: orgA.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'B', amountMinor: 2300n },
        { orgId: orgA.orgId, pipelineId: pipeline.id, stageId: proposal.id, name: 'C', amountMinor: 9000n },
      ],
    })

    const orgB = await seedOrgWithAdmin(prisma)
    const other = await createPipelineAndStages(orgB.orgId)
    await prisma.deal.create({
      data: { orgId: orgB.orgId, pipelineId: other.pipeline.id, stageId: other.discovery.id, name: 'Foreign', amountMinor: 999999n },
    })

    const response = await request(app)
      .post(`/api/orgs/${orgA.orgId}/reports/run`)
      .set('Authorization', authorization(orgA.adminFirebaseUid))
      .send({ config: CONFIG })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { stageId: discovery.id, stageName: 'Discovery', amountMinor: '3500' },
      { stageId: proposal.id, stageName: 'Proposal', amountMinor: '9000' },
    ])
    // 1,200 + 2,300 + 9,000 = 12,500. This assertion names the arithmetic so
    // the fixture remains a human-auditable correctness check, not just a copy
    // of the implementation's grouped output.
    expect(response.body.report.rows.reduce((sum: bigint, row: { amountMinor: string }) => sum + BigInt(row.amountMinor), 0n))
      .toBe(12500n)
  })

  it('counts calls, emails, and meetings in their viewer-local week and excludes other activity', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    await prisma.user.update({ where: { id: orgA.adminUserId }, data: { timeZone: 'America/New_York' } })
    const orgB = await seedOrgWithAdmin(prisma)

    await prisma.activityEntry.createMany({
      data: [
        {
          orgId: orgA.orgId, sourceType: 'call', sourceId: 'call-week-one', summary: 'Called', timelineTitle: 'Called',
          occurredAt: new Date('2026-08-17T12:00:00.000Z'),
        },
        {
          orgId: orgA.orgId, sourceType: 'email', sourceId: 'email-week-one', summary: 'Emailed', timelineTitle: 'Emailed',
          occurredAt: new Date('2026-08-23T23:00:00.000Z'),
        },
        {
          // This Monday UTC instant is still Sunday evening in New York, so it
          // belongs in the first local-week bucket rather than the following one.
          orgId: orgA.orgId, sourceType: 'meeting', sourceId: 'meeting-week-one', summary: 'Met', timelineTitle: 'Met',
          occurredAt: new Date('2026-08-24T00:30:00.000Z'),
        },
        {
          orgId: orgA.orgId, sourceType: 'call', sourceId: 'call-week-two', summary: 'Called', timelineTitle: 'Called',
          occurredAt: new Date('2026-08-24T12:00:00.000Z'),
        },
        {
          orgId: orgA.orgId, sourceType: 'note', sourceId: 'note-is-not-an-event-metric', summary: 'Not counted', timelineTitle: 'Not counted',
          occurredAt: new Date('2026-08-20T12:00:00.000Z'),
        },
        {
          orgId: orgB.orgId, sourceType: 'call', sourceId: 'foreign-call', summary: 'Foreign', timelineTitle: 'Foreign',
          occurredAt: new Date('2026-08-17T12:00:00.000Z'),
        },
      ],
    })

    const response = await request(app)
      .post(`/api/orgs/${orgA.orgId}/reports/run`)
      .set('Authorization', authorization(orgA.adminFirebaseUid))
      .send({ config: ACTIVITY_GRID_CONFIG })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { weekStart: '2026-08-17', sourceType: 'call', count: '1' },
      { weekStart: '2026-08-17', sourceType: 'email', count: '1' },
      { weekStart: '2026-08-17', sourceType: 'meeting', count: '1' },
      { weekStart: '2026-08-24', sourceType: 'call', count: '1' },
    ])
  })

  it('re-buckets the same report for New York and London viewers', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const { pipeline, discovery } = await createPipelineAndStages(org.orgId)
    await prisma.user.update({ where: { id: org.adminUserId }, data: { timeZone: 'America/New_York' } })
    await prisma.deal.create({
      data: {
        orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id,
        name: 'Zone boundary', amountMinor: 1200n, createdAt: new Date('2026-03-09T03:30:00.000Z'),
      },
    })

    const newYork = await request(app)
      .post(`/api/orgs/${org.orgId}/reports/run`)
      .set('Authorization', authorization(org.adminFirebaseUid))
      .send({ config: VIEWER_DAY_CONFIG })

    await prisma.user.update({ where: { id: org.adminUserId }, data: { timeZone: 'Europe/London' } })
    const london = await request(app)
      .post(`/api/orgs/${org.orgId}/reports/run`)
      .set('Authorization', authorization(org.adminFirebaseUid))
      .send({ config: VIEWER_DAY_CONFIG })

    expect(newYork.body.report.rows).toMatchObject([{ createdDay: '2026-03-08', amountMinor: '1200' }])
    expect(london.body.report.rows).toMatchObject([{ createdDay: '2026-03-09', amountMinor: '1200' }])
  })

  it('keeps every DST-week instant in its one correct New York local-day bucket', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const { pipeline, discovery } = await createPipelineAndStages(org.orgId)
    await prisma.user.update({ where: { id: org.adminUserId }, data: { timeZone: 'America/New_York' } })
    await prisma.deal.createMany({
      data: [
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'Before spring forward', amountMinor: 1000n, createdAt: new Date('2026-03-08T06:30:00.000Z') },
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'After spring forward', amountMinor: 2000n, createdAt: new Date('2026-03-08T07:30:00.000Z') },
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'Late local evening', amountMinor: 4000n, createdAt: new Date('2026-03-09T03:30:00.000Z') },
      ],
    })

    const response = await request(app)
      .post(`/api/orgs/${org.orgId}/reports/run`)
      .set('Authorization', authorization(org.adminFirebaseUid))
      .send({ config: VIEWER_DAY_CONFIG })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toMatchObject([{ createdDay: '2026-03-08', amountMinor: '7000' }])
    expect(response.body.report.rows).toHaveLength(1)
  })

  it('persists, reopens, renames, and soft-deletes an owned report', async () => {
    const org = await seedOrgWithAdmin(prisma)

    const saved = await request(app)
      .post(`/api/orgs/${org.orgId}/reports`)
      .set('Authorization', authorization(org.adminFirebaseUid))
      .send({ name: 'Pipeline by stage', config: CONFIG })

    expect(saved.status).toBe(201)
    expect(saved.body.report).toMatchObject({ name: 'Pipeline by stage', config: CONFIG })
    const reportId = saved.body.report.id as string

    const reopened = await request(app)
      .get(`/api/orgs/${org.orgId}/reports/${reportId}`)
      .set('Authorization', authorization(org.adminFirebaseUid))
    expect(reopened.status).toBe(200)
    expect(reopened.body.report.config).toEqual(CONFIG)

    const renamed = await request(app)
      .patch(`/api/orgs/${org.orgId}/reports/${reportId}`)
      .set('Authorization', authorization(org.adminFirebaseUid))
      .send({ name: 'Pipeline Q3' })
    expect(renamed.status).toBe(200)

    const reports = await request(app)
      .get(`/api/orgs/${org.orgId}/reports`)
      .set('Authorization', authorization(org.adminFirebaseUid))
    expect(reports.body).toMatchObject({ total: 1, reports: [{ id: reportId, name: 'Pipeline Q3' }] })

    const deleted = await request(app)
      .delete(`/api/orgs/${org.orgId}/reports/${reportId}`)
      .set('Authorization', authorization(org.adminFirebaseUid))
    expect(deleted.status).toBe(200)

    const noLongerOpen = await request(app)
      .get(`/api/orgs/${org.orgId}/reports/${reportId}`)
      .set('Authorization', authorization(org.adminFirebaseUid))
    expect(noLongerOpen.status).toBe(404)
  })
})
