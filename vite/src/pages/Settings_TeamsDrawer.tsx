import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useCreateTeam, useUpdateTeam } from '@/hooks/teams'
import type { Team } from '@/hooks/teams'
import type { OrgMember } from '@/hooks/orgs'
import { ApiError } from '@/lib/api'
import { memberDisplayName } from '@/hooks/orgs'

interface Props {
  orgId: string
  team: Team | null
  members: OrgMember[]
  open: boolean
  startEditing?: boolean
  onOpenChange: (open: boolean) => void
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not save the team. Check your connection and try again.'
}

export function Settings_TeamsDrawer({ orgId, team, members, open, startEditing = !team, onOpenChange }: Props) {
  const [editing, setEditing] = useState(startEditing)
  const [name, setName] = useState(team?.name ?? '')
  const [leadUserId, setLeadUserId] = useState(team?.leadUserId ?? '')
  const [memberUserIds, setMemberUserIds] = useState<string[]>(team?.memberUserIds ?? [])
  const [nameError, setNameError] = useState<string | null>(null)
  const createTeam = useCreateTeam()
  const updateTeam = useUpdateTeam()

  const lead = team?.members.find((member) => member.userId === team.leadUserId)

  function toggleMember(userId: string): void {
    if (userId === leadUserId) return
    setMemberUserIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId])
  }

  function selectLead(userId: string): void {
    setLeadUserId(userId)
    setMemberUserIds((current) => current.includes(userId) ? current : [...current, userId])
  }

  async function save(): Promise<void> {
    const trimmedName = name.trim()
    if (!trimmedName) return void setNameError('Enter a team name.')
    if (!leadUserId) return void setNameError('Choose a team lead.')

    const body = { orgId, name: trimmedName, leadUserId, memberUserIds }
    try {
      if (team) {
        await updateTeam.mutateAsync({ ...body, teamId: team.id })
        toast.success('Team updated.')
      } else {
        await createTeam.mutateAsync(body)
        toast.success('Team created.')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 bg-bg p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-4 pr-12">
          <SheetTitle>{team ? team.name : 'Create team'}</SheetTitle>
          <SheetDescription>{editing ? 'Choose a lead and add the team roster.' : 'Team roster and coordination lead.'}</SheetDescription>
        </SheetHeader>

        {team && !editing ? (
          <div className="flex flex-col gap-6 p-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Team lead</h3>
              <p className="text-sm text-text-muted">{lead ? teamMemberName(lead) : 'No lead assigned'}</p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Members</h3>
              <div className="flex flex-col gap-2">
                {team.members.map((member) => (
                  <div key={member.userId} className="flex items-center gap-2 text-sm">
                    <Avatar name={teamMemberName(member)} />
                    {teamMemberName(member)}
                  </div>
                ))}
              </div>
            </div>
            {!team.isArchived && <div><Button size="sm" onClick={() => setEditing(true)}>Edit team</Button></div>}
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                value={name}
                aria-invalid={Boolean(nameError)}
                onChange={(event) => { setName(event.target.value); setNameError(null) }}
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-lead">Team lead</Label>
              <Select value={leadUserId} onValueChange={selectLead}>
                <SelectTrigger id="team-lead" size="sm" className="w-full"><SelectValue placeholder="Choose a lead" /></SelectTrigger>
                <SelectContent>
                  {members.map((member) => <SelectItem key={member.userId} value={member.userId}>{memberDisplayName(member)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-text-muted">The lead is a coordination attribute, not a role.</p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Roster</legend>
              {members.map((member) => {
                const selected = memberUserIds.includes(member.userId)
                const isLead = member.userId === leadUserId
                return (
                  <label key={member.userId} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selected} disabled={isLead} onCheckedChange={() => toggleMember(member.userId)} />
                    {memberDisplayName(member)}{isLead && <span className="text-xs text-text-muted">Lead</span>}
                  </label>
                )
              })}
            </fieldset>
            <div><Button size="sm" disabled={createTeam.isPending || updateTeam.isPending} onClick={() => void save()}>{team ? 'Save changes' : 'Create team'}</Button></div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function teamMemberName(member: Pick<Team['members'][number], 'firstName' | 'lastName' | 'email'>): string {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
}
