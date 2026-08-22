import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { NPA_TO_STATE } from '../lib/npaToState.js'

const router = Router({ mergeParams: true })
const US_STATE_CODES = new Set(Object.values(NPA_TO_STATE))
const BLOCKED_STATE_VALUES = new Set([...US_STATE_CODES, 'UNKNOWN'])

const blockedStatesSchema = z
  .array(z.string().trim().toUpperCase())
  .refine((states) => states.every((state) => BLOCKED_STATE_VALUES.has(state)), {
    error: 'Choose US states or Unknown.',
  })
  .transform((states) => [...new Set(states)].sort())

const patchSchema = z
  .object({
    recordCalls: z.boolean().optional(),
    blockedStates: blockedStatesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'Choose a recording setting to update.' })

function mapPolicy(org: {
  recordCalls: boolean
  recordingBlockedStates: string[]
}) {
  return {
    recordCalls: org.recordCalls,
    blockedStates: org.recordingBlockedStates,
  }
}

router.use(requireAuth)

router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/settings/recording', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    return void res.json({ recordingPolicy: mapPolicy(membership.org) })
  }),
)

router.patch(
  '/',
  wrapRoute('PATCH /api/orgs/:orgId/settings/recording', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    const parsed = patchSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    const result = await prisma.org.updateMany({
      where: { id: orgId, enabled: true },
      data: {
        ...(parsed.data.recordCalls === undefined ? {} : { recordCalls: parsed.data.recordCalls }),
        ...(parsed.data.blockedStates === undefined
          ? {}
          : { recordingBlockedStates: parsed.data.blockedStates }),
      },
    })
    if (result.count === 0) return void res.status(404).json({ error: 'Organization not found' })

    const org = await prisma.org.findFirst({
      where: { id: orgId, enabled: true },
      select: {
        recordCalls: true,
        recordingBlockedStates: true,
      },
    })
    if (!org) return void res.status(404).json({ error: 'Organization not found' })

    return void res.json({ recordingPolicy: mapPolicy(org) })
  }),
)

export default router
