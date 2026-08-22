import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'

const router = Router({ mergeParams: true })

const COLOR_TOKENS = ['option-1', 'option-2', 'option-3', 'option-4', 'option-5', 'option-6', 'option-7', 'option-8'] as const
const CATEGORY_VALUES = ['connected', 'not_connected'] as const

const createSchema = z.object({
  value: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/, 'Use lowercase letters, numbers, hyphens, or underscores for the value.'),
  label: z.string().trim().min(1).max(100),
  color: z.enum(COLOR_TOKENS),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  category: z.enum(CATEGORY_VALUES),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict()

const patchSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  color: z.enum(COLOR_TOKENS).optional(),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isArchived: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { error: 'Send at least one disposition field to update.' })

function mapDisposition(disposition: {
  id: string; value: string; label: string; color: string; icon: string | null; category: string; isStandard: boolean; sortOrder: number; isArchived: boolean; createdAt: Date; updatedAt: Date
}) {
  return {
    id: disposition.id,
    value: disposition.value,
    label: disposition.label,
    color: disposition.color,
    icon: disposition.icon,
    category: disposition.category,
    isStandard: disposition.isStandard,
    sortOrder: disposition.sortOrder,
    isArchived: disposition.isArchived,
    createdAt: disposition.createdAt.toISOString(),
    updatedAt: disposition.updatedAt.toISOString(),
  }
}

router.use(requireAuth)

router.get('/', wrapRoute('GET /api/orgs/:orgId/dispositions', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  const dispositions = await prisma.dispositionDef.findMany({
    where: { orgId, isArchived: false },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
  res.json({ dispositions: dispositions.map(mapDisposition) })
}))

router.post('/', wrapRoute('POST /api/orgs/:orgId/dispositions', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  const parsed = createSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  const existing = await prisma.dispositionDef.findFirst({ where: { orgId, value: parsed.data.value } })
  if (existing) return void res.status(409).json({ error: 'A disposition already uses this value.' })

  const disposition = await prisma.dispositionDef.create({
    data: { orgId, ...parsed.data, icon: parsed.data.icon ?? null, isStandard: false },
  })
  res.status(201).json({ disposition: mapDisposition(disposition) })
}))

router.patch('/:id', wrapRoute('PATCH /api/orgs/:orgId/dispositions/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const id = String(req.params.id)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  const parsed = patchSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  const result = await prisma.dispositionDef.updateMany({ where: { id, orgId }, data: parsed.data })
  if (result.count === 0) return void res.status(404).json({ error: 'Disposition not found' })
  const disposition = await prisma.dispositionDef.findFirst({ where: { id, orgId } })
  if (!disposition) return void res.status(404).json({ error: 'Disposition not found' })
  res.json({ disposition: mapDisposition(disposition) })
}))

router.delete('/:id', wrapRoute('DELETE /api/orgs/:orgId/dispositions/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const id = String(req.params.id)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  const result = await prisma.dispositionDef.updateMany({
    where: { id, orgId, isArchived: false }, data: { isArchived: true },
  })
  if (result.count === 0) return void res.status(404).json({ error: 'Disposition not found' })
  res.status(204).end()
}))

export default router
