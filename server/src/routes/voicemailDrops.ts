/**
 * Delete one reusable voicemail drop from an organization's library.
 *
 * Mounted at /api/orgs/:orgId/voicemail-drops. The database record is deleted
 * before its private S3 object, so a failed storage cleanup never revives a drop
 * that a caller explicitly removed.
 */
import { randomUUID } from 'node:crypto'

import { Router } from 'express'
import multer from 'multer'

import { deleteObject, putObjectBytes } from '../../dependencies/s3.js'
import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { queueTranscodeVoicemailDrop } from '../jobs/transcodeVoicemailDrop.js'
import { queueTranscribeVoicemailDrop } from '../jobs/transcribeVoicemailDrop.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { ensureOneDefault, lockVoicemailDrops } from '../lib/voicemailDropDefaults.js'

const router = Router({ mergeParams: true })
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2 },
})

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

class VoicemailDropUploadError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
  }
}

async function parseAudioUpload(req: import('express').Request, res: import('express').Response): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upload.single('audio')(req, res, (error) => {
      if (error) reject(new VoicemailDropUploadError('Upload one WebM audio file no larger than 20MB.'))
      else resolve()
    })
  })
}

function isWebm(file: Express.Multer.File | undefined): file is Express.Multer.File {
  return file?.mimetype === 'audio/webm'
    && file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
}

router.use(requireAuth)

// ===================================================================
// POST /api/orgs/:orgId/voicemail-drops — add a library drop for processing
// ===================================================================
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/voicemail-drops', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    await parseAudioUpload(req, res)
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    const isDefault = req.body.isDefault === undefined
      ? false
      : req.body.isDefault === 'true'
        ? true
        : req.body.isDefault === 'false'
          ? false
          : null

    if (!name) throw new VoicemailDropUploadError('Name is required.')
    if (isDefault === null) throw new VoicemailDropUploadError('isDefault must be true or false.')
    if (!isWebm(req.file)) throw new VoicemailDropUploadError('Upload a valid WebM audio file.')

    const voicemailDropId = randomUUID()
    const audioKey = `maincar-voicemail-drops/${orgId}/${voicemailDropId}.webm`
    let storedAudio = false
    let dropCreated = false

    try {
      await putObjectBytes({ key: audioKey, body: req.file.buffer, contentType: 'audio/webm' })
      storedAudio = true

      // --- Execute query ---
      const drop = await prisma.$transaction(async (tx) => {
        const created = await tx.voicemailDrop.create({
          data: { id: voicemailDropId, orgId, name, audioUrl: audioKey, duration: 0 },
        })
        const defaultId = await ensureOneDefault(tx, orgId, isDefault
          ? { defaultId: created.id }
          : { fallbackDefaultId: created.id })
        return { ...created, isDefault: defaultId === created.id }
      })
      dropCreated = true

      const [transcodeJobId, transcribeJobId] = await Promise.all([
        queueTranscodeVoicemailDrop({ orgId, voicemailDropId: drop.id }),
        queueTranscribeVoicemailDrop(drop.id),
      ])
      if (!transcodeJobId || !transcribeJobId) throw new Error('Voicemail drop processing jobs were not queued')

      // --- Return response ---
      res.status(201).json({ drop })
    } catch (error) {
      if (storedAudio && !dropCreated) {
        try {
          await deleteObject(audioKey)
        } catch (cleanupError) {
          logger.warn({ orgId, voicemailDropId, cleanupError }, 'could not remove failed voicemail drop upload')
        }
      }
      throw error
    }
  }),
)

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
      const dropCount = await lockVoicemailDrops(tx, orgId)
      const drop = await tx.voicemailDrop.findFirst({ where: { id, orgId } })
      if (!drop) throw new VoicemailDropNotFoundError()
      if (dropCount <= 1) throw new LastVoicemailDropError()

      const deleted = await tx.voicemailDrop.deleteMany({ where: { id, orgId } })
      if (deleted.count === 0) throw new VoicemailDropNotFoundError()

      if (drop.isDefault) await ensureOneDefault(tx, orgId)

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
