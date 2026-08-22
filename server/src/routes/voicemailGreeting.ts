import { randomUUID } from 'node:crypto'

import multer from 'multer'
import { Router, type Request, type Response } from 'express'

import { putObjectBytes } from '../../dependencies/s3.js'
import prisma from '../db.js'
import { queueTranscodeGreeting } from '../jobs/transcodeGreeting.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router({ mergeParams: true })

const MAX_GREETING_BYTES = 20 * 1024 * 1024
const WEBM_CONTENT_TYPE = 'audio/webm'
const MP3_CONTENT_TYPES = new Set(['audio/mpeg', 'audio/mp3'])

// Memory storage deliberately has a tight ceiling: the bytes go straight to S3,
// so there is no server-side upload directory to clean up or accidentally serve.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_GREETING_BYTES, files: 1, fields: 0 },
})

function isWebm(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
}

function isMp3(bytes: Buffer): boolean {
  return bytes.subarray(0, 3).equals(Buffer.from('ID3')) ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
}

function greetingFileExtension(file: Express.Multer.File): 'webm' | 'mp3' | null {
  if (file.mimetype === WEBM_CONTENT_TYPE && isWebm(file.buffer)) return 'webm'
  if (MP3_CONTENT_TYPES.has(file.mimetype) && isMp3(file.buffer)) return 'mp3'
  return null
}

function mapGreeting(greeting: {
  id: string
  status: string
  uploadedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: greeting.id,
    status: greeting.status,
    uploadedAt: greeting.uploadedAt?.toISOString() ?? null,
    createdAt: greeting.createdAt.toISOString(),
    updatedAt: greeting.updatedAt.toISOString(),
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/voicemail-greeting — inspect greeting lifecycle state
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/voicemail-greeting', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const greeting = await prisma.voicemailGreeting.findFirst({ where: { orgId } })

    // --- Return response ---
    // This is intentionally a lifecycle-shaped response from day one. The
    // candidate collection will become multi-row in the next schema slice, but
    // callers never need to learn the old single-row storage layout.
    res.json({
      greeting: {
        active: greeting?.status === 'ready' ? mapGreeting(greeting) : null,
        candidates: greeting && greeting.status !== 'ready' ? [mapGreeting(greeting)] : [],
      },
    })
  }),
)

// Multer errors happen while parsing before the wrapped handler runs, so translate
// its bounded parser failures into the same user-actionable 400 contract.
async function parseGreetingUpload(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upload.single('audio')(req, res, (error: unknown) => {
      if (error) return reject(new GreetingUploadError('Upload one audio file no larger than 20MB.'))
      resolve()
    })
  })
}

class GreetingUploadError extends Error {
  readonly status = 400
}

// ============================================================
// POST /api/orgs/:orgId/voicemail-greeting — upload a personal greeting
// ============================================================
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/voicemail-greeting', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    await parseGreetingUpload(req, res)
    const file = req.file
    const extension = file ? greetingFileExtension(file) : null
    if (!file || !extension) {
      return void res.status(400).json({ error: 'Upload a valid WebM or MP3 audio file.' })
    }

    const tempObjectKey = `voicemail-greeting-uploads/${orgId}/${randomUUID()}.${extension}`

    // --- Execute query ---
    // Store the bytes and write the pending state before sending the job: a worker
    // never runs against a missing row, and Twilio never sees the temporary key.
    await putObjectBytes({ key: tempObjectKey, body: file.buffer, contentType: file.mimetype })
    const greeting = await prisma.voicemailGreeting.upsert({
      where: { orgId },
      update: { audioUrl: null, status: 'pending', uploadedAt: null },
      create: { orgId, audioUrl: null, status: 'pending', uploadedAt: null },
    })
    await queueTranscodeGreeting({ orgId, tempObjectKey })

    // --- Return response ---
    res.status(201).json({ greeting: mapGreeting(greeting) })
  }),
)

export default router
