/**
 * One inbound voicemail, in full.
 *
 * Mounted at /api/orgs/:orgId/voicemails. The list belongs to MAI-49; this
 * router owns only the single-record contract MAI-50 needs to display, download,
 * and delete one private voicemail without exposing a storage key to the browser.
 */
import { Router } from 'express'

import { deleteObject, getRecordingDownloadUrl } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { Voicemail } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

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

router.use(requireAuth)

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
