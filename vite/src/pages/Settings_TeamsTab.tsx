import { ArrowDown, ArrowUp, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useGetMembers } from '@/hooks/orgs'
import { memberDisplayName } from '@/hooks/orgs'
import { useGetTeams, useUpdateTeam, type Team } from '@/hooks/teams'
import { ApiError } from '@/lib/api'
import { useUrlInt, useUrlString } from '@/hooks/urlState'
import { useAuth } from '@/providers/useAuth'
import { Settings_Teams_ArchiveDialog } from './Settings_Teams_ArchiveDialog'
import { Settings_TeamsDrawer } from './Settings_TeamsDrawer'

const PAGE_SIZE = 25
type Drawer = { team: Team | null; mode: 'create' | 'detail' | 'edit' } | null

export function Settings_TeamsTab() {
  const { org } = useAuth()
  const [page, setPage] = useUrlInt('teamPage', 1)
  const [dir, setDir] = useUrlString('teamDir', 'asc')
  const [archived, setArchived] = useUrlString('archived', 'false')
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [archiveTarget, setArchiveTarget] = useState<Team | null>(null)
  const teams = useGetTeams(org?.id, { page, limit: PAGE_SIZE, sort: 'name', dir: dir === 'desc' ? 'desc' : 'asc', isArchived: archived === 'true' })
  const members = useGetMembers(org?.id, { limit: 200, sort: 'name', dir: 'asc' })
  const update = useUpdateTeam()
  if (!org) return null
  const orgId = org.id
  const data = teams.data
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const closeDrawer = () => setDrawer(null)
  async function recoverTeam(team: Team): Promise<void> {
    try {
      await update.mutateAsync({ orgId, teamId: team.id, isArchived: false })
      toast.success('Team recovered.')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not recover the team. Check your connection and try again.')
    }
  }
  return <div className="flex flex-col gap-6">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Teams{total > 0 && <span className="ml-2 tabular-nums text-text-muted">{total}</span>}</h2><Button size="sm" onClick={() => setDrawer({ team: null, mode: 'create' })}><Plus size={16} />Create team</Button></div>
    <div><Button size="sm" variant="secondary" onClick={() => { setArchived(archived === 'true' ? 'false' : 'true'); setPage(1) }}>{archived === 'true' ? 'Show active teams' : 'Show archived teams'}</Button></div>
    {teams.isPending && <div aria-busy="true" className="h-24 rounded-md border border-border bg-surface" />}
    {teams.isError && <div className="flex gap-3 rounded-md border border-border p-3"><p className="text-sm text-danger">Could not load teams.</p><Button size="sm" variant="secondary" onClick={() => void teams.refetch()}>Try again</Button></div>}
    {data && <div className="overflow-x-auto rounded-md border border-border"><table className="w-full table-fixed text-sm"><caption className="sr-only">Teams in {org.name}</caption><thead><tr className="border-b border-border bg-surface"><th scope="col" className="w-[36%] px-4 py-2 text-left text-xs font-medium text-text-muted"><button className="inline-flex items-center gap-1 hover:text-text" onClick={() => { setDir(dir === 'asc' ? 'desc' : 'asc'); setPage(1) }}>Team {dir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button></th><th scope="col" className="px-4 py-2 text-left text-xs font-medium text-text-muted">Lead</th><th scope="col" className="px-4 py-2 text-left text-xs font-medium text-text-muted">Members</th><th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.teams.map(team => <Row key={team.id} team={team} onOpen={() => setDrawer({ team, mode: 'detail' })} onEdit={() => setDrawer({ team, mode: 'edit' })} onArchive={() => { if (team.isArchived) void recoverTeam(team); else setArchiveTarget(team) }} />)}{data.teams.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm">Create a team to organize your roster.</td></tr>}</tbody></table></div>}
    {total > PAGE_SIZE && <div className="flex items-center justify-between"><p className="text-xs tabular-nums text-text-muted">Page {page} of {lastPage}</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    <Settings_TeamsDrawer key={drawer ? `${drawer.mode}:${drawer.team?.id ?? 'new'}` : 'closed'} orgId={org.id} team={drawer?.team ?? null} members={members.data?.members ?? []} open={Boolean(drawer)} startEditing={drawer?.mode !== 'detail'} onOpenChange={open => { if (!open) closeDrawer() }} />
    <Settings_Teams_ArchiveDialog orgId={org.id} team={archiveTarget} onOpenChange={open => { if (!open) setArchiveTarget(null) }} />
  </div>
}

function Row({ team, onOpen, onEdit, onArchive }: { team: Team; onOpen: () => void; onEdit: () => void; onArchive: () => void }) {
  const lead = team.members.find(member => member.userId === team.leadUserId)
  return <tr className="border-b border-border last:border-0"><td className="px-4 py-2"><button aria-label={`Open ${team.name}`} onClick={onOpen}>{team.name}</button></td><td className="px-4 py-2">{lead ? memberDisplayName(lead) : 'Unknown member'}</td><td className="px-4 py-2"><div className="flex items-center gap-2"><div className="flex -space-x-1">{team.members.slice(0, 3).map(member => <span key={member.userId} aria-label={`Avatar for ${memberDisplayName(member)}`}><Avatar name={memberDisplayName(member)} /></span>)}</div><span>{team.members.length}</span></div></td><td className="px-2 py-1"><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={`Show actions for ${team.name}`}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{!team.isArchived && <DropdownMenuItem onSelect={onEdit}>Edit team</DropdownMenuItem>}<DropdownMenuItem onSelect={onArchive}>{team.isArchived ? 'Recover team' : 'Archive team'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></td></tr>
}
