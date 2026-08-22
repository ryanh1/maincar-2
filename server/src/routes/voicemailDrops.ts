/**
 * Delete one reusable voicemail drop from an organization's library.
 *
 * Mounted at /api/orgs/:orgId/voicemail-drops. The database record is deleted
 * before its private S3 object, so a failed storage cleanup never revives a drop
 * that a caller explicitly removed.
 */
import { Router } from 'express'

import { deleteObject } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

class LastVoicemailDropError extends Error {
  readonly status = 400

  constructor() {
    super('Your organization must keep at least one voicemail drop.')
  }
}

class VoicemailDropNotFoundError extends Error {
  readonly status = 404

  constructor() {
    super('Voicemail drop not found')
  }
}

/**
 * Locks all drops in the library while the caller decides whether it may delete
 * one. Without this, two requests can both see two drops and each delete one,
 * leaving the organization with none.
 */
async function lockAndCountVoicemailDrops(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM "VoicemailDrop"
      WHERE "orgId" = ${orgId}
      FOR UPDATE
    ) AS locked
  `
  return Number(rows[0]?.count ?? 0)
}

router.use(requireAuth)

// ===================================================================
// DELETE /api/orgs/:orgId/voicemail-drops/:id — remove a library drop
// ===================================================================
router.delete(
  '/:id',
  wrapRoute('DELETE /api/orgs/:orgId/voicemail-drops/:id', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const deletedDrop = await prisma.$transaction(async (tx) => {
      const dropCount = await lockAndCountVoicemailDrops(tx, orgId)
      const drop = await tx.voicemailDrop.findFirst({ where: { id, orgId } })
      if (!drop) throw new VoicemailDropNotFoundError()
      if (dropCount <= 1) throw new LastVoicemailDropError()

      const deleted = await tx.voicemailDrop.deleteMany({ where: { id, orgId } })
      if (deleted.count === 0) throw new VoicemailDropNotFoundError()

      if (drop.isDefault) {
        const replacement = await tx.voicemailDrop.findFirst({
          where: { orgId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        if (!replacement) throw new Error('Voicemail drop replacement missing after deletion')

        const promoted = await tx.voicemailDrop.updateMany({
          where: { id: replacement.id, orgId },
          data: { isDefault: true },
        })
        if (promoted.count === 0) throw new VoicemailDropNotFoundError()
      }

      return drop
    })

    // Storage cleanup happens after the committed, tenant-scoped database
    // delete. Keep the successful deletion visible if storage is temporarily
    // unavailable; the warning gives repair tooling the precise object key.
    try {
      await deleteObject(deletedDrop.audioUrl)
    } catch (error) {
      logger.warn({ orgId, voicemailDropId: id, error }, 'could not delete voicemail drop audio')
    }

    // --- Return response ---
    res.status(204).end()
  }),
)

export default router
