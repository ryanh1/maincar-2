import { describe, expect, it, vi } from 'vitest'

import { InvalidTeamScopeError, resolveOwnerTeamScope } from '../teamScope.js'

function client() {
  return {
    membership: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
  }
}

describe('resolveOwnerTeamScope', () => {
  it('does not query or filter when there is no selection', async () => {
    const prisma = client()

    await expect(resolveOwnerTeamScope(prisma as never, 'org-a', {})).resolves.toBeUndefined()
    expect(prisma.membership.findMany).not.toHaveBeenCalled()
    expect(prisma.team.findMany).not.toHaveBeenCalled()
  })

  it('unions explicit teams and teams led by active members into a deduplicating owner predicate', async () => {
    const prisma = client()
    prisma.membership.findMany.mockResolvedValue([{ userId: 'lead-b' }])
    prisma.team.findMany.mockResolvedValue([
      { id: 'team-a', members: [{ userId: 'owner-a' }, { userId: 'owner-b' }] },
      { id: 'team-b', members: [{ userId: 'owner-b' }, { userId: 'owner-c' }] },
    ])

    await expect(resolveOwnerTeamScope(prisma as never, 'org-a', {
      teamIds: ['team-a'], leadUserIds: ['lead-b'],
    })).resolves.toEqual({ ownerUserId: { in: ['owner-a', 'owner-b', 'owner-c'] } })
  })

  it('rejects an inactive or foreign lead before resolving teams', async () => {
    const prisma = client()
    prisma.membership.findMany.mockResolvedValue([])

    await expect(resolveOwnerTeamScope(prisma as never, 'org-a', { leadUserIds: ['other-org-user'] }))
      .rejects.toBeInstanceOf(InvalidTeamScopeError)
    expect(prisma.team.findMany).not.toHaveBeenCalled()
  })

  it('rejects an archived, unknown, or foreign explicitly selected team', async () => {
    const prisma = client()
    prisma.team.findMany.mockResolvedValue([])

    await expect(resolveOwnerTeamScope(prisma as never, 'org-a', { teamIds: ['team-archived'] }))
      .rejects.toThrow('Each selected team must be active and belong to this organization.')
  })

  it('deduplicates repeated input ids and rejects blank ids', async () => {
    const prisma = client()
    prisma.team.findMany.mockResolvedValue([{ id: 'team-a', members: [] }])

    await expect(resolveOwnerTeamScope(prisma as never, 'org-a', { teamIds: ['team-a', 'team-a'] }))
      .resolves.toEqual({ ownerUserId: { in: [] } })
    await expect(resolveOwnerTeamScope(prisma as never, 'org-a', { teamIds: [' '] }))
      .rejects.toThrow('Each team id must be non-empty.')
  })
})
