import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    team: { findMany: vi.fn() },
    attributeDef: { findFirst: vi.fn() },
    report: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
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

const NOW = new Date('2026-08-22T12:00:00.000Z')
const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/reports/run`
const CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  columns: [],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  timeZone: { mode: 'pinned', displayZone: 'UTC' },
}

const VIEWER_DAY_CONFIG = {
  ...CONFIG,
  timeZone: { mode: 'viewer' },
  timeBucket: { field: 'createdAt', grain: 'day' },
}

const OWNER_BY_STAGE_CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'owner' }],
  columns: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  timeZone: { mode: 'viewer' },
}

const ACTIVITY_GRID_CONFIG = {
  baseObject: 'activity',
  rows: [{ field: 'sourceType' }],
  values: [{ field: 'id', aggregation: 'count' }],
  timeZone: { mode: 'viewer' },
  timeBucket: { field: 'occurredAt', grain: 'week' },
}

const ACTIVITY_METRICS_GRID_CONFIG = {
  baseObject: 'activityGrid',
  metrics: [
    { key: 'calls', type: 'event_count', sourceType: 'call' },
    { key: 'entered-qualified', type: 'stage_entry', stageId: 'stage-qualified' },
    { key: 'qualified-per-call', type: 'conversion', numeratorKey: 'entered-qualified', denominatorKey: 'calls' },
  ],
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

function authAsMember(): void {
  verifyTokenMock.mockResolvedValue({ uid: 'firebase-a' })
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-a', firebaseUid: 'firebase-a', email: 'a@example.com',
    firstName: 'Avery', lastName: 'Admin', roles: ['admin'], enabled: true,
    timeZone: 'America/New_York', currentOrgId: ORG_ID, createdAt: NOW, updatedAt: NOW,
  })
  prismaMock.membership.findFirst.mockResolvedValue({
    id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['admin'], isActive: true,
    createdAt: NOW, updatedAt: NOW,
    org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authAsMember()
  prismaMock.$queryRaw.mockResolvedValue([
    { stageId: 'stage-discovery', stageName: 'Discovery', amountMinor: 3500n },
    { stageId: 'stage-won', stageName: 'Won', amountMinor: 9000n },
  ])
  prismaMock.attributeDef.findFirst.mockResolvedValue({ id: 'attribute-segment', slug: 'segment' })
})

describe('POST /api/orgs/:orgId/reports/run', () => {
  it('returns Deal stage sums as exact minor-unit strings', async () => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: CONFIG })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      report: {
        rows: [
          { stageId: 'stage-discovery', stageName: 'Discovery', amountMinor: '3500' },
          { stageId: 'stage-won', stageName: 'Won', amountMinor: '9000' },
        ],
      },
    })
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('resolves an owner team filter through the shared team scope before compiling', async () => {
    prismaMock.membership.findMany.mockResolvedValue([{ userId: 'lead-a' }])
    prismaMock.team.findMany.mockResolvedValue([
      { id: 'team-a', members: [{ userId: 'owner-a' }, { userId: 'owner-b' }] },
    ])

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({
        config: {
          ...CONFIG,
          filters: { ownerTeam: { teamIds: ['team-a'], leadUserIds: ['lead-a'] } },
        },
      })

    expect(response.status).toBe(200)
    expect(prismaMock.team.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ orgId: ORG_ID, archivedAt: null }),
      select: { id: true, members: { select: { userId: true } } },
    })
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual([ORG_ID, 'owner-a', 'owner-b'])
  })

  it('returns the selected Owner and Stage dimensions for the pivot grid', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-discovery', stageName: 'Discovery', amountMinor: 3500n },
      { ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-won', stageName: 'Won', amountMinor: 9000n },
    ])

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: OWNER_BY_STAGE_CONFIG })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-discovery', stageName: 'Discovery', amountMinor: '3500' },
      { ownerId: 'user-a', ownerName: 'Avery Admin', stageId: 'stage-won', stageName: 'Won', amountMinor: '9000' },
    ])
  })

  it('resolves the canonical Segment attribute before returning its grouped values', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { segmentId: 'Enterprise', segmentName: 'Enterprise', amountMinor: 3500n },
      { segmentId: 'unspecified', segmentName: 'Unspecified', amountMinor: 9000n },
    ])

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({
        config: {
          ...CONFIG,
          rows: [{ field: 'segment' }],
        },
      })

    expect(response.status).toBe(200)
    expect(response.body.report.rows).toEqual([
      { segmentId: 'Enterprise', segmentName: 'Enterprise', amountMinor: '3500' },
      { segmentId: 'unspecified', segmentName: 'Unspecified', amountMinor: '9000' },
    ])
    expect(prismaMock.attributeDef.findFirst).toHaveBeenCalledWith({
      where: {
        orgId: ORG_ID,
        slug: 'segment',
        type: 'select',
        storage: 'custom',
        isSystem: true,
        deletedAt: null,
        object: { orgId: ORG_ID, slug: 'deal', storage: 'table', isStandard: true, isArchived: false, deletedAt: null },
      },
      select: { id: true, slug: true },
    })
  })

  it('returns activity event counts grouped into viewer-local weeks', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { weekStart: '2026-08-17', sourceType: 'call', count: '2' },
      { weekStart: '2026-08-17', sourceType: 'email', count: '1' },
      { weekStart: '2026-08-24', sourceType: 'meeting', count: '3' },
    ])

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: ACTIVITY_GRID_CONFIG })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      report: {
        rows: [
          { weekStart: '2026-08-17', sourceType: 'call', count: '2' },
          { weekStart: '2026-08-17', sourceType: 'email', count: '1' },
          { weekStart: '2026-08-24', sourceType: 'meeting', count: '3' },
        ],
      },
    })
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual(['America/New_York', ORG_ID])
  })

  it('returns stage-entry and conversion rows from the named activity-grid metrics', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { weekStart: '2026-08-17', metricKey: 'calls', metricType: 'event_count', count: '4' },
      { weekStart: '2026-08-17', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '2' },
      { weekStart: '2026-08-24', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '1' },
    ])

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: ACTIVITY_METRICS_GRID_CONFIG })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      report: {
        rows: [
          { weekStart: '2026-08-17', metricKey: 'calls', metricType: 'event_count', count: '4' },
          { weekStart: '2026-08-17', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '2' },
          { weekStart: '2026-08-17', metricKey: 'qualified-per-call', metricType: 'conversion', ratio: 0.5 },
          { weekStart: '2026-08-24', metricKey: 'calls', metricType: 'event_count', count: '0' },
          { weekStart: '2026-08-24', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '1' },
          { weekStart: '2026-08-24', metricKey: 'qualified-per-call', metricType: 'conversion', ratio: null },
        ],
      },
    })
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual([
      'America/New_York', 'calls', ORG_ID, 'call',
      'America/New_York', 'entered-qualified', ORG_ID, 'stage-qualified',
    ])
  })

  it('returns dialer number connect rates from the reporting engine’s rollup query', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { numberE164: '+14155550110', dials: '4', connects: '3' },
      { numberE164: '+12125550120', dials: '2', connects: '1' },
    ])

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: DIALER_NUMBER_CONFIG })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      report: {
        rows: [
          { numberE164: '+14155550110', dials: '4', connects: '3', connectRate: '0.75' },
          { numberE164: '+12125550120', dials: '2', connects: '1', connectRate: '0.5' },
        ],
      },
    })
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual([ORG_ID])
  })

  it('uses an active subject member zone instead of the viewer zone', async () => {
    prismaMock.membership.findFirst
      .mockResolvedValueOnce({
        id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['admin'], isActive: true,
        createdAt: NOW, updatedAt: NOW,
        org: { id: ORG_ID, name: 'Org A', logo: null, enabled: true, createdAt: NOW, updatedAt: NOW },
      })
      .mockResolvedValueOnce({ user: { timeZone: 'Asia/Kolkata' } })

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({
        config: {
          ...VIEWER_DAY_CONFIG,
          timeZone: { mode: 'subject', subjectUserId: 'user-subject' },
        },
      })

    expect(response.status).toBe(200)
    expect(prismaMock.$queryRaw.mock.calls[0][0].values).toEqual(['Asia/Kolkata', ORG_ID])
  })

  it('blocks a viewer-bucketed report when the viewer has no saved zone', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-a', firebaseUid: 'firebase-a', email: 'a@example.com',
      firstName: 'Avery', lastName: 'Admin', roles: ['admin'], enabled: true,
      timeZone: null, currentOrgId: ORG_ID, createdAt: NOW, updatedAt: NOW,
    })

    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: VIEWER_DAY_CONFIG })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'A viewer time zone is required for this report.' })
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'a raw database column',
      config: { ...CONFIG, rows: [{ field: 'deal.amountMinor' }] },
    },
    {
      name: 'a client-supplied custom JSON key',
      config: { ...CONFIG, rows: [{ field: 'customJson.segment' }] },
    },
    {
      name: 'SQL-like field input',
      config: { ...CONFIG, rows: [{ field: 'stage; DROP TABLE "Deal"' }] },
    },
    {
      name: 'an attempted org override',
      config: { ...CONFIG, orgId: 'org-b' },
    },
    {
      name: 'a duplicate dimension across pivot zones',
      config: { ...OWNER_BY_STAGE_CONFIG, columns: [{ field: 'owner' }] },
    },
  ])('rejects $name before compiling a query', async ({ config }) => {
    const response = await request(app)
      .post(URL)
      .set('Authorization', 'Bearer fake-token')
      .send({ config })

    expect(response.status).toBe(400)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('refuses to save a pivot that has no group or repeats one across zones', async () => {
    const noGroup = await request(app)
      .post(`/api/orgs/${ORG_ID}/reports`)
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'Incomplete', config: { ...CONFIG, rows: [], columns: [] } })
    const duplicate = await request(app)
      .post(`/api/orgs/${ORG_ID}/reports`)
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'Duplicate', config: { ...OWNER_BY_STAGE_CONFIG, columns: [{ field: 'owner' }] } })

    expect(noGroup.status).toBe(400)
    expect(noGroup.body).toEqual({ error: 'Add at least one Owner, Stage, or Segment group.' })
    expect(duplicate.status).toBe(400)
    expect(duplicate.body).toEqual({ error: 'A field can appear in only one pivot zone.' })
    expect(prismaMock.report.create).not.toHaveBeenCalled()
  })
})

describe('saved reports', () => {
  it('lists only the active member’s reports, newest first', async () => {
    prismaMock.report.count.mockResolvedValue(2)
    prismaMock.report.findMany.mockResolvedValue([
      {
        id: 'report-2', name: 'Renewals', kind: 'pivot', configJson: CONFIG, ownerId: 'user-a',
        createdAt: NOW, updatedAt: new Date('2026-08-22T12:01:00.000Z'),
      },
      {
        id: 'report-1', name: 'Pipeline by stage', kind: 'pivot', configJson: CONFIG, ownerId: 'user-a',
        createdAt: NOW, updatedAt: NOW,
      },
    ])

    const response = await request(app)
      .get(`/api/orgs/${ORG_ID}/reports`)
      .set('Authorization', 'Bearer fake-token')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      total: 2,
      page: 1,
      limit: 50,
      reports: [
        { id: 'report-2', name: 'Renewals' },
        { id: 'report-1', name: 'Pipeline by stage' },
      ],
    })
    expect(prismaMock.report.findMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, ownerId: 'user-a', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      skip: 0,
      take: 50,
    })
    expect(prismaMock.report.count).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, ownerId: 'user-a', deletedAt: null },
    })
  })

  it('saves a named report and reopens its exact config', async () => {
    prismaMock.report.create.mockResolvedValue({
      id: 'report-1',
      name: 'Pipeline by stage',
      kind: 'pivot',
      configJson: CONFIG,
      ownerId: 'user-a',
      createdAt: NOW,
      updatedAt: NOW,
    })
    prismaMock.report.findFirst.mockResolvedValue({
      id: 'report-1',
      name: 'Pipeline by stage',
      kind: 'pivot',
      configJson: CONFIG,
      ownerId: 'user-a',
      createdAt: NOW,
      updatedAt: NOW,
    })

    const saved = await request(app)
      .post(`/api/orgs/${ORG_ID}/reports`)
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'Pipeline by stage', config: CONFIG })

    expect(saved.status).toBe(201)
    expect(saved.body.report).toMatchObject({
      id: 'report-1',
      name: 'Pipeline by stage',
      config: CONFIG,
    })
    expect(prismaMock.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: ORG_ID,
        ownerId: 'user-a',
        name: 'Pipeline by stage',
        kind: 'pivot',
        configJson: CONFIG,
      }),
    })

    const reopened = await request(app)
      .get(`/api/orgs/${ORG_ID}/reports/report-1`)
      .set('Authorization', 'Bearer fake-token')

    expect(reopened.status).toBe(200)
    expect(reopened.body.report).toMatchObject({
      id: 'report-1',
      name: 'Pipeline by stage',
      config: CONFIG,
    })
  })

  it('persists optional chart controls without changing the report query shape', async () => {
    const chartConfig = { ...CONFIG, chart: { type: 'bar', color: 'chart-1', labels: false, yAxisMax: 10000 } }
    prismaMock.report.create.mockResolvedValue({
      id: 'report-1', name: 'Pipeline by stage', kind: 'pivot', configJson: chartConfig, ownerId: 'user-a', createdAt: NOW, updatedAt: NOW,
    })

    const saved = await request(app)
      .post(`/api/orgs/${ORG_ID}/reports`)
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'Pipeline by stage', config: chartConfig })

    expect(saved.status).toBe(201)
    expect(prismaMock.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ configJson: chartConfig }),
    })
  })

  it('updates a saved report’s structured owner team selection', async () => {
    const scopedConfig = {
      ...CONFIG,
      filters: { ownerTeam: { teamIds: ['team-a'], leadUserIds: ['lead-b'] } },
    }
    prismaMock.report.updateMany.mockResolvedValue({ count: 1 })

    const updated = await request(app)
      .patch(`/api/orgs/${ORG_ID}/reports/report-1`)
      .set('Authorization', 'Bearer fake-token')
      .send({ config: scopedConfig })

    expect(updated.status).toBe(200)
    expect(updated.body).toEqual({ report: { id: 'report-1', config: scopedConfig } })
    expect(prismaMock.report.updateMany).toHaveBeenCalledWith({
      where: { id: 'report-1', orgId: ORG_ID, ownerId: 'user-a', deletedAt: null },
      data: { configJson: scopedConfig },
    })
  })

  it('rejects a report with no usable name', async () => {
    const response = await request(app)
      .post(`/api/orgs/${ORG_ID}/reports`)
      .set('Authorization', 'Bearer fake-token')
      .send({ name: '   ', config: CONFIG })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Name the report to save it.' })
    expect(prismaMock.report.create).not.toHaveBeenCalled()
  })

  it('renames and moves only the owner report into the 30-day trash', async () => {
    prismaMock.report.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 })

    const renamed = await request(app)
      .patch(`/api/orgs/${ORG_ID}/reports/report-1`)
      .set('Authorization', 'Bearer fake-token')
      .send({ name: 'Pipeline by stage Q3' })
    const deleted = await request(app)
      .delete(`/api/orgs/${ORG_ID}/reports/report-1`)
      .set('Authorization', 'Bearer fake-token')

    expect(renamed.status).toBe(200)
    expect(deleted.status).toBe(200)
    expect(prismaMock.report.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'report-1', orgId: ORG_ID, ownerId: 'user-a', deletedAt: null },
      data: { name: 'Pipeline by stage Q3' },
    })
    expect(prismaMock.report.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'report-1', orgId: ORG_ID, ownerId: 'user-a', deletedAt: null },
      data: { deletedAt: expect.any(Date), deletedById: 'user-a' },
    })
  })
})
