import { Router, type Response } from 'express'
import { z } from 'zod'

import { SavedViewConfigValidationError, SavedViewConflictError, SavedViewNotFoundError, savedViewService } from '../crm/savedViewService.js'
import { repairSavedViewConfig, type ViewLayout } from '../crm/savedViews.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { AttributeDef, SavedView } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  layout: z.enum(['list', 'grid', 'kanban']).default('grid'),
  configJson: z.unknown(),
})
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.')
const reorderSchema = z.object({ viewIds: z.array(z.string().min(1)).min(1) })
const undoSchema = z.object({ undoToken: z.string().min(1) })

function sendServiceError(res: Response, error: unknown) {
  if (error instanceof SavedViewConfigValidationError) return res.status(422).json({ error: error.message })
  if (error instanceof SavedViewConflictError) return res.status(409).json({ error: error.message })
  if (error instanceof SavedViewNotFoundError) return res.status(404).json({ error: error.message })
  throw error
}

function mapSavedView(view: SavedView, attributes: AttributeDef[]) {
  return {
    id: view.id,
    objectId: view.objectId,
    name: view.name,
    layout: view.layout,
    configJson: repairSavedViewConfig(view.configJson, attributes),
    ownerUserId: view.ownerUserId,
    isShared: view.isShared,
    isDefault: view.isDefault,
    sortOrder: view.sortOrder,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  }
}

router.use(requireAuth)

router.post('/', wrapRoute('POST /api/orgs/:orgId/objects/:objectId/views', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)

  // --- Verify ownership ---
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  // --- Parse & validate params ---
  const parsed = createSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Execute query ---
  try {
    const { view, attributes } = await savedViewService.create({
      orgId,
      objectId,
      ownerUserId: authReq.user!.id,
      name: parsed.data.name,
      layout: parsed.data.layout as ViewLayout,
      configJson: parsed.data.configJson,
    })
    return void res.status(201).json({ view: mapSavedView(view, attributes) })
  } catch (error) { return void sendServiceError(res, error) }
}))

router.get('/', wrapRoute('GET /api/orgs/:orgId/objects/:objectId/views', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  try {
    const { views, attributes } = await savedViewService.list(orgId, objectId, authReq.user!.id)
    return void res.json({ views: views.map((view) => mapSavedView(view, attributes)) })
  } catch (error) { return void sendServiceError(res, error) }
}))

router.post('/undo', wrapRoute('POST /api/orgs/:orgId/objects/:objectId/views/undo', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = undoSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    await savedViewService.undoDelete({ orgId, objectId, viewId: parsed.data.undoToken, userId: authReq.user!.id })
    return void res.status(204).end()
  } catch (error) { return void sendServiceError(res, error) }
}))

router.put('/reorder', wrapRoute('PUT /api/orgs/:orgId/objects/:objectId/views/reorder', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = reorderSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const { views, attributes } = await savedViewService.reorder(orgId, objectId, authReq.user!.id, parsed.data.viewIds)
    return void res.json({ views: views.map((view) => mapSavedView(view, attributes)) })
  } catch (error) { return void sendServiceError(res, error) }
}))

router.get('/:viewId', wrapRoute('GET /api/orgs/:orgId/objects/:objectId/views/:viewId', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  try {
    const { view, attributes } = await savedViewService.get({ orgId, objectId, viewId: String(req.params.viewId), userId: authReq.user!.id })
    return void res.json({ view: mapSavedView(view, attributes) })
  } catch (error) { return void sendServiceError(res, error) }
}))

router.patch('/:viewId', wrapRoute('PATCH /api/orgs/:orgId/objects/:objectId/views/:viewId', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = updateSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const { view, attributes } = await savedViewService.update({ orgId, objectId, viewId: String(req.params.viewId), userId: authReq.user!.id, ...parsed.data })
    return void res.json({ view: mapSavedView(view, attributes) })
  } catch (error) { return void sendServiceError(res, error) }
}))

router.post('/:viewId/duplicate', wrapRoute('POST /api/orgs/:orgId/objects/:objectId/views/:viewId/duplicate', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  try {
    const { view, attributes } = await savedViewService.duplicate({ orgId, objectId, viewId: String(req.params.viewId), userId: authReq.user!.id })
    return void res.status(201).json({ view: mapSavedView(view, attributes) })
  } catch (error) { return void sendServiceError(res, error) }
}))

router.post('/:viewId/default', wrapRoute('POST /api/orgs/:orgId/objects/:objectId/views/:viewId/default', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  try {
    await savedViewService.setDefault({ orgId, objectId, viewId: String(req.params.viewId), userId: authReq.user!.id })
    return void res.status(204).end()
  } catch (error) { return void sendServiceError(res, error) }
}))

router.delete('/:viewId', wrapRoute('DELETE /api/orgs/:orgId/objects/:objectId/views/:viewId', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  try {
    return void res.json(await savedViewService.delete({ orgId, objectId, viewId: String(req.params.viewId), userId: authReq.user!.id }))
  } catch (error) { return void sendServiceError(res, error) }
}))

export default router
