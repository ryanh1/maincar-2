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
import type { Membership, Org, User } from '../generated/prisma/client.js'

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
    currentOrgId: user.currentOrgId,
    timeZone: user.timeZone,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

function mapOrgToApi(org: Org) {
  return {
    id: org.id,
    name: org.name,
    logo: org.logo,
    enabled: org.enabled,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  }
}

/**
 * One org the caller belongs to, plus the roles they hold IN that org. This is
 * what the org switcher lists, and what every permission check reads: "admin" is
 * per-org now, so a user can run one org and be a basic member of another.
 */
function mapMembershipToApi(membership: Membership & { org: Org }) {
  return {
    orgId: membership.orgId,
    org: mapOrgToApi(membership.org),
    roles: membership.roles as UserRole[],
  }
}

type ResolvedActiveOrg =
  | { status: 'ok'; org: Org | null; memberships: (Membership & { org: Org })[]; switchedTo: string | null }
  | { status: 'no_enabled_org'; memberships: (Membership & { org: Org })[] }

/**
 * Picks the org a session acts in.
 *
 * `currentOrgId` is only a preference, so it is never trusted on its own: it
 * counts only when the caller still has a membership in that org AND the org is
 * enabled. Otherwise we fall through to their next enabled org and report the
 * switch, so the caller's stored preference can be repaired.
 *
 * A user whose every org is disabled gets `no_enabled_org` — the caller turns
 * that into the same 403 a disabled account has always produced.
 */
async function resolveActiveOrg(user: User): Promise<ResolvedActiveOrg> {
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { org: true },
    orderBy: { createdAt: 'asc' },
  })

  // A user with no memberships at all is not disabled, they simply have no org
  // yet. That is a real state (an invite not yet accepted), not an error.
  if (memberships.length === 0) {
    return { status: 'ok', org: null, memberships, switchedTo: null }
  }

  const usable = memberships.filter((m) => m.org.enabled)
  if (usable.length === 0) {
    return { status: 'no_enabled_org', memberships }
  }

  const current = usable.find((m) => m.orgId === user.currentOrgId)
  if (current) {
    return { status: 'ok', org: current.org, memberships, switchedTo: null }
  }

  const fallback = usable[0]
  logger.info(
    { userId: user.id, from: user.currentOrgId, to: fallback.orgId },
    'current org is unusable, falling back to another membership',
  )
  return { status: 'ok', org: fallback.org, memberships, switchedTo: fallback.orgId }
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

      // First sign-in. The User row is created and NOTHING else: no org.
      //
      // Creating an account and belonging to an org are two separate steps now.
      // Auto-minting an org here would hand every invited person a second, empty
      // org they never asked for and are admin of, and the switcher would show it
      // forever. A user with no memberships is a real, supported state — the
      // client sends them to /create-org, and an invitee skips that entirely by
      // accepting their invite.
      user = await prisma.user.create({ data: { firebaseUid, email } })
      logger.info({ userId: user.id }, 'provisioned a new user with no org')
    }

    if (!user.enabled) {
      return void res.status(403).json({ error: 'This account is disabled' })
    }

    // --- Resolve the active org ---
    // A user can belong to several orgs now, so the active one is whichever
    // `currentOrgId` points at — as long as that org is still enabled. A disabled
    // org is never handed back as active, and `resolveActiveOrg` falls through to
    // another enabled membership rather than locking a multi-org user out.
    const resolved = await resolveActiveOrg(user)
    if (resolved.status === 'no_enabled_org') {
      // Every org this user belongs to is disabled. Same answer as before
      // multi-org: signing out and back in will not help.
      return void res.status(403).json({ error: 'This account is disabled' })
    }
    if (resolved.switchedTo) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { currentOrgId: resolved.switchedTo },
      })
    }

    return void res.json({
      user: mapUserToApi(user),
      org: resolved.org ? mapOrgToApi(resolved.org) : null,
      memberships: resolved.memberships.map(mapMembershipToApi),
    })
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

    // The org name is an admin-only field, and "admin" is per-org now: the gate is
    // the caller's Membership in the org they are acting in, never a global role.
    // A non-admin who sends it is ignored rather than rejected — they may simply
    // be on an older client.
    if (orgName !== undefined && user.currentOrgId) {
      const membership = await prisma.membership.findFirst({
        where: { userId: authUser.id, orgId: user.currentOrgId },
      })
      if (isAdmin((membership?.roles ?? []) as UserRole[])) {
        // Scoped by orgId as well as id, so a stale currentOrgId can never write
        // an org the caller has no membership in (CLAUDE.md → Org Isolation).
        await prisma.org.updateMany({
          where: { id: user.currentOrgId },
          data: { name: orgName },
        })
      }
    }

    const resolved = await resolveActiveOrg(user)

    return void res.json({
      user: mapUserToApi(user),
      org: resolved.status === 'ok' && resolved.org ? mapOrgToApi(resolved.org) : null,
      memberships: resolved.memberships.map(mapMembershipToApi),
    })
  }),
)

export default router
