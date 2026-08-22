import type { PrismaClient } from '../generated/prisma/client.js'

/** A caller's explicit team and team-lead selections for one organization. */
export interface TeamScope {
  teamIds?: readonly string[]
  leadUserIds?: readonly string[]
}

/** The deduplicating owner predicate every owner-backed object query can spread into its where clause. */
export interface OwnerTeamScopePredicate {
  ownerUserId: { in: string[] }
}

export class InvalidTeamScopeError extends Error {
  status = 422
}

type TeamScopeClient = Pick<PrismaClient, 'membership' | 'team'>

function uniqueIds(ids: readonly string[] | undefined, label: string): string[] {
  const values = [...new Set(ids ?? [])]
  if (values.some((id) => !id.trim())) {
    throw new InvalidTeamScopeError(`Each ${label} id must be non-empty.`)
  }
  return values
}

/**
 * Resolves active teams selected explicitly and through their current lead.
 *
 * This deliberately returns an owner-id `IN` predicate instead of joining a
 * record table to TeamMember: a person in several selected teams still matches
 * their CRM record once. It is therefore equivalent to a deduplicating EXISTS
 * predicate, and can be spread into any Prisma owner-backed query.
 */
export async function resolveOwnerTeamScope(
  prisma: TeamScopeClient,
  orgId: string,
  scope: TeamScope,
): Promise<OwnerTeamScopePredicate | undefined> {
  const teamIds = uniqueIds(scope.teamIds, 'team')
  const leadUserIds = uniqueIds(scope.leadUserIds, 'lead user')

  if (teamIds.length === 0 && leadUserIds.length === 0) return undefined

  if (leadUserIds.length > 0) {
    const activeLeads = await prisma.membership.findMany({
      where: { orgId, userId: { in: leadUserIds }, isActive: true },
      select: { userId: true },
    })
    if (activeLeads.length !== leadUserIds.length) {
      throw new InvalidTeamScopeError('Each team lead must be an active member of this organization.')
    }
  }

  const teams = await prisma.team.findMany({
    where: {
      orgId,
      archivedAt: null,
      OR: [
        ...(teamIds.length > 0 ? [{ id: { in: teamIds } }] : []),
        ...(leadUserIds.length > 0 ? [{ leadUserId: { in: leadUserIds } }] : []),
      ],
    },
    select: { id: true, members: { select: { userId: true } } },
  })

  const activeTeamIds = new Set(teams.map((team) => team.id))
  if (teamIds.some((id) => !activeTeamIds.has(id))) {
    throw new InvalidTeamScopeError('Each selected team must be active and belong to this organization.')
  }

  return { ownerUserId: { in: [...new Set(teams.flatMap((team) => team.members.map((member) => member.userId)))] } }
}
