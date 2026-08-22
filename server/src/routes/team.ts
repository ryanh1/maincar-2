/**
 * Team routes: profile, org CRUD, member management, invitations.
 *
 * All routes below /api/team require authentication.
 * Routes touching org-scoped data verify the user is a member and include orgId in filters.
 */
import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'

import prisma from '../db.js'
import { WEB_ORIGIN } from '../config.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { logger } from '../../dependencies/logger.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { endOfDayAfterDays, resolveTimeZone } from '../lib/datetime.js'
import { requireMembership } from '../lib/membership.js'
import { seedOrgInTx } from '../crm/seedOrg.js'
import { assignableRolesSchema, type OrgRole, type UserRole } from '../lib/roles.js'
import {
  acceptAvatarUpload,
  avatarObjectKey,
  organizationAvatarPrefix,
  presignAvatarUpload,
  userAvatarPrefix,
} from '../lib/avatarUpload.js'
import { deleteObject, getAvatarDownloadUrl } from '../../dependencies/s3.js'
import type { Invitation, Org, User } from '../generated/prisma/client.js'

const router = Router()

// 14 days, not 7: an invite sent on the Friday before a week off is still live
// when the person comes back.
//
// Fourteen CALENDAR days, counted in the inviter's zone — not fourteen 24-hour
// blocks. See `inviteExpiresAt` below.
const INVITE_EXPIRY_DAYS = 14

// --- Mappers: database row → API shape ---

async function mapAvatarUrl(avatarKey: string | null): Promise<string | null> {
  return avatarKey ? getAvatarDownloadUrl(avatarKey) : null
}

async function mapUserToApi(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
    imageUrl: user.imageUrl,
    avatarUrl: await mapAvatarUrl(user.avatarKey),
    enabled: user.enabled,
    timeZone: user.timeZone,
    currentOrgId: user.currentOrgId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

async function mapOrgToApi(org: Org) {
  return {
    id: org.id,
    name: org.name,
    logo: org.logo,
    avatarUrl: await mapAvatarUrl(org.avatarKey),
    enabled: org.enabled,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  }
}

function buildInviteUrl(token: string): string {
  return `${WEB_ORIGIN.replace(/\/+$/, '')}/join/${encodeURIComponent(token)}`
}

// Mount auth middleware for all routes below
router.use(requireAuth)

// ============================================================
// GET /api/team/profile — the caller's own profile
// ============================================================
router.get(
  '/profile',
  wrapRoute('GET /api/team/profile', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest

    const user = await prisma.user.findUniqueOrThrow({ where: { id: authReq.user!.id } })

    res.json({ user: await mapUserToApi(user) })
  }),
)

// ============================================================
// PATCH /api/team/profile — update the caller's own profile
//
// The profile belongs to the caller, so there is no id in the path and none is
// read from the body: the row updated is always `req.user.id`.
// ============================================================
const updateProfileSchema = z
  .object({
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    title: z.string().trim().max(100).nullable().optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()

router.patch(
  '/profile',
  wrapRoute('PATCH /api/team/profile', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest

    // --- Parse & validate params ---
    const parsed = updateProfileSchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Those details are not valid.' })
    }

    // An empty string clears the field rather than storing "".
    const data: Record<string, unknown> = {}
    for (const key of ['firstName', 'lastName', 'title'] as const) {
      const value = parsed.data[key]
      if (value !== undefined) data[key] = value || null
    }
    if (parsed.data.timeZone !== undefined) data.timeZone = parsed.data.timeZone

    if (Object.keys(data).length === 0) {
      return void res.status(400).json({ error: 'Send at least one field to update.' })
    }

    // --- Execute query ---
    const user = await prisma.user.update({ where: { id: authReq.user!.id }, data })

    res.json({ user: await mapUserToApi(user) })
  }),
)

const avatarObjectKeySchema = z.object({ objectKey: z.string().min(1).max(1024).nullable() }).strict()

router.post(
  '/profile/avatar/upload-url',
  wrapRoute('POST /api/team/profile/avatar/upload-url', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const body = (req.body ?? {}) as { contentType?: unknown; size?: unknown }
    const target = await presignAvatarUpload({
      prefix: userAvatarPrefix(authReq.user!.id),
      contentType: body.contentType,
      size: body.size,
    })
    res.json(target)
  }),
)

router.patch(
  '/profile/avatar',
  wrapRoute('PATCH /api/team/profile/avatar', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const parsed = avatarObjectKeySchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: 'That is not a valid photo reference.' })

    const previous = await prisma.user.findUniqueOrThrow({ where: { id: authReq.user!.id } })
    const avatarKey =
      parsed.data.objectKey === null
        ? null
        : await acceptAvatarUpload({
            objectKey: parsed.data.objectKey,
            prefix: userAvatarPrefix(authReq.user!.id),
          })
    const user = await prisma.user.update({ where: { id: authReq.user!.id }, data: { avatarKey } })
    const previousKey = avatarObjectKey(previous.avatarKey)
    if (previousKey && previousKey !== avatarKey) {
      try {
        await deleteObject(previousKey)
      } catch (error) {
        logger.warn({ error, userId: authReq.user!.id }, 'could not delete replaced profile photo')
      }
    }
    res.json({ user: await mapUserToApi(user) })
  }),
)

// ============================================================
// GET /api/team/orgs — every org the caller belongs to (the org switcher's list)
// ============================================================
router.get(
  '/orgs',
  wrapRoute('GET /api/team/orgs', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest

    const memberships = await prisma.membership.findMany({
      where: { userId: authReq.user!.id, isActive: true, org: { enabled: true } },
      include: { org: true },
      orderBy: { createdAt: 'asc' },
    })

    res.json({
      orgs: await Promise.all(memberships.map(async (m) => ({
        ...(await mapOrgToApi(m.org)),
        roles: m.roles as UserRole[],
      }))),
      total: memberships.length,
    })
  }),
)

// ============================================================
// POST /api/team/orgs — create an org; the caller becomes its first admin
// ============================================================
const createOrgSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict()

router.post(
  '/orgs',
  wrapRoute('POST /api/team/orgs', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest

    // --- Parse & validate params ---
    const parsed = createOrgSchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Name the organization to create it.' })
    }

    // --- Execute query ---
    // The org, the admin membership, and the switch happen together: an org whose
    // creator is not a member of it is a state nothing else knows how to handle.
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.org.create({ data: { name: parsed.data.name } })
      await tx.membership.create({
        data: { userId: authReq.user!.id, orgId: created.id, roles: ['admin'] },
      })
      await tx.user.update({
        where: { id: authReq.user!.id },
        data: { currentOrgId: created.id },
      })
      // Seed the standard CRM schema (objects, fields, picklists, a default
      // pipeline) in the SAME transaction, so a committed org is always fully
      // seeded and a rollback leaves no half-seeded org (MAI-134 T6, spec §10.2).
      await seedOrgInTx(tx, created.id)
      return created
    })

    logger.info({ userId: authReq.user!.id, orgId: org.id }, 'created an org')

    res.status(201).json({ org: await mapOrgToApi(org) })
  }),
)

// ============================================================
// GET /api/team/orgs/:orgId — one org the caller belongs to
// ============================================================
router.get(
  '/orgs/:orgId',
  wrapRoute('GET /api/team/orgs/:orgId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    res.json({ org: await mapOrgToApi(membership.org), roles: membership.roles as UserRole[] })
  }),
)

// ============================================================
// PATCH /api/team/orgs/:orgId — rename an org / set its logo (org admin only)
// ============================================================
const updateOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    logo: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()

router.patch(
  '/orgs/:orgId',
  wrapRoute('PATCH /api/team/orgs/:orgId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = updateOrgSchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Those details are not valid.' })
    }

    const data: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.logo !== undefined) data.logo = parsed.data.logo || null

    if (Object.keys(data).length === 0) {
      return void res.status(400).json({ error: 'Send at least one field to update.' })
    }

    // --- Execute query ---
    // updateMany, not update: the where clause carries the org boundary, so a
    // caller who slipped past the gate above still cannot write another org.
    const result = await prisma.org.updateMany({ where: { id: orgId }, data })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Organization not found' })
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } })

    res.json({ org: await mapOrgToApi(org) })
  }),
)

router.post(
  '/orgs/:orgId/avatar/upload-url',
  wrapRoute('POST /api/team/orgs/:orgId/avatar/upload-url', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return
    const body = (req.body ?? {}) as { contentType?: unknown; size?: unknown }
    const target = await presignAvatarUpload({
      prefix: organizationAvatarPrefix(orgId),
      contentType: body.contentType,
      size: body.size,
    })
    res.json(target)
  }),
)

router.patch(
  '/orgs/:orgId/avatar',
  wrapRoute('PATCH /api/team/orgs/:orgId/avatar', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return
    const parsed = avatarObjectKeySchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: 'That is not a valid photo reference.' })
    const avatarKey =
      parsed.data.objectKey === null
        ? null
        : await acceptAvatarUpload({
            objectKey: parsed.data.objectKey,
            prefix: organizationAvatarPrefix(orgId),
          })
    const result = await prisma.org.updateMany({ where: { id: orgId }, data: { avatarKey } })
    if (result.count === 0) return void res.status(404).json({ error: 'Organization not found' })
    const previousKey = avatarObjectKey(membership.org.avatarKey)
    if (previousKey && previousKey !== avatarKey) {
      try {
        await deleteObject(previousKey)
      } catch (error) {
        logger.warn({ error, orgId }, 'could not delete replaced organization photo')
      }
    }
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } })
    res.json({ org: await mapOrgToApi(org) })
  }),
)

// ============================================================
// POST /api/team/orgs/:orgId/switch — make this the caller's active org
// ============================================================
router.post(
  '/orgs/:orgId/switch',
  wrapRoute('POST /api/team/orgs/:orgId/switch', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const user = await prisma.user.update({
      where: { id: authReq.user!.id },
      data: { currentOrgId: orgId },
    })

    res.json({ user: await mapUserToApi(user), org: await mapOrgToApi(membership.org) })
  }),
)

// ============================================================
// Invitations
// ============================================================
// The token is 256 bits of CSPRNG, stored in full rather than hashed: the
// pending-invite row has to reproduce the exact link for its Copy button, which a
// hash cannot do. base64url so it is safe in a path without escaping.
function mintInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * When an invite created (or regenerated) now runs out: the last millisecond of
 * the day, `INVITE_EXPIRY_DAYS` calendar days from today, on the INVITER's clock.
 *
 * ONE function, called by both the create and the regenerate route, so the two
 * cannot drift apart. The zone is always the original inviter's, never the
 * regenerating admin's: the expiry belongs to the invitation, and keeping a
 * single zone attached to the row is what lets every admin — and the mapper
 * below — render the same expiry DATE for it.
 */
function inviteExpiresAt(inviterTimeZone: string | null | undefined): Date {
  return endOfDayAfterDays(new Date(), INVITE_EXPIRY_DAYS, inviterTimeZone)
}

/** A row plus the inviter's zone, which is the zone its expiry is anchored in. */
type InvitationWithInviter = Invitation & { invitedByUser?: { timeZone: string | null } | null }

/** Ask for the inviter's zone alongside the row, for `expiresAtTimeZone`. */
const withInviterZone = { invitedByUser: { select: { timeZone: true } } } as const

function mapInvitationToApi(invitation: InvitationWithInviter) {
  return {
    id: invitation.id,
    email: invitation.email,
    roles: invitation.roles as OrgRole[],
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    // The zone the expiry was anchored in, already resolved to a real IANA name
    // so the client never has to guess a fallback. The expiry is the last
    // millisecond of a day on the INVITER's clock, and that day is only
    // identifiable alongside the zone whose midnight bounds it — read in another
    // zone the same instant falls on the day before or after.
    expiresAtTimeZone: resolveTimeZone(invitation.invitedByUser?.timeZone),
    inviteUrl: buildInviteUrl(invitation.token),
    createdAt: invitation.createdAt.toISOString(),
  }
}

/**
 * Flip anything past its expiry to EXPIRED before the caller reads the list.
 *
 * Without this the admin's table shows a dead invite as live and offers a Copy
 * button for a link that no longer works. Scoped to one org so a list request
 * never writes another org's rows.
 */
export async function expireStaleInvitations(orgId?: string): Promise<void> {
  await prisma.invitation.updateMany({
    where: {
      ...(orgId ? { orgId } : {}),
      status: 'PENDING',
      expiresAt: { lte: new Date() },
    },
    data: { status: 'EXPIRED' },
  })
}

// ============================================================
// POST /api/team/orgs/:orgId/invitations — invite someone to the org (admin only)
// ============================================================
// The role set is a closed list, not free text: without this an admin could mint
// an invite carrying any string, and whatever accepts the invite would write it
// straight onto a Membership. `assignableRolesSchema` also excludes "superadmin",
// which is a platform role and must never be granted by an org admin.
const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    roles: assignableRolesSchema.optional(),
  })
  .strict()

router.post(
  '/orgs/:orgId/invitations',
  wrapRoute('POST /api/team/orgs/:orgId/invitations', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) {
      return void res.status(400).json({ error: 'Enter a valid email address and role.' })
    }
    const { email } = parsed.data
    const roles = parsed.data.roles ?? ['basic']

    // --- Verify the invite is worth sending ---
    // isActive, so someone who was removed can be invited back rather than being
    // told they are already here by a row that no longer grants anything.
    const alreadyMember = await prisma.membership.findFirst({
      where: { orgId, isActive: true, user: { email } },
    })
    if (alreadyMember) {
      return void res.status(409).json({ error: 'That person is already a member.' })
    }

    // A second invite for the same address would leave two live links, and the
    // admin has no way to tell which one they already sent. Overwriting the token
    // silently is worse still: it kills a link that may already be in an email.
    await expireStaleInvitations(orgId)
    const alreadyInvited = await prisma.invitation.findFirst({
      where: { orgId, email, status: 'PENDING' },
    })
    if (alreadyInvited) {
      return void res
        .status(409)
        .json({ error: 'That person already has an invite. Copy or revoke that one instead.' })
    }

    // --- Execute query ---
    // The expiry is anchored to the end of the inviter's day, so their own zone
    // is read here. `req.user` deliberately carries no timezone, so it comes off
    // the row (middleware/auth.ts explains why that object stays minimal).
    const inviter = await prisma.user.findUnique({
      where: { id: authReq.user!.id },
      select: { timeZone: true },
    })

    const invitation = await prisma.invitation.create({
      data: {
        token: mintInviteToken(),
        email,
        orgId,
        roles,
        expiresAt: inviteExpiresAt(inviter?.timeZone),
        invitedByUserId: authReq.user!.id,
      },
      include: withInviterZone,
    })

    logger.info({ orgId, userId: authReq.user!.id, invitationId: invitation.id }, 'created an invite')

    // --- Return response ---
    // No email is sent yet, so the link is returned for the admin to pass on. The
    // Invitations UI copies it rather than claiming a mail went out.
    res.status(201).json({ invitation: mapInvitationToApi(invitation) })
  }),
)

// ============================================================
// GET /api/team/orgs/:orgId/invitations — pending invites (admin only)
// ============================================================
router.get(
  '/orgs/:orgId/invitations',
  wrapRoute('GET /api/team/orgs/:orgId/invitations', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Execute query ---
    await expireStaleInvitations(orgId)

    const invitations = await prisma.invitation.findMany({
      where: { orgId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: withInviterZone,
    })

    res.json({
      invitations: invitations.map(mapInvitationToApi),
      total: invitations.length,
    })
  }),
)

// ============================================================
// POST /api/team/orgs/:orgId/invitations/:id/regenerate — new link (admin only)
// ============================================================
// Replaces the token in place, so a link that leaked into the wrong inbox stops
// working the moment the admin presses the button.
router.post(
  '/orgs/:orgId/invitations/:invitationId/regenerate',
  wrapRoute('POST /api/team/orgs/:orgId/invitations/:invitationId/regenerate', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const invitationId = String(req.params.invitationId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Execute query ---
    // Scoped by orgId, so an admin of one org cannot regenerate another org's
    // invite by guessing its id. An already-accepted or revoked invite is not a
    // candidate — those are finished, and reviving one would resurrect a link.
    // The fresh expiry is anchored in the ORIGINAL inviter's zone, so the invite
    // keeps one clock for its whole life however many admins press this button.
    // This read authorizes nothing — the `updateMany` below is still the only
    // gate, and a miss here just means the expiry falls back to UTC rather than
    // failing the request.
    const existing = await prisma.invitation.findFirst({
      where: { id: invitationId, orgId, status: 'PENDING' },
      select: withInviterZone,
    })

    const result = await prisma.invitation.updateMany({
      where: { id: invitationId, orgId, status: 'PENDING' },
      data: {
        token: mintInviteToken(),
        expiresAt: inviteExpiresAt(existing?.invitedByUser?.timeZone),
      },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Invitation not found' })
    }

    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitationId },
      include: withInviterZone,
    })

    logger.info({ orgId, userId: authReq.user!.id, invitationId }, 'regenerated an invite link')

    res.json({ invitation: mapInvitationToApi(invitation) })
  }),
)

// ============================================================
// DELETE /api/team/orgs/:orgId/invitations/:id — revoke an invite (admin only)
// ============================================================
router.delete(
  '/orgs/:orgId/invitations/:invitationId',
  wrapRoute('DELETE /api/team/orgs/:orgId/invitations/:invitationId', async (req, res) => {
    const authReq = req as unknown as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const invitationId = String(req.params.invitationId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId, { admin: true })
    if (!membership) return

    // --- Execute query ---
    // Scoped by orgId as well as id, so an admin of one org cannot revoke
    // another org's invite by guessing its id.
    const result = await prisma.invitation.updateMany({
      where: { id: invitationId, orgId, status: 'PENDING' },
      data: { status: 'REVOKED' },
    })
    if (result.count === 0) {
      return void res.status(404).json({ error: 'Invitation not found' })
    }

    res.json({ invitation: { id: invitationId, status: 'REVOKED' } })
  }),
)

export default router
