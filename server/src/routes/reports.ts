import { Router } from 'express'
import { z } from 'zod'
import type { Report } from '../generated/prisma/client.js'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { resolveOwnerTeamScope } from '../lib/teamScope.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import {
  buildActivityGridRows,
  compileReport,
  InvalidReportConfigError,
  type ActivityMetricsGridReportConfig,
  type RawActivityGridCount,
  type ReportConfig,
} from '../reporting/reportCompiler.js'

const router = Router({ mergeParams: true })

// R0's intentionally narrow config. The registry/compiler is the one path from
// this symbolic shape to SQL; the API never accepts columns, tables, or SQL.
const timeZoneSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pinned'), displayZone: z.string().trim().min(1).max(100) }).strict(),
  z.object({ mode: z.literal('viewer') }).strict(),
  z.object({ mode: z.literal('subject'), subjectUserId: z.string().trim().min(1).max(100) }).strict(),
])

const ownerTeamScopeSchema = z.object({
  teamIds: z.array(z.string().trim().min(1)).min(1).max(200).optional(),
  leadUserIds: z.array(z.string().trim().min(1)).min(1).max(200).optional(),
}).strict().refine(
  (scope) => (scope.teamIds?.length ?? 0) + (scope.leadUserIds?.length ?? 0) > 0,
  { error: 'Choose at least one team or team lead.' },
)

const dealReportFiltersSchema = z.object({ ownerTeam: ownerTeamScopeSchema }).strict()

const pivotDimensionSchema = z.object({ field: z.enum(['owner', 'stage', 'createdAt']) }).strict()

const pivotValueTransformSchema = z.enum(['none', 'percentOfGrandTotal', 'percentOfColumn', 'percentOfRow', 'percentOfParent', 'runningTotal', 'rankLargestToSmallest'])

// Chart controls describe the presentation of the pivot response. They never
// alter the symbolic query shape accepted by the reporting compiler.
const reportChartSchema = z.object({
  type: z.enum(['bar', 'line', 'area', 'pie', 'funnel', 'heatmap', 'scatter', 'kpi']),
  color: z.enum(['chart-1', 'chart-2', 'chart-3', 'chart-4']),
  labels: z.boolean(),
  yAxisMax: z.number().finite().nonnegative().optional(),
}).strict()

const dealReportConfigSchema = z.object({
  baseObject: z.literal('deal'),
  rows: z.array(pivotDimensionSchema).max(2),
  columns: z.array(pivotDimensionSchema).max(2).default([]),
  values: z.tuple([z.object({ field: z.literal('amountMinor'), aggregation: z.literal('sum'), showAs: pivotValueTransformSchema.optional() }).strict()]),
  timeZone: timeZoneSchema,
  timeBucket: z.object({ field: z.literal('createdAt'), grain: z.literal('day') }).strict().optional(),
  filters: dealReportFiltersSchema.optional(),
  compareTo: z.enum(['previousPeriod', 'samePeriodLastYear']).optional(),
  summaryRows: z.array(z.object({
    rowKey: z.string().min(1).max(500),
    showAs: z.enum(['percentOfGrandTotal', 'percentOfParent', 'samePeriodLastYear']),
  }).strict()).max(100).optional(),
  chart: reportChartSchema.optional(),
}).strict()

const activityGridConfigSchema = z.object({
  baseObject: z.literal('activity'),
  rows: z.tuple([z.object({ field: z.literal('sourceType') }).strict()]),
  values: z.tuple([z.object({ field: z.literal('id'), aggregation: z.literal('count') }).strict()]),
  timeZone: timeZoneSchema,
  timeBucket: z.object({ field: z.literal('occurredAt'), grain: z.literal('week') }).strict(),
}).strict()

const activityGridMetricSchema = z.discriminatedUnion('type', [
  z.object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    type: z.literal('event_count'),
    sourceType: z.enum(['call', 'email', 'meeting']),
  }).strict(),
  z.object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    type: z.literal('stage_entry'),
    stageId: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    type: z.literal('conversion'),
    numeratorKey: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    denominatorKey: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  }).strict(),
])

const activityMetricsGridConfigSchema = z.object({
  baseObject: z.literal('activityGrid'),
  metrics: z.array(activityGridMetricSchema).min(1).max(25),
  timeZone: timeZoneSchema,
  timeBucket: z.object({ field: z.literal('occurredAt'), grain: z.literal('week') }).strict(),
}).strict()

const dialerConnectRateConfigSchema = z.object({
  baseObject: z.literal('dialer'),
  rows: z.tuple([z.object({ field: z.enum(['numberE164', 'areaCode']) }).strict()]),
  values: z.tuple([
    z.object({ field: z.literal('dials'), aggregation: z.literal('sum') }).strict(),
    z.object({ field: z.literal('connects'), aggregation: z.literal('sum') }).strict(),
  ]),
  timeZone: timeZoneSchema,
}).strict()

const reportConfigSchema = z.discriminatedUnion('baseObject', [
  dealReportConfigSchema,
  activityGridConfigSchema,
  activityMetricsGridConfigSchema,
  dialerConnectRateConfigSchema,
]).superRefine((config, context) => {
  if (config.baseObject !== 'deal') return

  const dimensions = [...config.rows, ...config.columns]
  if (dimensions.length === 0) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'Add at least one Owner or Stage group.' })
  }
  if (dimensions.length > 2) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'A pivot can use at most two groups.' })
  }
  if (new Set(dimensions.map((dimension) => dimension.field)).size !== dimensions.length) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'A field can appear in only one pivot zone.' })
  }
})

const runReportBodySchema = z.object({ config: reportConfigSchema }).strict()
const reportNameSchema = z.string().trim().min(1, 'Name the report to save it.').max(200)
const saveReportBodySchema = z.object({ name: reportNameSchema, config: reportConfigSchema }).strict()
const updateReportBodySchema = z.object({
  name: reportNameSchema.optional(),
  config: reportConfigSchema.optional(),
}).strict().refine(
  (body) => body.name !== undefined || body.config !== undefined,
  { error: 'Send a report name or configuration to update.' },
)
const reportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

interface RawDealPivotRow {
  createdDay?: string
  ownerId?: string
  ownerName?: string
  stageId?: string
  stageName?: string
  amountMinor: string | number | bigint
}

function savedReportResponse(report: Pick<Report, 'id' | 'name' | 'kind' | 'configJson' | 'createdAt' | 'updatedAt'>) {
  return {
    id: report.id,
    name: report.name,
    kind: report.kind,
    config: report.configJson,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  }
}

interface RawActivityWeekCount {
  weekStart: string
  sourceType: string
  count: string | number | bigint
}

interface RawDialerConnectRate {
  numberE164?: string
  areaCode?: string
  dials: string | number | bigint
  connects: string | number | bigint
}

function connectRate(dials: RawDialerConnectRate['dials'], connects: RawDialerConnectRate['connects']): string {
  const total = Number(dials)
  return total === 0 ? '0' : String(Number(connects) / total)
}

router.use(requireAuth)

// ============================================================
// POST /api/orgs/:orgId/reports/run — MAI-143's first live report
// ============================================================
router.post(
  '/run',
  wrapRoute('POST /api/orgs/:orgId/reports/run', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = runReportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Execute query ---
    let subjectTimeZone: string | null | undefined
    if (parsed.data.config.timeZone.mode === 'subject') {
      const subjectMembership = await prisma.membership.findFirst({
        where: {
          orgId,
          userId: parsed.data.config.timeZone.subjectUserId,
          isActive: true,
        },
        select: { user: { select: { timeZone: true } } },
      })
      if (!subjectMembership) {
        throw new InvalidReportConfigError('The report subject is not an active member of this organization.')
      }
      subjectTimeZone = subjectMembership.user.timeZone
    }

    const ownerTeamPredicate = parsed.data.config.baseObject === 'deal' && parsed.data.config.filters?.ownerTeam
      ? await resolveOwnerTeamScope(prisma, orgId, parsed.data.config.filters.ownerTeam)
      : undefined

    const query = compileReport(parsed.data.config as ReportConfig, orgId, {
      viewerTimeZone: authReq.user!.timeZone,
      subjectTimeZone,
      ownerTeamUserIds: ownerTeamPredicate?.ownerUserId.in,
    })
    if (parsed.data.config.baseObject === 'activityGrid') {
      const rows = await prisma.$queryRaw<RawActivityGridCount[]>(query)
      return void res.json({
        report: {
          rows: buildActivityGridRows(parsed.data.config as ActivityMetricsGridReportConfig, rows),
        },
      })
    }
    if (parsed.data.config.baseObject === 'dialer') {
      const rows = await prisma.$queryRaw<RawDialerConnectRate[]>(query)
      const dimension = parsed.data.config.rows[0].field
      return void res.json({
        report: {
          rows: rows.map((row) => ({
            [dimension]: row[dimension]!,
            dials: String(row.dials),
            connects: String(row.connects),
            connectRate: connectRate(row.dials, row.connects),
          })),
        },
      })
    }
    if (parsed.data.config.baseObject === 'activity') {
      const rows = await prisma.$queryRaw<RawActivityWeekCount[]>(query)
      return void res.json({
        report: {
          rows: rows.map((row) => ({
            weekStart: row.weekStart,
            sourceType: row.sourceType,
            count: String(row.count),
          })),
        },
      })
    }

    const rows = await prisma.$queryRaw<RawDealPivotRow[]>(query)

    // --- Return response ---
    return void res.json({
      report: {
        rows: rows.map((row) => ({
          ...(row.createdDay ? { createdDay: row.createdDay } : {}),
          ...(row.ownerId && row.ownerName ? { ownerId: row.ownerId, ownerName: row.ownerName } : {}),
          ...(row.stageId && row.stageName ? { stageId: row.stageId, stageName: row.stageName } : {}),
          // PostgreSQL returns the aggregate as text, preserving exact minor
          // units through JSON just like the Deals API does for one record.
          amountMinor: String(row.amountMinor),
        })),
      },
    })
  }),
)

// ============================================================
// Saved report lifecycle — MAI-145
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/reports', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = reportListQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { page, limit } = parsed.data
    const where = { orgId, ownerId: authReq.user!.id, deletedAt: null }

    // --- Execute query ---
    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.report.count({ where }),
    ])

    // --- Return response ---
    return void res.json({ reports: reports.map(savedReportResponse), total, page, limit })
  }),
)

router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/reports', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = saveReportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Execute query ---
    const report = await prisma.report.create({
      data: {
        orgId,
        ownerId: authReq.user!.id,
        name: parsed.data.name,
        kind: 'pivot',
        configJson: parsed.data.config,
      },
    })

    // --- Return response ---
    return void res.status(201).json({ report: savedReportResponse(report) })
  }),
)

router.get(
  '/:reportId',
  wrapRoute('GET /api/orgs/:orgId/reports/:reportId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const reportId = String(req.params.reportId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const report = await prisma.report.findFirst({
      where: { id: reportId, orgId, ownerId: authReq.user!.id, deletedAt: null },
    })
    if (!report) return void res.status(404).json({ error: 'Report not found' })

    // --- Return response ---
    return void res.json({ report: savedReportResponse(report) })
  }),
)

router.patch(
  '/:reportId',
  wrapRoute('PATCH /api/orgs/:orgId/reports/:reportId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const reportId = String(req.params.reportId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = updateReportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Execute query ---
    const result = await prisma.report.updateMany({
      where: { id: reportId, orgId, ownerId: authReq.user!.id, deletedAt: null },
      data: {
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.config === undefined ? {} : { configJson: parsed.data.config }),
      },
    })
    if (result.count === 0) return void res.status(404).json({ error: 'Report not found' })

    // --- Return response ---
    return void res.json({
      report: {
        id: reportId,
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.config === undefined ? {} : { config: parsed.data.config }),
      },
    })
  }),
)

router.delete(
  '/:reportId',
  wrapRoute('DELETE /api/orgs/:orgId/reports/:reportId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const reportId = String(req.params.reportId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const result = await prisma.report.updateMany({
      where: { id: reportId, orgId, ownerId: authReq.user!.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: authReq.user!.id },
    })
    if (result.count === 0) return void res.status(404).json({ error: 'Report not found' })

    // --- Return response ---
    return void res.json({ report: { id: reportId } })
  }),
)

export default router
