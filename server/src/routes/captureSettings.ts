import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { DEFAULT_CAPTURE_SETTINGS } from '../lib/captureExclusions.js'
import { JOB_CAPTURE_PURGE, sendJob } from '../jobs/queue.js'

const router = Router({ mergeParams: true })

const LOG_ACTIVITY_TYPES = ['email', 'meetings', 'both'] as const
const backfillMonthsSchema = z.union([z.literal(3), z.literal(6), z.literal(12)])

const domainList = z
  .array(z.string().trim().toLowerCase().min(1).max(253))
  .max(200)
  .transform((values) => [...new Set(values)])

const addressList = z
  .array(z.string().trim().toLowerCase().min(1).max(320))
  .max(200)
  .transform((values) => [...new Set(values)])

const subjectList = z
  .array(z.string().trim().min(1).max(200))
  .max(200)
  .transform((values) => [...new Set(values)])

const settingsSchema = z
  .object({
    internalDomains: domainList,
    allowDomains: domainList,
    excludeDomains: domainList,
    excludeAddresses: addressList,
    excludeRoleAddresses: z.boolean(),
    dropBulkInbound: z.boolean(),
    bulkInboundMax: z.number().int().min(1).max(10_000),
    subjectExcludes: subjectList,
    logActivityTypes: z.enum(LOG_ACTIVITY_TYPES),
    backfillMonths: backfillMonthsSchema,
  })
  .strict()

const optOutSchema = z.object({ optedOut: z.boolean() }).strict()

type SettingsInput = z.infer<typeof settingsSchema>

function mapSettings(settings: {
  internalDomains: string[]
  allowDomains: string[]
  excludeDomains: string[]
  excludeAddresses: string[]
  excludeRoleAddresses: boolean
  dropBulkInbound: boolean
  bulkInboundMax: number
  subjectExcludes: string[]
  logActivityTypes: string
  backfillMonths: number
}): SettingsInput {
  return {
    internalDomains: settings.internalDomains,
    allowDomains: settings.allowDomains,
    excludeDomains: settings.excludeDomains,
    excludeAddresses: settings.excludeAddresses,
    excludeRoleAddresses: settings.excludeRoleAddresses,
    dropBulkInbound: settings.dropBulkInbound,
    bulkInboundMax: settings.bulkInboundMax,
    subjectExcludes: settings.subjectExcludes,
    logActivityTypes: settings.logActivityTypes as SettingsInput['logActivityTypes'],
    backfillMonths: settings.backfillMonths as SettingsInput['backfillMonths'],
  }
}

function hasAddedExclusion(previous: SettingsInput, next: SettingsInput): boolean {
  const addsListValue = (key: 'internalDomains' | 'allowDomains' | 'excludeDomains' | 'excludeAddresses' | 'subjectExcludes') =>
    next[key].some((value) => !previous[key].includes(value))
  if (
    addsListValue('internalDomains') ||
    addsListValue('allowDomains') ||
    addsListValue('excludeDomains') ||
    addsListValue('excludeAddresses') ||
    addsListValue('subjectExcludes')
  ) return true
  if (!previous.excludeRoleAddresses && next.excludeRoleAddresses) return true
  if (!previous.dropBulkInbound && next.dropBulkInbound) return true
  if (previous.dropBulkInbound && next.dropBulkInbound && next.bulkInboundMax < previous.bulkInboundMax) return true

  const activityTypes = (value: SettingsInput['logActivityTypes']) =>
    value === 'both' ? ['email', 'meetings'] : [value]
  return activityTypes(previous.logActivityTypes).some((value) => !activityTypes(next.logActivityTypes).includes(value))
}

router.use(requireAuth)

router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/settings/capture', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    const [settings, optOut] = await Promise.all([
      prisma.captureSettings.findUnique({ where: { orgId } }),
      prisma.mailCaptureOptOut.findUnique({
        where: { orgId_userId: { orgId, userId: authReq.user!.id } },
      }),
    ])

    return void res.json({
      captureSettings: settings
        ? mapSettings(settings)
        : { ...DEFAULT_CAPTURE_SETTINGS, backfillMonths: 12 },
      optedOut: optOut !== null,
    })
  }),
)

router.patch(
  '/',
  wrapRoute('PATCH /api/orgs/:orgId/settings/capture', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = settingsSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    const existing = await prisma.captureSettings.findUnique({ where: { orgId } })
    const previous: SettingsInput = existing
      ? mapSettings(existing)
      : { ...DEFAULT_CAPTURE_SETTINGS, backfillMonths: 12 }
    const settings = await prisma.captureSettings.upsert({
      where: { orgId },
      create: { orgId, ...parsed.data },
      update: parsed.data,
    })

    const purgeQueued = hasAddedExclusion(previous, parsed.data)
    if (purgeQueued) {
      const ruleId = `${settings.id}:${settings.updatedAt.toISOString()}`
      await sendJob(
        JOB_CAPTURE_PURGE,
        { orgId, actorId: authReq.user!.id, ruleId, settings: parsed.data },
        { singletonKey: ruleId, retryLimit: 3 },
      )
    }

    // --- Return response ---
    return void res.json({ captureSettings: mapSettings(settings), purgeQueued })
  }),
)

router.put(
  '/opt-out',
  wrapRoute('PUT /api/orgs/:orgId/settings/capture/opt-out', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = optOutSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    const userId = authReq.user!.id
    if (parsed.data.optedOut) {
      await prisma.mailCaptureOptOut.upsert({
        where: { orgId_userId: { orgId, userId } },
        create: { orgId, userId },
        update: {},
      })
    } else {
      await prisma.mailCaptureOptOut.deleteMany({ where: { orgId, userId } })
    }

    // --- Return response ---
    return void res.json({ optedOut: parsed.data.optedOut })
  }),
)

export default router
