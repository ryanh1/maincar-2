/**
 * The signed-in user's own profile.
 *
 * GET /api/auth/me is the one authenticated route that does NOT use `requireAuth`:
 * on a brand-new Firebase account there is no User row yet, so this route
 * provisions the Org and the User itself. Every other route can then assume the
 * row exists.
 */
import { Router } from 'express'
import { z } from 'zod'

import { logger } from '../../dependencies/logger.js'
import { verifyFirebaseIdToken } from '../../dependencies/firebaseAdmin.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { isAdmin, type UserRole } from '../lib/roles.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Org, User } from '../generated/prisma/client.js'

const router = Router()

// --- API shapes -------------------------------------------------------------
// Every response is a KEYED object — `{ user }`, never a bare user
// (CLAUDE.md → Server Route Patterns → Response Shape). A mapper stands between
// the row and the wire so a new database column is never accidentally published.

function mapUserToApi(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
    imageUrl: user.imageUrl,
    roles: user.roles as UserRole[],
    enabled: user.enabled,
    orgId: user.orgId,
    timeZone: user.timeZone,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

function mapOrgToApi(org: Org) {
  return {
    id: org.id,
    name: org.name,
    enabled: org.enabled,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  }
}

// ============================================================
// GET /api/auth/me — the caller's profile, provisioning it on first sight
// ============================================================
router.get(
  '/me',
  wrapRoute('GET /api/auth/me', async (req, res) => {
    // --- Verify the token ---
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) return void res.status(401).json({ error: 'Not signed in' })

    let firebaseUid: string
    let email: string
    try {
      const decoded = await verifyFirebaseIdToken(token)
      firebaseUid = decoded.uid
      email = decoded.email ?? ''
    } catch {
      return void res.status(401).json({ error: 'Not signed in' })
    }

    if (!email) {
      return void res.status(400).json({ error: 'This account has no email address' })
    }

    // --- Find the user, or provision one ---
    let user = await prisma.user.findUnique({ where: { firebaseUid } })

    if (!user) {
      // No row for this uid. Before provisioning, check whether the EMAIL is
      // already taken by a different Firebase account.
      //
      // This is not hypothetical: it happens whenever a Firebase account is
      // deleted and recreated with the same address — a reset Auth emulator in
      // local dev, or a deleted-and-re-invited person in production. Without this
      // check the create below trips the unique-email constraint and the caller
      // gets an opaque 500.
      //
      // We refuse rather than re-link. Re-linking would mean anyone who can make a
      // Firebase account with someone's address inherits that person's row and
      // their whole org — an account takeover, unless the address is proven. When
      // an invite flow exists, THIS is where linking belongs, gated on the invite
      // token rather than on the email alone.
      const emailTaken = await prisma.user.findUnique({ where: { email } })
      if (emailTaken) {
        logger.warn(
          { firebaseUid, existingUserId: emailTaken.id },
          'sign-in with an email already bound to a different firebase account',
        )
        return void res.status(409).json({
          error: 'An account already exists for this email address.',
          status: 'email_already_linked',
        })
      }

      // First sign-in. A new Org and its first admin are created together, in one
      // transaction — a User without an Org, or an Org with no way in, is a state
      // nothing else in the app knows how to handle.
      user = await prisma.$transaction(async (tx) => {
        const org = await tx.org.create({ data: {} })
        return tx.user.create({
          data: {
            firebaseUid,
            email,
            orgId: org.id,
            // The person who creates the org runs it.
            roles: ['admin'],
          },
        })
      })
      logger.info({ userId: user.id, orgId: user.orgId }, 'provisioned a new org and admin')
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: user.orgId } })

    if (!user.enabled || !org.enabled) {
      return void res.status(403).json({ error: 'This account is disabled' })
    }

    return void res.json({ user: mapUserToApi(user), org: mapOrgToApi(org) })
  }),
)

// ============================================================
// PATCH /api/auth/me — update your own profile (and, for admins, the org name)
// ============================================================
const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().max(100).nullable().optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  orgName: z.string().trim().min(1).max(200).optional(),
})

router.patch(
  '/me',
  requireAuth,
  wrapRoute('PATCH /api/auth/me', async (req, res) => {
    const { user: authUser } = req as AuthenticatedRequest
    if (!authUser) return void res.status(401).json({ error: 'Not signed in' })

    // --- Parse and validate the body ---
    const parsed = updateProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Those details are not valid' })
    }
    const { orgName, ...profile } = parsed.data

    // --- Apply ---
    const user = await prisma.user.update({
      where: { id: authUser.id },
      data: profile,
    })

    // The org name is an admin-only field. A non-admin who sends it is ignored
    // rather than rejected — they may simply be on an older client.
    if (orgName !== undefined && isAdmin(authUser.roles)) {
      await prisma.org.update({
        // updateMany-style scoping is unnecessary here: orgId comes from the
        // verified token, never from the request body.
        where: { id: authUser.orgId },
        data: { name: orgName },
      })
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: user.orgId } })

    return void res.json({ user: mapUserToApi(user), org: mapOrgToApi(org) })
  }),
)

export default router
