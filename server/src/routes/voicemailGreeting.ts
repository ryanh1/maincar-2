import { createHash, randomUUID } from 'node:crypto'

import { Router, type Request, type Response } from 'express'
import multer from 'multer'

import { logger } from '../../dependencies/logger.js'
import { deleteObject, getRecordingDownloadUrl, putObjectBytes } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { queueTranscodeGreeting } from '../jobs/transcodeGreeting.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
})
const MAX_IDEMPOTENCY_KEY_LENGTH = 200
const GREETING_URL_TTL_SECONDS = 300

class GreetingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

type GreetingRow = {
  id: string
  status: string
  storageKey: string | null
  durationSeconds: number | null
  failureReason: string | null
  uploadedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function mapGreeting(row: GreetingRow, audioUrl: string | null) {
  return {
    id: row.id,
    status: row.status,
    durationSeconds: row.durationSeconds,
    failureReason: row.failureReason,
    audioUrl,
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function audioExtension(file: Express.Multer.File): 'webm' | 'mp3' | null {
  const isWebm = file.mimetype === 'audio/webm'
    && file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  if (isWebm) return 'webm'

  const isMp3MimeType = ['audio/mpeg', 'audio/mp3'].includes(file.mimetype)
  const hasId3Header = file.buffer.subarray(0, 3).equals(Buffer.from('ID3'))
  const hasMpegFrameHeader = file.buffer.length >= 2
    && file.buffer[0] === 0xff
    && (file.buffer[1] & 0xe0) === 0xe0
  return isMp3MimeType && (hasId3Header || hasMpegFrameHeader) ? 'mp3' : null
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002'
}

async function parseAudioUpload(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upload.single('audio')(req, res, (error) => {
      if (error) reject(new GreetingError('Upload one audio file no larger than 20MB.', 400))
      else resolve()
    })
  })
}

async function requireOrgMembership(req: Request, res: Response): Promise<string | null> {
  const orgId = String(req.params.orgId)
  return await requireMembership(req as AuthenticatedRequest, res, orgId) ? orgId : null
}

async function greetingAudioUrl(storageKey: string | null): Promise<string | null> {
  return storageKey ? getRecordingDownloadUrl(storageKey, GREETING_URL_TTL_SECONDS) : null
}

async function getExistingIdempotentGreeting(
  orgId: string,
  idempotencyKey: string,
  contentHash: string,
): Promise<GreetingRow | null> {
  const existing = await prisma.voicemailGreeting.findFirst({
    where: { orgId, idempotencyKey },
  })

  if (existing && existing.contentHash !== contentHash) {
    throw new GreetingError('Idempotency-Key was reused with different audio.', 422)
  }

  return existing
}

router.use(requireAuth)

// GET /api/orgs/:orgId/voicemail-greeting — return only tenant-owned candidates.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/voicemail-greeting', async (req, res) => {
    const orgId = await requireOrgMembership(req, res)
    if (!orgId) return

    const rows = await prisma.voicemailGreeting.findMany({
      where: { orgId, status: { not: 'deleted' } },
      orderBy: { createdAt: 'desc' },
    })
    const greetings = await Promise.all(rows.map(async (row) => (
      mapGreeting(row, await greetingAudioUrl(row.storageKey))
    )))

    res.json({
      greeting: {
        active: greetings.find((greeting) => greeting.status === 'active') ?? null,
        candidates: greetings.filter((greeting) => greeting.status !== 'active'),
      },
    })
  }),
)

// POST /api/orgs/:orgId/voicemail-greeting — create an immutable candidate and queue validation.
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/voicemail-greeting', async (req, res) => {
    const orgId = await requireOrgMembership(req, res)
    if (!orgId) return

    await parseAudioUpload(req, res)
    const file = req.file
    const extension = file && audioExtension(file)
    const idempotencyKey = req.get('Idempotency-Key')

    if (!file || !extension) {
      throw new GreetingError('Upload a valid WebM or MP3 audio file.', 400)
    }
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new GreetingError('Idempotency-Key is required and must be 200 characters or fewer.', 400)
    }

    const contentHash = createHash('sha256').update(file.buffer).digest('hex')
    const existing = await getExistingIdempotentGreeting(orgId, idempotencyKey, contentHash)
    if (existing) {
      return void res.status(200).json({
        greeting: mapGreeting(existing, await greetingAudioUrl(existing.storageKey)),
      })
    }

    const greetingId = randomUUID()
    const sourceKey = `voicemail-greeting-uploads/${orgId}/${greetingId}.${extension}`
    let candidate: GreetingRow
    try {
      candidate = await prisma.voicemailGreeting.create({
        data: {
          id: greetingId,
          orgId,
          sourceKey,
          contentHash,
          idempotencyKey,
          status: 'uploading',
        },
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error

      const concurrentCandidate = await getExistingIdempotentGreeting(orgId, idempotencyKey, contentHash)
      if (!concurrentCandidate) throw error
      return void res.status(200).json({
        greeting: mapGreeting(concurrentCandidate, await greetingAudioUrl(concurrentCandidate.storageKey)),
      })
    }

    try {
      await putObjectBytes({ key: sourceKey, body: file.buffer, contentType: file.mimetype })
      await prisma.voicemailGreeting.updateMany({
        where: { id: greetingId, orgId, status: 'uploading' },
        data: { status: 'transcoding' },
      })
      const jobId = await queueTranscodeGreeting({ orgId, greetingId })
      if (!jobId) throw new Error('Greeting conversion job was not queued')
    } catch (error) {
      await prisma.voicemailGreeting.updateMany({
        where: { id: greetingId, orgId, status: { in: ['uploading', 'transcoding'] } },
        data: { status: 'failed', failureReason: 'Upload could not be processed.' },
      })
      try {
        await deleteObject(sourceKey)
      } catch (cleanupError) {
        logger.warn({ orgId, greetingId, cleanupError }, 'could not remove failed greeting upload')
      }
      logger.warn({ orgId, greetingId, error }, 'could not queue voicemail greeting candidate')
      throw new GreetingError('Upload could not be processed.', 503)
    }

    res.status(201).json({
      greeting: mapGreeting({ ...candidate, status: 'transcoding' }, null),
    })
  }),
)

// POST /api/orgs/:orgId/voicemail-greeting/:greetingId/activate — explicitly promote one ready candidate.
router.post(
  '/:greetingId/activate',
  wrapRoute('POST /api/orgs/:orgId/voicemail-greeting/:greetingId/activate', async (req, res) => {
    const orgId = await requireOrgMembership(req, res)
    if (!orgId) return
    const greetingId = String(req.params.greetingId)

    const active = await prisma.$transaction(async (tx) => {
      // Serialize promotions for an organization. Until this transaction commits,
      // its prior active greeting remains playable by the Twilio voice route.
      await tx.$queryRaw`SELECT "id" FROM "Org" WHERE "id" = ${orgId} FOR UPDATE`

      await tx.voicemailGreeting.updateMany({
        where: { orgId, status: 'active', id: { not: greetingId } },
        data: { status: 'deleted', deletedAt: new Date() },
      })

      const promoted = await tx.voicemailGreeting.updateMany({
        where: { id: greetingId, orgId, status: 'ready' },
        data: { status: 'active' },
      })
      if (promoted.count === 0) {
        throw new GreetingError('Greeting is not ready to activate.', 409)
      }

      return tx.voicemailGreeting.findFirst({ where: { id: greetingId, orgId } })
    })

    res.json({ greeting: active && mapGreeting(active, await greetingAudioUrl(active.storageKey)) })
  }),
)

// DELETE /api/orgs/:orgId/voicemail-greeting/:greetingId — hide first, then clean private objects.
router.delete(
  '/:greetingId',
  wrapRoute('DELETE /api/orgs/:orgId/voicemail-greeting/:greetingId', async (req, res) => {
    const orgId = await requireOrgMembership(req, res)
    if (!orgId) return
    const greetingId = String(req.params.greetingId)
    const candidate = await prisma.voicemailGreeting.findFirst({
      where: { id: greetingId, orgId, status: { not: 'deleted' } },
    })
    if (!candidate) throw new GreetingError('Greeting not found.', 404)

    const deleted = await prisma.voicemailGreeting.updateMany({
      where: { id: candidate.id, orgId, status: { not: 'deleted' } },
      data: { status: 'deleted', deletedAt: new Date() },
    })
    if (deleted.count === 0) throw new GreetingError('Greeting not found.', 404)

    const cleanupResults = await Promise.allSettled(
      [candidate.sourceKey, candidate.storageKey]
        .filter((key): key is string => Boolean(key))
        .map((key) => deleteObject(key)),
    )
    for (const result of cleanupResults) {
      if (result.status === 'rejected') {
        logger.warn({ orgId, greetingId, error: result.reason }, 'could not delete greeting audio object')
      }
    }

    res.status(204).end()
  }),
)

export default router
