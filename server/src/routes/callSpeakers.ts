import { Router } from 'express'
import { z } from 'zod'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'

const router = Router({ mergeParams: true })

const correctCallSpeakerSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a speaker name.').max(120).optional(),
  personId: z.string().trim().min(1).max(128).nullable().optional(),
}).strict().refine(
  (value) => value.displayName !== undefined || value.personId !== undefined,
  { message: 'Provide a name or person to correct this speaker.' },
)

router.use(requireAuth)

// A person can make an explicit identity decision for an outside participant.
// The rep carries a durable Call.userId link from the transcription pass and is
// deliberately not editable here: this route must never turn a known internal
// identity into a guess.
router.patch(
  '/:speakerKey',
  wrapRoute('PATCH /api/orgs/:orgId/calls/:callId/speakers/:speakerKey', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const callId = String(req.params.callId)
    const speakerKey = String(req.params.speakerKey)
    const userId = authReq.user!.id

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = correctCallSpeakerSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Verify ownership ---
    // userId: null limits correction to outside speakers. The durable call-user
    // link for the rep remains a system fact rather than a client-editable value.
    const speaker = await prisma.callSpeaker.findFirst({
      where: { callId, orgId, speakerKey, userId: null },
      select: { id: true },
    })
    if (!speaker) return void res.status(404).json({ error: 'Outside speaker not found' })

    const person = parsed.data.personId
      ? await prisma.person.findFirst({
          where: { id: parsed.data.personId, orgId, isArchived: false },
          select: { id: true },
        })
      : null
    if (parsed.data.personId && !person) {
      return void res.status(400).json({ error: 'Choose a person from this organization.' })
    }

    // --- Execute query ---
    const result = await prisma.callSpeaker.updateMany({
      where: { id: speaker.id, orgId, userId: null },
      data: {
        ...(parsed.data.displayName === undefined ? {} : { displayName: parsed.data.displayName }),
        ...(parsed.data.personId === undefined ? {} : { personId: person?.id ?? null }),
        source: 'manual',
        evidence: { type: 'manual-confirmation', userId },
        confidence: 1,
        confirmedAt: new Date(),
        manualOverride: true,
      },
    })
    if (result.count === 0) return void res.status(404).json({ error: 'Outside speaker not found' })

    const corrected = await prisma.callSpeaker.findFirst({
      where: { id: speaker.id, orgId },
      select: {
        id: true,
        speakerKey: true,
        displayName: true,
        source: true,
        confidence: true,
        confirmedAt: true,
        manualOverride: true,
        person: { select: { id: true, firstName: true, lastName: true, preferredFirstName: true } },
      },
    })
    if (!corrected) return void res.status(404).json({ error: 'Outside speaker not found' })

    // --- Return response ---
    res.json({
      speaker: {
        id: corrected.id,
        speakerKey: corrected.speakerKey,
        displayName: corrected.displayName,
        source: corrected.source,
        confidence: corrected.confidence,
        confirmedAt: corrected.confirmedAt?.toISOString() ?? null,
        manualOverride: corrected.manualOverride,
        person: corrected.person,
      },
    })
  }),
)

export default router
