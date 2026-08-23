import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const COLOR_TOKENS = ['option-1', 'option-2', 'option-3', 'option-4', 'option-5', 'option-6', 'option-7', 'option-8'] as const
const MAX_PINNED_NEXT_STEPS = 7

class NextStepTypeUnavailableError extends Error {}

const createTypeSchema = z.object({
  value: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/, 'Use lowercase letters, numbers, hyphens, or underscores for the value.'),
  label: z.string().trim().min(1).max(100),
  color: z.enum(COLOR_TOKENS),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isOverflow: z.boolean().optional(),
  requiresDateTime: z.boolean().optional(),
  createsTask: z.boolean().optional(),
}).strict()

const patchTypeSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  color: z.enum(COLOR_TOKENS).optional(),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isOverflow: z.boolean().optional(),
  requiresDateTime: z.boolean().optional(),
  createsTask: z.boolean().optional(),
  isArchived: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { error: 'Send at least one next-step type field to update.' })

const barSchema = z.object({
  pinnedIds: z.array(z.string().trim().min(1).max(128)).max(MAX_PINNED_NEXT_STEPS),
}).strict().superRefine((value, context) => {
  if (new Set(value.pinnedIds).size !== value.pinnedIds.length) {
    context.addIssue({ code: 'custom', message: 'Send each pinned next-step type only once.' })
  }
})

const suggestionSchema = z.object({
  nextStepTypeId: z.string().trim().min(1).max(128).nullable(),
}).strict()

const saveCallNextStepsSchema = z.object({
  nextSteps: z.array(z.object({
    nextStepTypeId: z.string().trim().min(1).max(128),
    scheduledAt: z.coerce.date().nullable().optional(),
  }).strict()).max(20),
}).strict().superRefine((value, context) => {
  const ids = value.nextSteps.map((nextStep) => nextStep.nextStepTypeId)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Choose each next-step type only once.' })
  }
})

function mapType(type: {
  id: string; value: string; label: string; color: string; icon: string | null; isPinned: boolean; pinOrder: number | null; sortOrder: number; isOverflow: boolean; requiresDateTime: boolean; createsTask: boolean; isArchived: boolean; createdAt: Date; updatedAt: Date
}) {
  return {
    id: type.id,
    value: type.value,
    label: type.label,
    color: type.color,
    icon: type.icon,
    isPinned: type.isPinned,
    pinOrder: type.pinOrder,
    sortOrder: type.sortOrder,
    isOverflow: type.isOverflow,
    requiresDateTime: type.requiresDateTime,
    createsTask: type.createsTask,
    isArchived: type.isArchived,
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString(),
  }
}

function mapCallNextStep(nextStep: {
  id: string; scheduledAt: Date | null; sortOrder: number
  nextStepType: { id: string; value: string; label: string; color: string; icon: string | null; requiresDateTime: boolean; createsTask: boolean }
}) {
  return {
    id: nextStep.id,
    scheduledAt: nextStep.scheduledAt ? nextStep.scheduledAt.toISOString() : null,
    sortOrder: nextStep.sortOrder,
    nextStepType: nextStep.nextStepType,
  }
}

const activeTypeOrder: Prisma.NextStepTypeOrderByWithRelationInput[] = [
  { isPinned: 'desc' }, { pinOrder: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' },
]

router.use(requireAuth)

router.get('/types', wrapRoute('GET /api/orgs/:orgId/next-steps/types', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  const types = await prisma.nextStepType.findMany({
    where: { orgId, isArchived: false },
    orderBy: activeTypeOrder,
  })
  res.json({ types: types.map(mapType) })
}))

router.post('/types', wrapRoute('POST /api/orgs/:orgId/next-steps/types', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  // --- Parse & validate params ---
  const parsed = createTypeSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Verify ownership ---
  const existing = await prisma.nextStepType.findFirst({ where: { orgId, value: parsed.data.value } })
  if (existing) return void res.status(409).json({ error: 'A next-step type already uses this value.' })

  // --- Execute query ---
  const type = await prisma.nextStepType.create({
    data: {
      orgId,
      ...parsed.data,
      icon: parsed.data.icon ?? null,
      isOverflow: parsed.data.isOverflow ?? false,
      requiresDateTime: parsed.data.requiresDateTime ?? false,
      createsTask: parsed.data.createsTask ?? false,
    },
  })

  // --- Return response ---
  res.status(201).json({ type: mapType(type) })
}))

router.patch('/types/:id', wrapRoute('PATCH /api/orgs/:orgId/next-steps/types/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const id = String(req.params.id)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  // --- Parse & validate params ---
  const parsed = patchTypeSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Execute query ---
  const type = await prisma.$transaction(async (tx) => {
    const result = await tx.nextStepType.updateMany({ where: { id, orgId }, data: parsed.data })
    if (result.count === 0) return null
    if (parsed.data.isArchived === true) {
      await tx.dispositionNextStepRule.deleteMany({ where: { orgId, nextStepTypeId: id } })
    }
    return tx.nextStepType.findFirst({ where: { id, orgId } })
  })
  if (!type) return void res.status(404).json({ error: 'Next-step type not found' })

  // --- Return response ---
  res.json({ type: mapType(type) })
}))

router.put('/types/bar', wrapRoute('PUT /api/orgs/:orgId/next-steps/types/bar', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  // --- Parse & validate params ---
  const parsed = barSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Verify ownership ---
  let types
  try {
    types = await prisma.$transaction(async (tx) => {
      const selected = await tx.nextStepType.findMany({
        where: { id: { in: parsed.data.pinnedIds }, orgId, isArchived: false },
        select: { id: true },
      })
      if (selected.length !== parsed.data.pinnedIds.length) throw new NextStepTypeUnavailableError()

      // --- Execute query ---
      await tx.nextStepType.updateMany({ where: { orgId, isArchived: false }, data: { isPinned: false, pinOrder: null } })
      for (const [pinOrder, id] of parsed.data.pinnedIds.entries()) {
        const result = await tx.nextStepType.updateMany({
          where: { id, orgId, isArchived: false }, data: { isPinned: true, pinOrder },
        })
        if (result.count !== 1) throw new NextStepTypeUnavailableError()
      }
      return tx.nextStepType.findMany({ where: { orgId, isArchived: false }, orderBy: activeTypeOrder })
    })
  } catch (error) {
    if (error instanceof NextStepTypeUnavailableError) {
      return void res.status(404).json({ error: 'Pinned next-step type not found' })
    }
    throw error
  }

  // --- Return response ---
  res.json({ types: types.map(mapType) })
}))

router.get('/rules', wrapRoute('GET /api/orgs/:orgId/next-steps/rules', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  const rules = await prisma.dispositionNextStepRule.findMany({
    where: { orgId, disposition: { isArchived: false }, nextStepType: { isArchived: false } },
    orderBy: { dispositionId: 'asc' },
    include: { nextStepType: true },
  })
  res.json({ rules: rules.map((rule) => ({ dispositionId: rule.dispositionId, nextStepType: mapType(rule.nextStepType) })) })
}))

router.put('/rules/:dispositionId', wrapRoute('PUT /api/orgs/:orgId/next-steps/rules/:dispositionId', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const dispositionId = String(req.params.dispositionId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  // --- Parse & validate params ---
  const parsed = suggestionSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Verify ownership ---
  const disposition = await prisma.dispositionDef.findFirst({ where: { id: dispositionId, orgId, isArchived: false }, select: { id: true } })
  if (!disposition) return void res.status(400).json({ error: 'Choose an active disposition from this organization.' })
  if (parsed.data.nextStepTypeId) {
    const type = await prisma.nextStepType.findFirst({ where: { id: parsed.data.nextStepTypeId, orgId, isArchived: false }, select: { id: true } })
    if (!type) return void res.status(400).json({ error: 'Choose an active next-step type from this organization.' })
  }

  // --- Execute query ---
  await prisma.$transaction(async (tx) => {
    await tx.dispositionNextStepRule.deleteMany({ where: { orgId, dispositionId } })
    if (parsed.data.nextStepTypeId) {
      await tx.dispositionNextStepRule.create({ data: { orgId, dispositionId, nextStepTypeId: parsed.data.nextStepTypeId } })
    }
  })

  // --- Return response ---
  res.json({ rule: parsed.data.nextStepTypeId ? { dispositionId, nextStepTypeId: parsed.data.nextStepTypeId } : null })
}))

// Mounted separately from the type/settings routes so the already-large Call
// router stays responsible for call read models, not next-step persistence.
export const callNextStepsRouter = Router({ mergeParams: true })

callNextStepsRouter.use(requireAuth)

callNextStepsRouter.put('/', wrapRoute('PUT /api/orgs/:orgId/calls/:callId/next-steps', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const callId = String(req.params.callId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return

  // --- Parse & validate params ---
  const parsed = saveCallNextStepsSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

  // --- Verify ownership ---
  const call = await prisma.call.findFirst({ where: { id: callId, orgId }, select: { id: true } })
  if (!call) return void res.status(404).json({ error: 'Call not found' })
  const typeIds = parsed.data.nextSteps.map((nextStep) => nextStep.nextStepTypeId)
  const types = await prisma.nextStepType.findMany({
    where: { id: { in: typeIds }, orgId, isArchived: false },
    select: { id: true, requiresDateTime: true },
  })
  if (types.length !== typeIds.length) {
    return void res.status(400).json({ error: 'Choose active next-step types from this organization.' })
  }
  const typesById = new Map(types.map((type) => [type.id, type]))
  const dateRequired = parsed.data.nextSteps.find((nextStep) => typesById.get(nextStep.nextStepTypeId)?.requiresDateTime && !nextStep.scheduledAt)
  if (dateRequired) {
    return void res.status(400).json({ error: 'Choose a date and time for every date-required next step.' })
  }

  // --- Execute query ---
  await prisma.$transaction(async (tx) => {
    await tx.callNextStep.deleteMany({ where: { callId, orgId } })
    if (parsed.data.nextSteps.length > 0) {
      await tx.callNextStep.createMany({
        data: parsed.data.nextSteps.map((nextStep, sortOrder) => ({
          orgId,
          callId,
          nextStepTypeId: nextStep.nextStepTypeId,
          scheduledAt: nextStep.scheduledAt ?? null,
          sortOrder,
        })),
      })
    }
  })
  const nextSteps = await prisma.callNextStep.findMany({
    where: { callId, orgId },
    orderBy: { sortOrder: 'asc' },
    include: { nextStepType: { select: { id: true, value: true, label: true, color: true, icon: true, requiresDateTime: true, createsTask: true } } },
  })

  // --- Return response ---
  res.json({ nextSteps: nextSteps.map(mapCallNextStep) })
}))

export default router
