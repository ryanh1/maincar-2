import { Router } from 'express'
import { z } from 'zod'
import type { Report } from '../generated/prisma/client.js'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { compileReport, InvalidReportConfigError, type ReportConfig } from '../reporting/reportCompiler.js'

const router = Router({ mergeParams: true })

// R0's intentionally narrow config. The registry/compiler is the one path from
// this symbolic shape to SQL; the API never accepts columns, tables, or SQL.
const reportConfigSchema = z.object({
  baseObject: z.literal('deal'),
  rows: z.tuple([z.object({ field: z.literal('stage') }).strict()]),
  values: z.tuple([z.object({ field: z.literal('amountMinor'), aggregation: z.literal('sum') }).strict()]),
  timeZone: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('pinned'), displayZone: z.string().trim().min(1).max(100) }).strict(),
    z.object({ mode: z.literal('viewer') }).strict(),
    z.object({ mode: z.literal('subject'), subjectUserId: z.string().trim().min(1).max(100) }).strict(),
  ]),
  timeBucket: z.object({ field: z.literal('createdAt'), grain: z.literal('day') }).strict().optional(),
}).strict()

const runReportBodySchema = z.object({ config: reportConfigSchema }).strict()
const reportNameSchema = z.string().trim().min(1, 'Name the report to save it.').max(200)
const saveReportBodySchema = z.object({ name: reportNameSchema, config: reportConfigSchema }).strict()
const renameReportBodySchema = z.object({ name: reportNameSchema }).strict()
const reportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()

interface RawDealStageSum {
  createdDay?: string
  stageId: string
  stageName: string
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

    const query = compileReport(parsed.data.config as ReportConfig, orgId, {
      viewerTimeZone: authReq.user!.timeZone,
      subjectTimeZone,
    })
    const rows = await prisma.$queryRaw<RawDealStageSum[]>(query)

    // --- Return response ---
    return void res.json({
      report: {
        rows: rows.map((row) => ({
          ...(row.createdDay ? { createdDay: row.createdDay } : {}),
          stageId: row.stageId,
          stageName: row.stageName,
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
    const parsed = renameReportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }

    // --- Execute query ---
    const result = await prisma.report.updateMany({
      where: { id: reportId, orgId, ownerId: authReq.user!.id, deletedAt: null },
      data: { name: parsed.data.name },
    })
    if (result.count === 0) return void res.status(404).json({ error: 'Report not found' })

    // --- Return response ---
    return void res.json({ report: { id: reportId, name: parsed.data.name } })
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
