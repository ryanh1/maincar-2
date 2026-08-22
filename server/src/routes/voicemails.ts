/**
 * One inbound voicemail, in full.
 *
 * Mounted at /api/orgs/:orgId/voicemails. The list belongs to MAI-49; this
 * router owns only the single-record contract MAI-50 needs to display, download,
 * and delete one private voicemail without exposing a storage key to the browser.
 */
import { Router } from 'express'
import { z } from 'zod'

import { deleteObject, getRecordingDownloadUrl } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { Voicemail } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const LIST_DEFAULT_LIMIT = 25
const LIST_MAX_LIMIT = 100

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page starts at 1.').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Ask for at least one row.')
    .max(LIST_MAX_LIMIT, `Ask for at most ${LIST_MAX_LIMIT} rows at a time.`)
    .default(LIST_DEFAULT_LIMIT),
  q: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^\+?\d{1,15}$/, 'Search by digits of the caller number, like 201.')
      .optional(),
  ),
})

function mapVoicemailToApi(voicemail: Voicemail, recordingUrl: string | null) {
  return {
    id: voicemail.id,
    fromE164: voicemail.fromE164,
    toE164: voicemail.toE164,
    recordingUrl,
    transcriptStatus: voicemail.transcriptStatus,
    transcript: voicemail.transcript,
    durationS: voicemail.durationS,
    createdAt: voicemail.createdAt.toISOString(),
  }
}

function mapVoicemailToListApi(voicemail: Voicemail) {
  return {
    id: voicemail.id,
    fromE164: voicemail.fromE164,
    durationS: voicemail.durationS,
    transcriptStatus: voicemail.transcriptStatus,
    transcript: voicemail.transcript,
    createdAt: voicemail.createdAt.toISOString(),
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/voicemails — the org's voicemail inbox
// ============================================================
// Recording URLs are short-lived credentials and belong only on MAI-50's detail
// response, never in every row of a paginated inbox.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/voicemails', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = listQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.issues[0].message })
    }
    const { page, limit, q } = parsed.data

    // --- Build filters ---
    const where = { orgId, ...(q ? { fromE164: { contains: q } } : {}) }

    // --- Execute query ---
    const [total, voicemails] = await Promise.all([
      prisma.voicemail.count({ where }),
      prisma.voicemail.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    // --- Return response ---
    res.json({ voicemails: voicemails.map(mapVoicemailToListApi), total, page, limit })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/voicemails/:id — one voicemail, with a signed recording
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/voicemails/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const voicemail = await prisma.voicemail.findFirst({ where: { id, orgId } })
    if (!voicemail) return void res.status(404).json({ error: 'Voicemail not found' })

    // --- Return response ---
    const recordingUrl = voicemail.recordingUrl
      ? await getRecordingDownloadUrl(voicemail.recordingUrl)
      : null
    res.json({ voicemail: mapVoicemailToApi(voicemail, recordingUrl) })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/voicemails/:id — delete one voicemail and its audio
// ============================================================
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/voicemails/:id', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    // Read the key before deleting the row. It stays server-only, then lets the
    // route remove the private recording after the tenant-scoped database delete.
    const voicemail = await prisma.voicemail.findFirst({ where: { id, orgId } })
    if (!voicemail) return void res.status(404).json({ error: 'Voicemail not found' })

    const deleted = await prisma.voicemail.deleteMany({ where: { id, orgId } })
    if (deleted.count === 0) return void res.status(404).json({ error: 'Voicemail not found' })

    // The database record is authoritative: a concurrent upload observes its
    // absence and exits. Storage cleanup follows it; failure is logged for
    // repair, but does not resurrect a voicemail the caller explicitly deleted.
    if (voicemail.recordingUrl) {
      try {
        await deleteObject(voicemail.recordingUrl)
      } catch (error) {
        logger.warn({ orgId, voicemailId: id, error }, 'could not delete voicemail recording')
      }
    }

    // --- Return response ---
    res.status(204).end()
  }),
)

export default router
