import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  applyUrlViewOverlay,
  canEditSavedView,
  canShareSavedView,
  canViewSavedView,
  decodeUrlViewOverlay,
  repairSavedViewConfig,
  type ViewLayout,
} from '../crm/savedViews.js'
import type { AttributeDef, Prisma, SavedView } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const layoutSchema = z.enum(['list', 'grid', 'kanban'])
const createSchema = z.object({
  objectId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  layout: layoutSchema.default('grid'),
  config: z.unknown(),
})
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  layout: layoutSchema.optional(),
  config: z.unknown().optional(),
  isShared: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
})
const resolveQuerySchema = z.object({
  objectId: z.string().min(1),
  viewId: z.string().min(1).optional(),
  v: z.string().optional(),
  reset: z.enum(['true', 'false']).optional(),
})

function mapSavedView(view: SavedView, attributes: AttributeDef[]) {
  return {
    id: view.id,
    objectId: view.objectId,
    name: view.name,
    layout: view.layout,
    config: repairSavedViewConfig(view.configJson, attributes),
    ownerUserId: view.ownerUserId,
    isShared: view.isShared,
    isDefault: view.isDefault,
    sortOrder: view.sortOrder,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  }
}

// Request bodies arrive as JSON and config repairs only keep JSON-compatible
// structure. Round-tripping makes that boundary explicit to Prisma's Json type
// rather than allowing an `unknown` filter literal through the persistence API.
function toConfigJson(config: ReturnType<typeof repairSavedViewConfig>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue
}

async function loadObjectAndAttributes(orgId: string, objectId: string) {
  const object = await prisma.objectDef.findFirst({ where: { id: objectId, orgId, deletedAt: null }, select: { id: true } })
  if (!object) return null
  const attributes = await prisma.attributeDef.findMany({
    where: { orgId, objectId, deletedAt: null, isArchived: false },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return { object, attributes }
}

async function findVisibleView(orgId: string, id: string, userId: string, includeDeleted = false) {
  const view = await prisma.savedView.findFirst({ where: { id, orgId, ...(includeDeleted ? {} : { deletedAt: null }) } })
  return view && canViewSavedView(view, userId) ? view : null
}

router.use(requireAuth)

// GET /api/orgs/:orgId/saved-views?objectId=... — personal plus shared discovery.
router.get('/', wrapRoute('GET /api/orgs/:orgId/saved-views', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const objectId = typeof req.query.objectId === 'string' ? req.query.objectId : ''
  if (!objectId) return void res.status(400).json({ error: 'An objectId query param is required.' })
  const loaded = await loadObjectAndAttributes(orgId, objectId)
  if (!loaded) return void res.status(404).json({ error: 'Object not found' })
  const views = await prisma.savedView.findMany({
    where: { orgId, objectId, deletedAt: null, OR: [{ ownerUserId: authReq.user!.id }, { isShared: true }] },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  res.json({ views: views.map((view) => mapSavedView(view, loaded.attributes)) })
}))

// GET /resolve is deliberately before /:id. It composes an optional safe URL overlay;
// reset simply discards that session-only overlay and never writes a view.
router.get('/resolve', wrapRoute('GET /api/orgs/:orgId/saved-views/resolve', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = resolveQuerySchema.safeParse(req.query)
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const loaded = await loadObjectAndAttributes(orgId, parsed.data.objectId)
  if (!loaded) return void res.status(404).json({ error: 'Object not found' })
  const userId = authReq.user!.id
  const view = parsed.data.viewId
    ? await findVisibleView(orgId, parsed.data.viewId, userId)
    : await prisma.savedView.findFirst({
      where: { orgId, objectId: loaded.object.id, deletedAt: null, isDefault: true, OR: [{ ownerUserId: userId }, { isShared: true }] },
      orderBy: [{ isShared: 'asc' }, { updatedAt: 'desc' }],
    })
  if (parsed.data.viewId && (!view || view.objectId !== loaded.object.id)) {
    return void res.status(404).json({ error: 'Saved view not found' })
  }
  const persisted = view ? repairSavedViewConfig(view.configJson, loaded.attributes) : repairSavedViewConfig({}, loaded.attributes)
  const overlay = parsed.data.reset === 'true' ? undefined : decodeUrlViewOverlay(parsed.data.v, loaded.attributes)
  const config = applyUrlViewOverlay(persisted, overlay)
  res.json({
    view: view ? mapSavedView(view, loaded.attributes) : null,
    config,
    layout: overlay?.layout ?? (view?.layout as ViewLayout | undefined) ?? 'grid',
    hasUnsavedChanges: Boolean(overlay),
  })
}))

router.post('/', wrapRoute('POST /api/orgs/:orgId/saved-views', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const loaded = await loadObjectAndAttributes(orgId, parsed.data.objectId)
  if (!loaded) return void res.status(422).json({ error: 'Object not found in this organization.' })
  const view = await prisma.savedView.create({
    data: {
      orgId,
      objectId: loaded.object.id,
      ownerUserId: authReq.user!.id,
      name: parsed.data.name,
      layout: parsed.data.layout,
      configJson: toConfigJson(repairSavedViewConfig(parsed.data.config, loaded.attributes)),
      isShared: false,
      isDefault: false,
    },
  })
  res.status(201).json({ view: mapSavedView(view, loaded.attributes) })
}))

router.get('/:id', wrapRoute('GET /api/orgs/:orgId/saved-views/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const view = await findVisibleView(orgId, String(req.params.id), authReq.user!.id)
  if (!view) return void res.status(404).json({ error: 'Saved view not found' })
  const loaded = await loadObjectAndAttributes(orgId, view.objectId)
  if (!loaded) return void res.status(404).json({ error: 'Object not found' })
  res.json({ view: mapSavedView(view, loaded.attributes) })
}))

router.patch('/:id', wrapRoute('PATCH /api/orgs/:orgId/saved-views/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  const view = await findVisibleView(orgId, String(req.params.id), authReq.user!.id)
  if (!view || !canEditSavedView(view, authReq.user!.id)) return void res.status(404).json({ error: 'Saved view not found' })
  if (parsed.data.isShared !== undefined && !canShareSavedView(view, authReq.user!.id)) {
    return void res.status(404).json({ error: 'Saved view not found' })
  }
  if (parsed.data.isShared !== undefined && parsed.data.isShared !== view.isShared && view.isDefault) {
    return void res.status(409).json({ error: 'Choose another default before changing this view’s visibility.' })
  }
  const loaded = await loadObjectAndAttributes(orgId, view.objectId)
  if (!loaded) return void res.status(404).json({ error: 'Object not found' })
  const data = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.layout !== undefined ? { layout: parsed.data.layout } : {}),
    ...(parsed.data.config !== undefined ? { configJson: toConfigJson(repairSavedViewConfig(parsed.data.config, loaded.attributes)) } : {}),
    ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
    ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
  }
  const updated = await prisma.savedView.updateMany({ where: { id: view.id, orgId, deletedAt: null }, data })
  if (updated.count === 0) return void res.status(404).json({ error: 'Saved view not found' })
  const current = await prisma.savedView.findFirst({ where: { id: view.id, orgId, deletedAt: null } })
  if (!current) return void res.status(404).json({ error: 'Saved view not found' })
  res.json({ view: mapSavedView(current, loaded.attributes) })
}))

router.post('/:id/duplicate', wrapRoute('POST /api/orgs/:orgId/saved-views/:id/duplicate', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const source = await findVisibleView(orgId, String(req.params.id), authReq.user!.id)
  if (!source) return void res.status(404).json({ error: 'Saved view not found' })
  const loaded = await loadObjectAndAttributes(orgId, source.objectId)
  if (!loaded) return void res.status(404).json({ error: 'Object not found' })
  const copy = await prisma.savedView.create({
    data: { orgId, objectId: source.objectId, ownerUserId: authReq.user!.id, name: `${source.name} copy`, layout: source.layout, configJson: toConfigJson(repairSavedViewConfig(source.configJson, loaded.attributes)), isShared: false, isDefault: false },
  })
  res.status(201).json({ view: mapSavedView(copy, loaded.attributes) })
}))

router.post('/:id/default', wrapRoute('POST /api/orgs/:orgId/saved-views/:id/default', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const view = await findVisibleView(orgId, String(req.params.id), authReq.user!.id)
  if (!view || !canEditSavedView(view, authReq.user!.id)) return void res.status(404).json({ error: 'Saved view not found' })
  const audience = view.isShared
    ? { isShared: true }
    : { isShared: false, ownerUserId: view.ownerUserId }
  await prisma.$transaction(async (tx) => {
    // Lock the object row, including the empty-view case, so two set-default
    // requests cannot both clear the audience and then each select themselves.
    await tx.$queryRaw`SELECT id FROM "ObjectDef" WHERE id = ${view.objectId} AND "orgId" = ${orgId} FOR UPDATE`
    await tx.savedView.updateMany({ where: { orgId, objectId: view.objectId, deletedAt: null, ...audience }, data: { isDefault: false } })
    const updated = await tx.savedView.updateMany({ where: { id: view.id, orgId, deletedAt: null, ...audience }, data: { isDefault: true } })
    if (updated.count === 0) throw new Error('Saved view disappeared while setting the default.')
  })
  res.status(204).end()
}))

router.delete('/:id', wrapRoute('DELETE /api/orgs/:orgId/saved-views/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const view = await findVisibleView(orgId, String(req.params.id), authReq.user!.id)
  if (!view || !canEditSavedView(view, authReq.user!.id)) return void res.status(404).json({ error: 'Saved view not found' })
  if (view.isDefault) return void res.status(409).json({ error: 'Choose another default before deleting this view.' })
  const deleted = await prisma.savedView.updateMany({ where: { id: view.id, orgId, deletedAt: null, isDefault: false }, data: { deletedAt: new Date() } })
  if (deleted.count === 0) return void res.status(404).json({ error: 'Saved view not found' })
  res.status(204).end()
}))

router.post('/:id/restore', wrapRoute('POST /api/orgs/:orgId/saved-views/:id/restore', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const view = await findVisibleView(orgId, String(req.params.id), authReq.user!.id, true)
  if (!view || !view.deletedAt || !canEditSavedView(view, authReq.user!.id)) return void res.status(404).json({ error: 'Saved view not found' })
  const restored = await prisma.savedView.updateMany({ where: { id: view.id, orgId, deletedAt: { not: null } }, data: { deletedAt: null } })
  if (restored.count === 0) return void res.status(404).json({ error: 'Saved view not found' })
  res.status(204).end()
}))

export default router
