import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { compileReport, type ReportConfig } from '../reporting/reportCompiler.js'

const router = Router({ mergeParams: true })

// R0's intentionally narrow config. The registry/compiler is the one path from
// this symbolic shape to SQL; the API never accepts columns, tables, or SQL.
const reportConfigSchema = z.object({
  baseObject: z.literal('deal'),
  rows: z.tuple([z.object({ field: z.literal('stage') })]),
  values: z.tuple([z.object({ field: z.literal('amountMinor'), aggregation: z.literal('sum') })]),
})

const runReportBodySchema = z.object({ config: reportConfigSchema })

interface RawDealStageSum {
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
    const query = compileReport(parsed.data.config as ReportConfig, orgId)
    const rows = await prisma.$queryRaw<RawDealStageSum[]>(query)

    // --- Return response ---
    return void res.json({
      report: {
        rows: rows.map((row) => ({
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
