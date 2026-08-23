import { Router, type Response } from 'express'
import { z } from 'zod'

import {
  ColorRuleNotFoundError,
  ColorRuleValidationError,
  colorRuleService,
  COLOR_RULE_SCOPES,
  COLOR_RULE_TARGETS,
  PREDICATE_OPS,
} from '../crm/colorService.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { ColorRule } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const listSchema = z.object({ viewId: z.string().trim().min(1) })

const predicateSchema = z.object({
  op: z.enum(PREDICATE_OPS),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
})

const createSchema = z.object({
  viewId: z.string().trim().min(1),
  attribute: z.string().trim().min(1),
  predicate: predicateSchema,
  target: z.enum(COLOR_RULE_TARGETS),
  scope: z.enum(COLOR_RULE_SCOPES).default('cell'),
  color: z.string().trim().min(1),
  sortOrder: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
})

const updateSchema = z.object({
  viewId: z.string().trim().min(1),
  attribute: z.string().trim().min(1).optional(),
  predicate: predicateSchema.optional(),
  target: z.enum(COLOR_RULE_TARGETS).optional(),
  scope: z.enum(COLOR_RULE_SCOPES).optional(),
  color: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
})

const reorderSchema = z.object({
  viewId: z.string().trim().min(1),
  ruleIds: z.array(z.string().trim().min(1)).min(1).max(200),
}).superRefine(({ ruleIds }, context) => {
  if (new Set(ruleIds).size !== ruleIds.length) {
    context.addIssue({ code: 'custom', path: ['ruleIds'], message: 'Each rule may appear only once.' })
  }
})

function mapColorRule(colorRule: ColorRule) {
  return {
    id: colorRule.id,
    viewId: colorRule.viewId,
    attribute: colorRule.attribute,
    predicate: colorRule.predicate,
    target: colorRule.target,
    scope: colorRule.scope,
    color: colorRule.color,
    sortOrder: colorRule.sortOrder,
    isDefault: colorRule.isDefault,
    enabled: colorRule.enabled,
    createdAt: colorRule.createdAt.toISOString(),
    updatedAt: colorRule.updatedAt.toISOString(),
  }
}

function sendServiceError(res: Response, error: unknown) {
  if (error instanceof ColorRuleNotFoundError) return res.status(404).json({ error: error.message })
  if (error instanceof ColorRuleValidationError) return res.status(422).json({ error: error.message })
  throw error
}

router.use(requireAuth)

// GET /api/orgs/:orgId/color-rules?viewId=... — every rule in one view, ordered.
router.get('/', wrapRoute('GET /api/orgs/:orgId/color-rules', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = listSchema.safeParse(req.query)
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const colorRules = await colorRuleService.list({ orgId, viewId: parsed.data.viewId, userId: authReq.user!.id })
    return void res.json({ colorRules: colorRules.map(mapColorRule) })
  } catch (error) { return void sendServiceError(res, error) }
}))

// POST /api/orgs/:orgId/color-rules — add one rule to a view.
router.post('/', wrapRoute('POST /api/orgs/:orgId/color-rules', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = createSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const colorRule = await colorRuleService.create({
      orgId,
      viewId: parsed.data.viewId,
      attribute: parsed.data.attribute,
      predicate: parsed.data.predicate,
      target: parsed.data.target,
      scope: parsed.data.scope,
      color: parsed.data.color,
      sortOrder: parsed.data.sortOrder,
      enabled: parsed.data.enabled,
      userId: authReq.user!.id,
    })
    return void res.status(201).json({ colorRule: mapColorRule(colorRule) })
  } catch (error) { return void sendServiceError(res, error) }
}))

// POST /reorder keeps the rule order coherent: the caller submits the whole set.
router.post('/reorder', wrapRoute('POST /api/orgs/:orgId/color-rules/reorder', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = reorderSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    await colorRuleService.reorder({
      orgId,
      viewId: parsed.data.viewId,
      ruleIds: parsed.data.ruleIds,
      userId: authReq.user!.id,
    })
    return void res.status(204).end()
  } catch (error) { return void sendServiceError(res, error) }
}))

// POST /restore-defaults — reset the seeded set to its defaults.
router.post('/restore-defaults', wrapRoute('POST /api/orgs/:orgId/color-rules/restore-defaults', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = listSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const colorRules = await colorRuleService.restoreDefaults({ orgId, viewId: parsed.data.viewId, userId: authReq.user!.id })
    return void res.json({ colorRules: colorRules.map(mapColorRule) })
  } catch (error) { return void sendServiceError(res, error) }
}))

// PATCH /api/orgs/:orgId/color-rules/:id — edit one rule.
router.patch('/:id', wrapRoute('PATCH /api/orgs/:orgId/color-rules/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const parsed = updateSchema.safeParse(req.body ?? {})
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
  try {
    const colorRule = await colorRuleService.update({
      orgId,
      viewId: parsed.data.viewId,
      ruleId: String(req.params.id),
      attribute: parsed.data.attribute,
      predicate: parsed.data.predicate,
      target: parsed.data.target,
      scope: parsed.data.scope,
      color: parsed.data.color,
      sortOrder: parsed.data.sortOrder,
      enabled: parsed.data.enabled,
      userId: authReq.user!.id,
    })
    return void res.json({ colorRule: mapColorRule(colorRule) })
  } catch (error) { return void sendServiceError(res, error) }
}))

// DELETE /api/orgs/:orgId/color-rules/:id — remove one rule.
router.delete('/:id', wrapRoute('DELETE /api/orgs/:orgId/color-rules/:id', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  const orgId = String(req.params.orgId)
  const membership = await requireMembership(authReq, res, orgId)
  if (!membership) return
  const viewId = typeof req.query.viewId === 'string' ? req.query.viewId : ''
  if (!viewId) return void res.status(400).json({ error: 'A viewId query param is required.' })
  try {
    await colorRuleService.delete({ orgId, viewId, ruleId: String(req.params.id), userId: authReq.user!.id })
    return void res.status(204).end()
  } catch (error) { return void sendServiceError(res, error) }
}))

export default router
