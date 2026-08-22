/**
 * Member management for one org: who is in it, what roles they hold, and
 * offboarding.
 *
 * Mounted at /api/orgs/:orgId/members. The org lives in the path, not in the
 * caller's `currentOrgId`: that field is a UI preference the client can set, and
 * filtering on it would let a stale preference decide which tenant's rows a
 * request touches (server/src/middleware/auth.ts explains why it is kept off the
 * verified caller).
 *
 * Reading the list needs a membership, not admin: anyone working here may see
 * who else is here. Every WRITE needs admin, and every rule the UI greys a button
 * for is re-checked here — a disabled button is a courtesy, not a boundary.
 */
import { Router } from 'express'

import { logger } from '../../dependencies/logger.js'
import { getAvatarDownloadUrl } from '../../dependencies/s3.js'
import { revokeFirebaseRefreshTokens } from '../../dependencies/firebaseAdmin.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import {
  memberListQuery,
  memberOrderBy,
  memberRoleFilter,
  memberSearchFilter,
} from '../lib/memberQuery.js'
import {
  ADMIN_ROLES,
  assignableRolesSchema,
  hasAdminAuthority,
  isOwnerRole,
  sortRoles,
  type MembershipRole,
} from '../lib/roles.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

// mergeParams, or :orgId from the mount path never reaches req.params here —
// which would silently drop the tenant filter.
const router = Router({ mergeParams: true })

// The one message for "you just tried to leave this org with nobody in charge".
// Named so the two routes that raise it cannot drift apart.
const LAST_ADMIN_ERROR =
  'Promote someone else to admin first. An org always keeps at least one admin.'

const NOT_FOUND_ERROR = 'Member not found'

/** Sentinels thrown inside a transaction so the rollback and the reply agree. */
const LAST_ADMIN = 'LAST_ADMIN'
const NOT_FOUND = 'NOT_FOUND'

router.use(requireAuth)

/** How many people can still administer this org. For the list's `meta` only. */
function countActiveAdmins(orgId: string): Promise<number> {
  return prisma.membership.count({
    where: { orgId, isActive: true, roles: { hasSome: [...ADMIN_ROLES] } },
  })
}

/**
 * The same count, taken with the admin rows LOCKED for the rest of the transaction.
 *
 * A plain count is not enough. Postgres runs a transaction at READ COMMITTED by
 * default, so two requests demoting the two remaining admins would each read
 * "2 admins", each write a different row, and both commit — leaving the org with
 * none. `FOR UPDATE` makes the second request wait for the first to commit and
 * then re-read, so it sees one admin left and is refused.
 *
 * Raw SQL because Prisma has no way to express a row lock. It is parameterised,
 * and `orgId` comes from the verified path, never from a body.
 */
async function lockAndCountActiveAdmins(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM "Membership"
      WHERE "orgId" = ${orgId}
        AND "isActive" = true
        AND "roles" && ${[...ADMIN_ROLES]}::text[]
      FOR UPDATE
    ) AS locked
  `
  return Number(rows[0]?.count ?? 0)
}

/** Two role sets are the same set, whatever order they arrived in. */
function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = sortRoles(a)
  const right = sortRoles(b)
  return left.every((role, index) => role === right[index])
}

// ============================================================
// GET /api/orgs/:orgId/members — who is in this org
// ============================================================
// Paged, sorted, and searched IN THE DATABASE. An org with 500 members must
// render page one from one 25-row query, not by shipping 500 rows and slicing
// them in the browser.
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/members', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    // No `{ admin: true }`: a member may see who else is in the org.
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const { page, limit, sort, dir, q, role } = memberListQuery.parse(req.query ?? {})

    // --- Build filters ---
    const where: Prisma.MembershipWhereInput = {
      orgId,
      isActive: true,
      ...(memberSearchFilter(q) ?? {}),
      ...(memberRoleFilter(role) ?? {}),
    }

    // --- Execute query ---
    const [total, rows, activeAdminCount] = await Promise.all([
      prisma.membership.count({ where }),
      prisma.membership.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              title: true,
              imageUrl: true,
              avatarKey: true,
              enabled: true,
            },
          },
        },
        orderBy: memberOrderBy(sort, dir),
        skip: (page - 1) * limit,
        take: limit,
      }),
      countActiveAdmins(orgId),
    ])

    // --- Return response ---
    res.json({
      members: await Promise.all(rows.map(async (m) => ({
        userId: m.user.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        title: m.user.title,
        imageUrl: m.user.imageUrl,
        avatarUrl: m.user.avatarKey ? await getAvatarDownloadUrl(m.user.avatarKey) : null,
        enabled: m.user.enabled,
        roles: sortRoles(m.roles) as MembershipRole[],
        joinedAt: m.createdAt.toISOString(),
        isSelf: m.user.id === authReq.user!.id,
      }))),
      total,
      page,
      limit,
      // The client greys out the last-admin actions before the server refuses
      // them. It is a hint for the UI, never the check itself.
      meta: { activeAdminCount },
      viewerRoles: sortRoles(membership.roles) as MembershipRole[],
    })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/members/:userId — change the role set (admin only)
// ============================================================
router.patch(
  '/:userId',
  wrapRoute('PATCH /api/orgs/:orgId/members/:userId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const targetUserId = String(req.params.userId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Parse & validate params ---
    // An empty set is refused, not defaulted: a membership with no roles has no
    // access, which is a removal wearing the costume of a role change.
    const parsed = assignableRolesSchema.safeParse(
      (req.body as { roles?: unknown } | undefined)?.roles,
    )
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Pick at least one role.' })
    }
    const nextRoles = parsed.data

    // --- Verify the target ---
    const target = await prisma.membership.findFirst({
      where: { userId: targetUserId, orgId, isActive: true },
    })
    if (!target) {
      return void res.status(404).json({ error: NOT_FOUND_ERROR })
    }
    if (isOwnerRole(target.roles)) {
      return void res.status(403).json({
        error: "The owner's role changes by transferring ownership, not from this list.",
      })
    }

    // Compare as SETS. Ticking admin then basic and ticking basic then admin are
    // the same request, and neither should count as a change.
    if (sameRoles(target.roles, nextRoles)) {
      return void res.json({
        member: { userId: targetUserId, roles: sortRoles(target.roles) },
      })
    }

    // --- Execute query ---
    // The count and the write share ONE transaction. Two concurrent demotions of
    // the last two admins would otherwise both read "2 admins" and both pass.
    try {
      await prisma.$transaction(async (tx) => {
        if (hasAdminAuthority(target.roles) && !hasAdminAuthority(nextRoles)) {
          const admins = await lockAndCountActiveAdmins(tx, orgId)
          if (admins <= 1) throw new Error(LAST_ADMIN)
        }
        // updateMany scoped by orgId, never update by id: the where clause carries
        // the tenant boundary, so a caller who slipped past the gate above still
        // cannot write another org's row.
        const result = await tx.membership.updateMany({
          where: { userId: targetUserId, orgId, isActive: true },
          data: { roles: nextRoles },
        })
        if (result.count === 0) throw new Error(NOT_FOUND)
      })
    } catch (err) {
      if (err instanceof Error && err.message === LAST_ADMIN) {
        return void res.status(409).json({ error: LAST_ADMIN_ERROR })
      }
      if (err instanceof Error && err.message === NOT_FOUND) {
        return void res.status(404).json({ error: NOT_FOUND_ERROR })
      }
      throw err
    }

    logger.info(
      { orgId, userId: authReq.user!.id, targetUserId, roles: nextRoles },
      'changed a member role set',
    )

    // --- Return response ---
    res.json({ member: { userId: targetUserId, roles: nextRoles } })
  }),
)

// ============================================================
// DELETE /api/orgs/:orgId/members/:userId — offboard (admin only)
// ============================================================
// Deactivates the membership. It does NOT delete the User and does NOT disable
// the Firebase account: removing someone from Org A must leave Org B working.
router.delete(
  '/:userId',
  wrapRoute('DELETE /api/orgs/:orgId/members/:userId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const targetUserId = String(req.params.userId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Verify the target ---
    const target = await prisma.membership.findFirst({
      where: { userId: targetUserId, orgId, isActive: true },
      include: { user: { select: { firebaseUid: true } } },
    })
    if (!target) {
      return void res.status(404).json({ error: NOT_FOUND_ERROR })
    }
    if (isOwnerRole(target.roles)) {
      return void res.status(403).json({ error: 'Transfer ownership before removing the owner.' })
    }

    // --- Execute query ---
    try {
      await prisma.$transaction(async (tx) => {
        if (hasAdminAuthority(target.roles)) {
          const admins = await lockAndCountActiveAdmins(tx, orgId)
          if (admins <= 1) throw new Error(LAST_ADMIN)
        }
        const result = await tx.membership.updateMany({
          where: { userId: targetUserId, orgId, isActive: true },
          data: { isActive: false },
        })
        if (result.count === 0) throw new Error(NOT_FOUND)

        // Private templates have no audience after their author leaves this org.
        // Shared templates remain the organization's asset, even though their
        // creator no longer has membership here.
        await tx.emailTemplate.deleteMany({
          where: { orgId, createdById: targetUserId, visibility: 'PRIVATE' },
        })

        // Do not leave the removed person pointed at an org they cannot open.
        // Scoped to this org, so someone working elsewhere keeps their place.
        await tx.user.updateMany({
          where: { id: targetUserId, currentOrgId: orgId },
          data: { currentOrgId: null },
        })
      })
    } catch (err) {
      if (err instanceof Error && err.message === LAST_ADMIN) {
        return void res.status(409).json({ error: LAST_ADMIN_ERROR })
      }
      if (err instanceof Error && err.message === NOT_FOUND) {
        return void res.status(404).json({ error: NOT_FOUND_ERROR })
      }
      throw err
    }

    // Cut the removed person's live sessions, AFTER the transaction. Access is
    // already gone — every membership read filters `isActive` — so a failure here
    // is logged, not fatal, and must not roll back a removal that succeeded.
    try {
      await revokeFirebaseRefreshTokens(target.user.firebaseUid)
    } catch (error) {
      logger.warn({ orgId, targetUserId, error }, 'could not revoke sessions for a removed member')
    }

    logger.info({ orgId, userId: authReq.user!.id, targetUserId }, 'removed a member from an org')

    // --- Return response ---
    res.json({ member: { userId: targetUserId, isActive: false } })
  }),
)

export default router
