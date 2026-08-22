import { Router } from 'express'
import { z } from 'zod'

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

interface RawDealStageSum {
  createdDay?: string
  stageId: string
  stageName: string
  amountMinor: string | number | bigint
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

export default router
