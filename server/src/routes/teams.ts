/**
 * Organization-scoped team catalog and roster lifecycle (MAI-290).
 *
 * A team lead is a coordination attribute, not a role: every active member may
 * manage teams. The invariant is deliberately enforced at each write: the lead
 * is an active organization member and is present in the team's roster.
 */
import { Router } from 'express'
import { z } from 'zod'

import { logger } from '../../dependencies/logger.js'
import prisma from '../db.js'
import { wrapRoute } from '../lib/fnWrapper.js'
import { requireMembership } from '../lib/membership.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { Prisma } from '../generated/prisma/client.js'

const router = Router({ mergeParams: true })

const memberUserIdsSchema = z
  .array(z.string().trim().min(1, 'Each team member needs a user id.'))
  .min(1, 'A team needs at least one member.')
  .refine((ids) => new Set(ids).size === ids.length, {
    error: 'A team member can appear only once.',
  })

const createTeamSchema = z
  .object({
    name: z.string().trim().min(1, 'A team needs a name.').max(200, 'That team name is too long.'),
    leadUserId: z.string().trim().min(1, 'Choose an active team lead.'),
    memberUserIds: memberUserIdsSchema,
  })
  .strict()
  .refine((value) => value.memberUserIds.includes(value.leadUserId), {
    error: 'The team lead must be on the team roster.',
  })

const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1, 'A team needs a name.').max(200, 'That team name is too long.').optional(),
    leadUserId: z.string().trim().min(1, 'Choose an active team lead.').optional(),
    memberUserIds: memberUserIdsSchema.optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'Choose a team change to save.' })

const teamQuerySchema = z.object({
  isArchived: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
})

const teamInclude = {
  members: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      userId: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, title: true } },
    },
  },
}

type TeamForApi = {
  id: string
  orgId: string
  name: string
  leadUserId: string
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  members: Array<{
    userId: string
    user: { id: string; email: string; firstName: string | null; lastName: string | null; title: string | null }
  }>
}

function mapTeam(team: TeamForApi) {
  return {
    id: team.id,
    orgId: team.orgId,
    name: team.name,
    leadUserId: team.leadUserId,
    isArchived: team.archivedAt !== null,
    archivedAt: team.archivedAt?.toISOString() ?? null,
    memberUserIds: team.members.map((member) => member.userId),
    members: team.members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      title: member.user.title,
    })),
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  }
}

async function rosterIsActive(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  orgId: string,
  userIds: string[],
): Promise<boolean> {
  // Lock the active membership rows through the team write. Member offboarding
  // takes the same row lock before it checks for teams led by that person, so an
  // interleaving request cannot commit an inactive lead or roster member.
  const members = await client.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "Membership"
    WHERE "orgId" = ${orgId}
      AND "isActive" = true
      AND "userId" = ANY(${userIds}::text[])
    FOR UPDATE
  `
  return members.length === userIds.length
}

router.use(requireAuth)

// ============================================================
// GET /api/orgs/:orgId/teams — active catalog by default
// ============================================================
router.get(
  '/',
  wrapRoute('GET /api/orgs/:orgId/teams', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = teamQuerySchema.safeParse(req.query ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })

    // --- Execute query ---
    const teams = await prisma.team.findMany({
      where: { orgId, archivedAt: parsed.data.isArchived ? { not: null } : null },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      include: teamInclude,
    })

    // --- Return response ---
    res.json({ teams: teams.map(mapTeam) })
  }),
)

// ============================================================
// GET /api/orgs/:orgId/teams/:id — one catalog entry
// ============================================================
router.get(
  '/:id',
  wrapRoute('GET /api/orgs/:orgId/teams/:id', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Execute query ---
    const team = await prisma.team.findFirst({ where: { id, orgId }, include: teamInclude })
    if (!team) return void res.status(404).json({ error: 'Team not found' })

    // --- Return response ---
    res.json({ team: mapTeam(team) })
  }),
)

// ============================================================
// POST /api/orgs/:orgId/teams — create team and complete roster
// ============================================================
router.post(
  '/',
  wrapRoute('POST /api/orgs/:orgId/teams', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = createTeamSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const body = parsed.data

    // --- Execute query ---
    let team: TeamForApi
    try {
      team = await prisma.$transaction(async (tx) => {
        if (!(await rosterIsActive(tx, orgId, body.memberUserIds))) {
          throw new Error('INACTIVE_ROSTER')
        }
        return tx.team.create({
          data: {
            orgId,
            name: body.name,
            leadUserId: body.leadUserId,
            members: { create: body.memberUserIds.map((userId) => ({ orgId, userId })) },
          },
          include: teamInclude,
        })
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'INACTIVE_ROSTER') {
        return void res.status(422).json({ error: 'Every team member must be active in this organization.' })
      }
      throw error
    }

    logger.info({ orgId, userId: authReq.user!.id, teamId: team.id }, 'created a team')

    // --- Return response ---
    res.status(201).json({ team: mapTeam(team) })
  }),
)

// ============================================================
// PATCH /api/orgs/:orgId/teams/:id — edit, reassign, archive, recover
// ============================================================
router.patch(
  '/:id',
  wrapRoute('PATCH /api/orgs/:orgId/teams/:id', async (req, res) => {
    const authReq = req as AuthenticatedRequest
    const orgId = String(req.params.orgId)
    const id = String(req.params.id)

    // --- Verify ownership ---
    const membership = await requireMembership(authReq, res, orgId)
    if (!membership) return

    // --- Parse & validate params ---
    const parsed = updateTeamSchema.safeParse(req.body ?? {})
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message })
    const body = parsed.data

    // --- Execute query ---
    let updated: TeamForApi
    try {
      updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.team.findFirst({ where: { id, orgId }, include: teamInclude })
        if (!existing) throw new Error('TEAM_NOT_FOUND')
        if (existing.archivedAt && body.isArchived !== false) throw new Error('TEAM_ARCHIVED')

        const memberUserIds = body.memberUserIds ?? existing.members.map((member) => member.userId)
        const leadUserId = body.leadUserId ?? existing.leadUserId
        if (!memberUserIds.includes(leadUserId)) throw new Error('LEAD_NOT_ON_ROSTER')
        if (!(await rosterIsActive(tx, orgId, memberUserIds))) throw new Error('INACTIVE_ROSTER')

        const result = await tx.team.updateMany({
          where: { id, orgId },
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.leadUserId === undefined ? {} : { leadUserId }),
            ...(body.isArchived === undefined ? {} : { archivedAt: body.isArchived ? new Date() : null }),
          },
        })
        if (result.count === 0) throw new Error('TEAM_NOT_FOUND')

        if (body.memberUserIds) {
          await tx.teamMember.deleteMany({ where: { orgId, teamId: id, userId: { notIn: memberUserIds } } })
          await tx.teamMember.createMany({
            data: memberUserIds.map((userId) => ({ orgId, teamId: id, userId })),
            skipDuplicates: true,
          })
        }

        const team = await tx.team.findFirst({ where: { id, orgId }, include: teamInclude })
        if (!team) throw new Error('TEAM_NOT_FOUND')
        return team
      })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      if (error.message === 'TEAM_NOT_FOUND') return void res.status(404).json({ error: 'Team not found' })
      if (error.message === 'TEAM_ARCHIVED') {
        return void res.status(409).json({ error: 'Recover this team before editing it.' })
      }
      if (error.message === 'LEAD_NOT_ON_ROSTER') {
        return void res.status(422).json({ error: 'Assign a new lead before removing the current lead from the roster.' })
      }
      if (error.message === 'INACTIVE_ROSTER') {
        return void res.status(422).json({ error: 'Every team member must be active in this organization.' })
      }
      throw error
    }

    logger.info({ orgId, userId: authReq.user!.id, teamId: id }, 'updated a team')

    // --- Return response ---
    res.json({ team: mapTeam(updated) })
  }),
)

export default router
