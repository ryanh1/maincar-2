import { Router, type Response } from 'express'
import { z } from 'zod'

import { CellStyleNotFoundError, CellStyleValidationError, cellStyleService } from '../crm/cellStyleService.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { CellStyle } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const listSchema = z.object({ viewId: z.string().trim().min(1) })
const upsertSchema = z.object({
  viewId: z.string().trim().min(1),
  recordId: z.string().trim().min(1),
  fieldId: z.string().trim().min(1),
  backgroundToken: z.string().trim().min(1).nullable().optional(),
  textToken: z.string().trim().min(1).nullable().optional(),
})

function mapCellStyle(cellStyle: CellStyle) {
  return {
    id: cellStyle.id,
    viewId: cellStyle.viewId,
    recordId: cellStyle.recordId,
    fieldId: cellStyle.fieldId,
    backgroundToken: cellStyle.backgroundToken,
    textToken: cellStyle.textToken,
    createdAt: cellStyle.createdAt.toISOString(),
    updatedAt: cellStyle.updatedAt.toISOString(),
  }
}

function sendServiceError(res: Response, error: unknown) {
  if (error instanceof CellStyleNotFoundError) return res.status(404).json({ error: error.message })
  if (error instanceof CellStyleValidationError) return res.status(422).json({ error: error.message })
  throw error
}

router.use(requireAuth)

// GET /api/orgs/:orgId/cell-styles?viewId=... — every painted cell in one view.
router.get('/', wrapRoute('GET /api/orgs/:orgId/cell-styles', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = listSchema.safeParse(req.query)
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const cellStyles = await cellStyleService.list({ orgId, viewId: parsed.data.viewId, userId: authReq.user!.id })
    return void res.json({ cellStyles: cellStyles.map(mapCellStyle) })
  } catch (error) { return void sendServiceError(res, error) }
}))

// PUT /api/orgs/:orgId/cell-styles — paint (or repaint) one stored scalar cell.
router.put('/', wrapRoute('PUT /api/orgs/:orgId/cell-styles', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = upsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const cellStyle = await cellStyleService.upsert({
      orgId,
      viewId: parsed.data.viewId,
      recordId: parsed.data.recordId,
      fieldId: parsed.data.fieldId,
      backgroundToken: parsed.data.backgroundToken ?? null,
      textToken: parsed.data.textToken ?? null,
      userId: authReq.user!.id,
    })
    return void res.json({ cellStyle: cellStyle ? mapCellStyle(cellStyle) : null })
  } catch (error) { return void sendServiceError(res, error) }
}))

export default router
