/**
 * The invitee's half of the invite flow.
 *
 * These two routes live outside `/api/team` because the caller is not a member of
 * anything yet — that is the whole point. The lookup is unauthenticated (the
 * invitee may have no account), and the accept is the moment a token becomes a
 * Membership.
 *
 * Both are rate limited. They are the only routes in the app a stranger can call
 * with a guessable value in the path.
 */
import { Router } from 'express'

import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { assignableRolesSchema, type OrgRole } from '../lib/roles.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = Router()

/**
 * ONE answer for every way an invite can be unusable — missing, expired, revoked,
 * already accepted, or simply never real.
 *
 * Four distinguishable errors would be a probing oracle: a scanner could tell a
 * wrong token from a real-but-spent one and learn that the org exists. The
 * invitee loses nothing, because the fix is the same in all five cases.
 */
function unavailable(res: Parameters<Parameters<typeof wrapRoute>[1]>[1]): void {
  res.status(404).json({ error: 'Invitation unavailable' })
}

/**
 * Resolves a token to a usable invitation, or null.
 *
 * A genuinely expired invite is marked EXPIRED here rather than only being
 * filtered out, so the admin's list and the invitee's screen tell the same story.
 */
async function resolveLiveInvitation(token: string) {
  if (!token || token.length > 200) return null

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { org: true },
  })
  if (!invitation) return null

  if (invitation.status === 'PENDING' && invitation.expiresAt <= new Date()) {
    await prisma.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })
    return null
  }

  if (invitation.status !== 'PENDING') return null
  if (!invitation.org.enabled) return null

  return invitation
}

// ============================================================
// GET /api/public/invitations/:token — what this link is for (unauthenticated)
// ============================================================
router.get(
  '/public/invitations/:token',
  rateLimit({ max: 30, name: 'GET /api/public/invitations/:token' }),
  wrapRoute('GET /api/public/invitations/:token', async (req, res) => {
    // --- Execute query ---
    const invitation = await resolveLiveInvitation(String(req.params.token))
    if (!invitation) return void unavailable(res)

    // --- Return response ---
    // Only what the join screen has to render. No ids, no member list, nothing
    // else about the org — anyone holding the link can read this.
    res.json({
      invitation: {
        orgName: invitation.org.name,
        email: invitation.email,
        roles: invitation.roles as OrgRole[],
        expiresAt: invitation.expiresAt.toISOString(),
      },
    })
  }),
)

// ============================================================
// POST /api/invitations/:token/accept — turn the token into a membership
// ============================================================
router.post(
  '/invitations/:token/accept',
  rateLimit({ max: 30, name: 'POST /api/invitations/:token/accept' }),
  requireAuth,
  wrapRoute('POST /api/invitations/:token/accept', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const user = authReq.user!

    // --- Execute query ---
    const invitation = await resolveLiveInvitation(String(req.params.token))
    if (!invitation) return void unavailable(res)

    // --- Verify the invite is for this caller ---
    // The invite is bound to an address. Without this check, anyone holding the
    // link could join as themselves, and the admin would see a stranger in the
    // member list under an email they never invited.
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return void res.status(409).json({
        error: `This invite was sent to ${invitation.email}. Sign out and sign in as that person.`,
        status: 'email_mismatch',
        invitedEmail: invitation.email,
        signedInEmail: user.email,
      })
    }

    // --- Re-validate the roles ---
    // Checked again here, not just at create time. The row could have been edited
    // in the database in between, and an invitation may never grant a platform
    // role. A bad row is refused rather than downgraded, so nobody silently joins
    // with less access than the link promised.
    const roles = assignableRolesSchema.safeParse(invitation.roles)
    if (!roles.success) {
      logger.error(
        { invitationId: invitation.id, orgId: invitation.orgId },
        'invitation carries roles that may not be assigned',
      )
      return void unavailable(res)
    }

    // --- Apply ---
    // One transaction. The `status: 'PENDING'` guard on the flip is what makes a
    // double-click safe: the second call updates zero rows and takes the
    // already-joined branch below instead of creating a second membership.
    const outcome = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
        },
      })
      if (claimed.count === 0) return { claimed: false as const }

      // upsert, not create: this person may have been a member before and been
      // removed, in which case the row still exists and @@unique([userId, orgId])
      // would reject a second one. Re-adding REACTIVATES that row rather than
      // creating a second seat, and their roles become the invited roles either way.
      await tx.membership.upsert({
        where: { userId_orgId: { userId: user.id, orgId: invitation.orgId } },
        create: { userId: user.id, orgId: invitation.orgId, roles: roles.data },
        update: { roles: roles.data, isActive: true },
      })

      // Land them inside the org they just joined, not wherever they were.
      await tx.user.update({
        where: { id: user.id },
        data: { currentOrgId: invitation.orgId },
      })

      return { claimed: true as const }
    })

    if (!outcome.claimed) {
      // Someone else won the race — almost always the same person double-clicking.
      // They are a member either way, so this is a success, not an error.
      logger.info({ invitationId: invitation.id, userId: user.id }, 'invite already claimed')
    } else {
      logger.info(
        { invitationId: invitation.id, orgId: invitation.orgId, userId: user.id },
        'accepted an invite',
      )
    }

    // --- Return response ---
    res.json({
      membership: {
        orgId: invitation.orgId,
        orgName: invitation.org.name,
        roles: roles.data,
      },
    })
  }),
)

export default router
