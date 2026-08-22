import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useGetTeams } from '@/hooks/orgs'
import type { Team } from '@/hooks/orgs'
import type { OwnerTeamScope } from '@/lib/reportTypes'

interface Props {
  orgId: string | null
  value: OwnerTeamScope | undefined
  onChange: (scope: OwnerTeamScope | undefined) => void
}

interface LeadOption {
  userId: string
  label: string
}

function personLabel(member: Team['members'][number]): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ')
  return name || member.email
}

function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]
}

function selectedScope(teamIds: string[], leadUserIds: string[]): OwnerTeamScope | undefined {
  if (teamIds.length === 0 && leadUserIds.length === 0) return undefined
  return {
    ...(teamIds.length > 0 ? { teamIds } : {}),
    ...(leadUserIds.length > 0 ? { leadUserIds } : {}),
  }
}

function scopeSummary(value: OwnerTeamScope | undefined, teamsById: Map<string, Team>, leadsById: Map<string, LeadOption>): string {
  const teamNames = (value?.teamIds ?? []).map((id) => {
    const team = teamsById.get(id)
    return team ? `${team.name}${team.isArchived ? ' (unavailable)' : ''}` : 'Unavailable team'
  })
  const leadNames = (value?.leadUserIds ?? []).map((id) => {
    const lead = leadsById.get(id)
    return `teams led by ${lead?.label ?? 'an unavailable person'}`
  })
  const selections = [...teamNames, ...leadNames]
  return selections.length === 0 ? 'All owners.' : `Owner is on ${selections.join(' or ')}.`
}

/** One report filter, backed entirely by the shared server-side Team scope. */
export function Reports_OwnerTeamScope({ orgId, value, onChange }: Props) {
  const activeTeamsQuery = useGetTeams(orgId)
  const archivedTeamsQuery = useGetTeams(orgId, { isArchived: true })
  const activeTeams = activeTeamsQuery.data?.teams ?? []
  const archivedTeams = archivedTeamsQuery.data?.teams ?? []
  const teamIds = value?.teamIds ?? []
  const leadUserIds = value?.leadUserIds ?? []
  const teamsById = new Map([...activeTeams, ...archivedTeams].map((team) => [team.id, team]))
  const leadsById = new Map<string, LeadOption>()

  for (const team of activeTeams) {
    const lead = team.members.find((member) => member.userId === team.leadUserId)
    if (lead) leadsById.set(lead.userId, { userId: lead.userId, label: personLabel(lead) })
  }

  function setTeamIds(nextTeamIds: string[]) {
    onChange(selectedScope(nextTeamIds, [...leadUserIds]))
  }

  function setLeadUserIds(nextLeadUserIds: string[]) {
    onChange(selectedScope([...teamIds], nextLeadUserIds))
  }

  const unavailableTeams = teamIds
    .map((id) => teamsById.get(id))
    .filter((team): team is Team => !!team?.isArchived)
  const unavailableLeadIds = leadUserIds.filter((id) => !leadsById.has(id))

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3" aria-labelledby="owner-team-filter-title">
      <div className="flex flex-col gap-1">
        <h3 id="owner-team-filter-title" className="text-sm font-semibold">Owner&apos;s team</h3>
        <p className="text-sm text-text-muted">{scopeSummary(value, teamsById, leadsById)}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Specific teams</legend>
          {activeTeamsQuery.isPending ? <Skeleton className="h-8 w-full" /> : activeTeams.map((team) => (
            <label key={team.id} className="flex min-h-8 items-center gap-2 text-sm">
              <Checkbox
                checked={teamIds.includes(team.id)}
                onCheckedChange={() => setTeamIds(toggle(teamIds, team.id))}
              />
              {team.name}
            </label>
          ))}
          {!activeTeamsQuery.isPending && activeTeams.length === 0 && (
            <p className="text-sm text-text-muted">Create a team before filtering owners by team.</p>
          )}
          {unavailableTeams.map((team) => (
            <div key={team.id} className="flex items-center justify-between gap-2 text-sm text-text-muted">
              <span>{team.name} (Unavailable)</span>
              <Button size="sm" variant="secondary" onClick={() => setTeamIds(teamIds.filter((id) => id !== team.id))}>
                Remove {team.name}
              </Button>
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Teams led by</legend>
          {activeTeamsQuery.isPending ? <Skeleton className="h-8 w-full" /> : [...leadsById.values()].map((lead) => (
            <label key={lead.userId} className="flex min-h-8 items-center gap-2 text-sm">
              <Checkbox
                checked={leadUserIds.includes(lead.userId)}
                onCheckedChange={() => setLeadUserIds(toggle(leadUserIds, lead.userId))}
              />
              Teams led by {lead.label}
            </label>
          ))}
          {!activeTeamsQuery.isPending && leadsById.size === 0 && (
            <p className="text-sm text-text-muted">No active team leads are available.</p>
          )}
          {unavailableLeadIds.map((leadUserId) => (
            <div key={leadUserId} className="flex items-center justify-between gap-2 text-sm text-text-muted">
              <span>Unavailable team lead</span>
              <Button size="sm" variant="secondary" onClick={() => setLeadUserIds(leadUserIds.filter((id) => id !== leadUserId))}>
                Remove team lead
              </Button>
            </div>
          ))}
        </fieldset>
      </div>

      {(activeTeamsQuery.isError || archivedTeamsQuery.isError) && (
        <p className="text-sm text-destructive">Could not load teams. Try again.</p>
      )}
    </section>
  )
}
