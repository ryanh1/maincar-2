import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { DetailLayout, Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fields: z.array(z.object({
    slug: z.string().trim().min(1),
    width: z.union([z.literal(1), z.literal(2)]),
  }).strict()),
  order: z.number().int().min(0),
}).strict()

const layoutSchema = z.object({
  sections: z.array(sectionSchema).min(1),
  railObjects: z.array(z.string().trim().min(1)).default([]),
  feedKinds: z.array(z.string().trim().min(1)).default([]),
}).strict()

type DetailLayoutConfig = z.infer<typeof layoutSchema>

function defaultLayout(objectId: string): DetailLayoutConfig & { objectId: string; isDefault: true } {
  return {
    objectId,
    sections: [{ name: 'Details', fields: [], order: 0 }],
    railObjects: [],
    feedKinds: [],
    isDefault: true,
  }
}

function mapLayout(layout: DetailLayout) {
  return {
    id: layout.id,
    objectId: layout.objectId,
    sections: layout.sectionsJson,
    railObjects: layout.railObjectsJson ?? [],
    feedKinds: layout.feedKindsJson ?? [],
    isDefault: layout.isDefault,
    createdAt: layout.createdAt.toISOString(),
    updatedAt: layout.updatedAt.toISOString(),
  }
}

async function findObjectInOrg(orgId: string, objectId: string) {
  return prisma.objectDef.findFirst({ where: { id: objectId, orgId, deletedAt: null } })
}

router.use(requireAuth)

router.get('/:objectId', wrapRoute('GET /api/orgs/:orgId/detail-layouts/:objectId', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)

  // --- Verify ownership ---
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const object = await findObjectInOrg(orgId, objectId)
  if (!object) return void res.status(404).json({ error: 'Object not found' })

  // --- Execute query ---
  const layout = await prisma.detailLayout.findFirst({ where: { orgId, objectId } })

  // --- Return response ---
  res.json({ layout: layout ? mapLayout(layout) : defaultLayout(objectId) })
}))

router.put('/:objectId', wrapRoute('PUT /api/orgs/:orgId/detail-layouts/:objectId', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const objectId = String(req.params.objectId)

  // --- Verify ownership ---
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const object = await findObjectInOrg(orgId, objectId)
  if (!object) return void res.status(404).json({ error: 'Object not found' })

  // --- Parse & validate params ---
  const parsed = layoutSchema.safeParse(req.body)
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Execute query ---
  const data = {
    sectionsJson: parsed.data.sections as Prisma.InputJsonValue,
    railObjectsJson: parsed.data.railObjects as Prisma.InputJsonValue,
    feedKindsJson: parsed.data.feedKinds as Prisma.InputJsonValue,
    isDefault: true,
  }
  const layout = await prisma.detailLayout.upsert({
    where: { orgId_objectId: { orgId, objectId } },
    create: { orgId, objectId, ...data },
    update: data,
  })

  // --- Return response ---
  res.json({ layout: mapLayout(layout) })
}))

export default router
