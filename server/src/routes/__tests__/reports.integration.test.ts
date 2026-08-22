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
import { rollupDialerAnalyticsForOrg } from '../../jobs/dialerAnalyticsRollup.js'
import { seedMember, seedOrgWithAdmin } from '../../test/integration/testPrisma.js'

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

const DIALER_NUMBER_CONFIG = {
  baseObject: 'dialer',
  rows: [{ field: 'numberE164' }],
  values: [
    { field: 'dials', aggregation: 'sum' },
    { field: 'connects', aggregation: 'sum' },
  ],
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

const DIALER_AREA_CONFIG = { ...DIALER_NUMBER_CONFIG, rows: [{ field: 'areaCode' }] }

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

  it('applies specific teams and multiple direct leads once per owner, without reading another organization', async () => {
    const org = await seedOrgWithAdmin(prisma)
    const explicitMember = await seedMember(prisma, org.orgId)
    const firstLead = await seedMember(prisma, org.orgId)
    const secondLead = await seedMember(prisma, org.orgId)
    const { pipeline, discovery } = await createPipelineAndStages(org.orgId)

    const explicitTeam = await prisma.team.create({
      data: {
        orgId: org.orgId, name: 'Revenue', leadUserId: org.adminUserId,
        members: { create: [
          { orgId: org.orgId, userId: org.adminUserId },
          { orgId: org.orgId, userId: explicitMember.userId },
        ] },
      },
    })
    await prisma.team.create({
      data: {
        orgId: org.orgId, name: 'East', leadUserId: firstLead.userId,
        members: { create: [
          { orgId: org.orgId, userId: org.adminUserId },
          { orgId: org.orgId, userId: firstLead.userId },
        ] },
      },
    })
    await prisma.team.create({
      data: {
        orgId: org.orgId, name: 'West', leadUserId: secondLead.userId,
        members: { create: [
          { orgId: org.orgId, userId: org.adminUserId },
          { orgId: org.orgId, userId: secondLead.userId },
        ] },
      },
    })
    await prisma.deal.createMany({
      data: [
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'Admin', amountMinor: 100n, ownerUserId: org.adminUserId },
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'Explicit', amountMinor: 200n, ownerUserId: explicitMember.userId },
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'East', amountMinor: 300n, ownerUserId: firstLead.userId },
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'West', amountMinor: 400n, ownerUserId: secondLead.userId },
        { orgId: org.orgId, pipelineId: pipeline.id, stageId: discovery.id, name: 'Outside', amountMinor: 500n },
      ],
    })
    const foreign = await seedOrgWithAdmin(prisma)
    const foreignPipeline = await createPipelineAndStages(foreign.orgId)
    await prisma.deal.create({
      data: { orgId: foreign.orgId, pipelineId: foreignPipeline.pipeline.id, stageId: foreignPipeline.discovery.id, name: 'Foreign', amountMinor: 9999n, ownerUserId: foreign.adminUserId },
    })

    const response = await request(app)
      .post(`/api/orgs/${org.orgId}/reports/run`)
      .set('Authorization', authorization(org.adminFirebaseUid))
      .send({
        config: {
          ...CONFIG,
          filters: {
            ownerTeam: {
              teamIds: [explicitTeam.id],
              leadUserIds: [firstLead.userId, secondLead.userId],
            },
          },
        },
      })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { stageId: discovery.id, stageName: 'Discovery', amountMinor: '1000' },
    ])
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

  it('counts Deal stage entries from seeded FieldHistory and calculates their conversion from calls', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    await prisma.user.update({ where: { id: orgA.adminUserId }, data: { timeZone: 'America/New_York' } })
    const { discovery, proposal } = await createPipelineAndStages(orgA.orgId)
    const orgB = await seedOrgWithAdmin(prisma)
    const foreign = await createPipelineAndStages(orgB.orgId)

    await prisma.activityEntry.createMany({
      data: [
        { orgId: orgA.orgId, sourceType: 'call', sourceId: 'call-1', summary: 'Called', timelineTitle: 'Called', occurredAt: new Date('2026-08-17T12:00:00.000Z') },
        { orgId: orgA.orgId, sourceType: 'call', sourceId: 'call-2', summary: 'Called', timelineTitle: 'Called', occurredAt: new Date('2026-08-18T12:00:00.000Z') },
      ],
    })
    await prisma.fieldHistory.createMany({
      data: [
        // Two qualifying moves: one in each local-week bucket.
        { orgId: orgA.orgId, objectSlug: 'deal', recordId: 'deal-a', attribute: 'stageId', oldJson: discovery.id, newJson: proposal.id, changedAt: new Date('2026-08-19T12:00:00.000Z') },
        { orgId: orgA.orgId, objectSlug: 'deal', recordId: 'deal-b', attribute: 'stageId', oldJson: discovery.id, newJson: proposal.id, changedAt: new Date('2026-08-24T12:00:00.000Z') },
        // Same org but the wrong target stage is not a Proposal entry.
        { orgId: orgA.orgId, objectSlug: 'deal', recordId: 'deal-c', attribute: 'stageId', oldJson: proposal.id, newJson: discovery.id, changedAt: new Date('2026-08-19T12:00:00.000Z') },
        // A foreign org's history must never reach this report.
        { orgId: orgB.orgId, objectSlug: 'deal', recordId: 'deal-d', attribute: 'stageId', oldJson: foreign.discovery.id, newJson: foreign.proposal.id, changedAt: new Date('2026-08-19T12:00:00.000Z') },
      ],
    })

    const response = await request(app)
      .post(`/api/orgs/${orgA.orgId}/reports/run`)
      .set('Authorization', authorization(orgA.adminFirebaseUid))
      .send({
        config: {
          baseObject: 'activityGrid',
          metrics: [
            { key: 'calls', type: 'event_count', sourceType: 'call' },
            { key: 'entered-proposal', type: 'stage_entry', stageId: proposal.id },
            { key: 'proposal-per-call', type: 'conversion', numeratorKey: 'entered-proposal', denominatorKey: 'calls' },
          ],
          timeZone: { mode: 'viewer' },
          timeBucket: { field: 'occurredAt', grain: 'week' },
        },
      })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { weekStart: '2026-08-17', metricKey: 'calls', metricType: 'event_count', count: '2' },
      { weekStart: '2026-08-17', metricKey: 'entered-proposal', metricType: 'stage_entry', count: '1' },
      { weekStart: '2026-08-17', metricKey: 'proposal-per-call', metricType: 'conversion', ratio: 0.5 },
      { weekStart: '2026-08-24', metricKey: 'calls', metricType: 'event_count', count: '0' },
      { weekStart: '2026-08-24', metricKey: 'entered-proposal', metricType: 'stage_entry', count: '1' },
      { weekStart: '2026-08-24', metricKey: 'proposal-per-call', metricType: 'conversion', ratio: null },
    ])
  })

  it('returns hand-counted connect rates by owned number and dialed area without another org’s calls', async () => {
    const orgA = await seedOrgWithAdmin(prisma)
    const orgB = await seedOrgWithAdmin(prisma)
    await prisma.call.createMany({
      data: [
        { orgId: orgA.orgId, userId: orgA.adminUserId, fromE164: '+14155550110', toE164: '+12125550111', direction: 'outbound', status: 'completed', startedAt: new Date('2026-08-21T10:00:00.000Z') },
        { orgId: orgA.orgId, userId: orgA.adminUserId, fromE164: '+14155550110', toE164: '+12125550112', direction: 'outbound', status: 'busy', startedAt: new Date('2026-08-21T11:00:00.000Z') },
        { orgId: orgA.orgId, userId: orgA.adminUserId, fromE164: '+12125550120', toE164: '+14155550113', direction: 'outbound', status: 'completed', startedAt: new Date('2026-08-22T10:00:00.000Z') },
        { orgId: orgB.orgId, userId: orgB.adminUserId, fromE164: '+14155550110', toE164: '+12125550111', direction: 'outbound', status: 'completed', startedAt: new Date('2026-08-21T10:00:00.000Z') },
      ],
    })

    await rollupDialerAnalyticsForOrg(orgA.orgId)

    const byNumber = await request(app)
      .post(`/api/orgs/${orgA.orgId}/reports/run`)
      .set('Authorization', authorization(orgA.adminFirebaseUid))
      .send({ config: DIALER_NUMBER_CONFIG })
    const byArea = await request(app)
      .post(`/api/orgs/${orgA.orgId}/reports/run`)
      .set('Authorization', authorization(orgA.adminFirebaseUid))
      .send({ config: DIALER_AREA_CONFIG })

    expect(byNumber.status).toBe(200)
    expect(byNumber.body.report.rows).toEqual([
      { numberE164: '+12125550120', dials: '1', connects: '1', connectRate: '1' },
      { numberE164: '+14155550110', dials: '2', connects: '1', connectRate: '0.5' },
    ])
    expect(byArea.status).toBe(200)
    expect(byArea.body.report.rows).toEqual([
      { areaCode: '212', dials: '2', connects: '1', connectRate: '0.5' },
      { areaCode: '415', dials: '1', connects: '1', connectRate: '1' },
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
