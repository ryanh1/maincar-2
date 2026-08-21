/**
 * Phone number routes: the Twilio numbers an org owns and hands to its members.
 *
 * Mounted at /api/orgs/:orgId/phone-numbers. The org lives in the path, not in
 * the caller's `currentOrgId`: that field is a UI preference the client can set,
 * and filtering on it would let a stale preference decide which tenant's rows a
 * request reads (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller). Every route below requires authentication and an active
 * membership in the org named by the path.
 *
 * The dialer spec (docs/specs/SPEC-DIALER-REBUILD.md) calls the tenant key
 * `workspaceId` and the path `/workspaces/:workspaceId/phone-numbers`. This
 * codebase has always called it `orgId`, so the path follows suit.
 */
import { Router } from 'express'

import prisma from '../db.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import type { PhoneNumber } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

// --- Mappers: database row → API shape ---

// assignedUserId and orgId are deliberately absent: the caller already knows
// both (they are the requester and the path), so repeating them adds nothing.
function mapPhoneNumberToApi(number: PhoneNumber) {
  return {
    id: number.id,
    e164: number.e164,
    twilioSid: number.twilioSid,
    status: number.status,
    isActiveForOutbound: number.isActiveForOutbound,
    createdAt: number.createdAt.toISOString(),
  }
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/phone-numbers — the caller's numbers in this org
// ============================================================
// Not paginated on purpose. A user holds a handful of numbers, and this list
// feeds the caller-ID picker, which has to show all of them at once — a page 2
// the picker never asks for would hide a number the user owns.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/phone-numbers', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Build filters ---
    // Both keys, always: orgId is the tenant boundary and assignedUserId is
    // "mine". A number belonging to a colleague is not the caller's to dial from.
    const where = { orgId, assignedUserId: authReq.user!.id }

    // --- Execute query ---
    // Active first, then oldest first, so the number the user actually dials
    // from is row one and the rest keep a stable order between requests.
    const numbers = await prisma.phoneNumber.findMany({
      where,
      orderBy: [{ isActiveForOutbound: 'desc' }, { createdAt: 'asc' }],
    })

    // --- Return response ---
    // activeCount is counted from the rows just read rather than with a second
    // query: one read cannot disagree with itself. The schema allows at most one
    // active number per user, so this is normally 0 or 1 — it is returned as a
    // count so the client can SEE a broken pair rather than pick one at random.
    res.json({
      numbers: numbers.map(mapPhoneNumberToApi),
      total: numbers.length,
      activeCount: numbers.filter((n) => n.isActiveForOutbound).length,
    })
  }),
)

export default router
