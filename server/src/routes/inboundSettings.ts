import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'

const router = Router({ mergeParams: true })
const e164Schema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Enter a valid E.164 mobile number.')
const strategySchema = z.enum(['simultaneous', 'browser_fallback'])
const patchSchema = z.object({
  enabled: z.boolean(),
  mobileE164: e164Schema.nullable(),
  strategy: strategySchema,
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.mobileE164) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid E.164 mobile number.', path: ['mobileE164'] })
  }
})

function mapForwarding(forwarding: { enabled: boolean; mobileE164: string | null; strategy: string } | null) {
  return forwarding
    ? { enabled: forwarding.enabled, mobileE164: forwarding.mobileE164, strategy: forwarding.strategy }
    : { enabled: false, mobileE164: null, strategy: 'simultaneous' }
}

router.use(requireAuth)

router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/settings/inbound', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user?.id
    if (!userId) return void res.status(401).json({ error: 'Unauthorized' })

    const forwarding = await prisma.inboundForwarding.findUnique({
      where: { orgId_userId: { orgId, userId } },
    })
    return void res.json({ inboundForwarding: mapForwarding(forwarding) })
  }),
)

router.patch(
  '/',
  wrapRoute('PATCH /api/orgs/:orgId/settings/inbound', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return
    const userId = authReq.user?.id
    if (!userId) return void res.status(401).json({ error: 'Unauthorized' })

    const parsed = patchSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    const input = parsed.data
    const forwarding = await prisma.inboundForwarding.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: { orgId, userId, ...input },
      update: input,
    })
    return void res.json({ inboundForwarding: mapForwarding(forwarding) })
  }),
)

export default router
