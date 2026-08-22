import { type ReactNode, useState } from 'react'
import { ChevronDown, Columns3Cog, PanelsTopLeft, Rows3, SlidersHorizontal, UsersRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AttributeDef } from '@/lib/crmTypes'
import { memberDisplayName, useGetMembers, useGetTeams } from '@/hooks/orgs'
import type { TeamScope, ViewConfig } from './viewConfig'
import { GridFilterBuilder } from './GridFilterBuilder'

interface GridViewToolbarProps {
  leading?: ReactNode
  orgId?: string
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
  teamScopeSupported?: boolean
  createLabel?: string
  onCreate?: () => void
  createDisabled?: boolean
  selectedColumnIds?: string[]
}

function scopeLabel(scope: TeamScope | undefined, teams: Array<{ id: string; name: string }>, members: Array<{ userId: string; firstName: string | null; lastName: string | null; email: string }>): string | null {
  if (!scope) return null
  const teamNames = (scope.teamIds ?? []).map((id) => teams.find((team) => team.id === id)?.name ?? id)
  const leadNames = (scope.leadUserIds ?? []).map((id) => {
    const member = members.find((candidate) => candidate.userId === id)
    return member ? memberDisplayName(member) : id
  })
  const labels = [
    ...(teamNames.length ? [`Team: ${teamNames.join(', ')}`] : []),
    ...(leadNames.length ? [`Teams led by ${leadNames.join(', ')}`] : []),
  ]
  return labels.length ? labels.join(' · ') : null
}

interface TeamScopeControlProps {
  orgId: string
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
}

function TeamScopeMenu({ orgId, config, onConfigChange }: TeamScopeControlProps) {
  const teamsQuery = useGetTeams(orgId)
  const membersQuery = useGetMembers(orgId, { limit: 200, sort: 'name' })
  const teams = teamsQuery.data?.teams ?? []
  const members = membersQuery.data?.members ?? []

  function toggleTeamScopeId(kind: 'teamIds' | 'leadUserIds', id: string) {
    onConfigChange((current) => {
      const currentScope = current.teamScope ?? {}
      const selected = currentScope[kind] ?? []
      const next = selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]
      const teamIds = kind === 'teamIds' ? next : currentScope.teamIds ?? []
      const leadUserIds = kind === 'leadUserIds' ? next : currentScope.leadUserIds ?? []
      const teamScope = teamIds.length || leadUserIds.length
        ? { ...(teamIds.length ? { teamIds } : {}), ...(leadUserIds.length ? { leadUserIds } : {}) }
        : undefined
      return { ...current, ...(teamScope ? { teamScope } : { teamScope: undefined }) }
    })
  }

  return (
    <>
        <DropdownMenuLabel>Specific teams</DropdownMenuLabel>
        {teams.map((team) => (
          <DropdownMenuCheckboxItem key={team.id} checked={config.teamScope?.teamIds?.includes(team.id) ?? false} onSelect={(event) => event.preventDefault()} onCheckedChange={() => toggleTeamScopeId('teamIds', team.id)}>
            {team.name}
          </DropdownMenuCheckboxItem>
        ))}
        {!teamsQuery.isPending && teams.length === 0 && <DropdownMenuItem disabled>No active teams</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Teams led by</DropdownMenuLabel>
        {members.map((member) => (
          <DropdownMenuCheckboxItem key={member.userId} checked={config.teamScope?.leadUserIds?.includes(member.userId) ?? false} onSelect={(event) => event.preventDefault()} onCheckedChange={() => toggleTeamScopeId('leadUserIds', member.userId)}>
            {memberDisplayName(member)}
          </DropdownMenuCheckboxItem>
        ))}
        {!membersQuery.isPending && members.length === 0 && <DropdownMenuItem disabled>No active members</DropdownMenuItem>}
        {config.teamScope && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onConfigChange((current) => ({ ...current, teamScope: undefined }))}>Clear Team filter</DropdownMenuItem>
          </>
        )}
    </>
  )
}

function TeamScopeChip({ orgId, config }: Pick<TeamScopeControlProps, 'orgId' | 'config'>) {
  const teams = useGetTeams(orgId).data?.teams ?? []
  const members = useGetMembers(orgId, { limit: 200, sort: 'name' }).data?.members ?? []
  const label = scopeLabel(config.teamScope, teams, members)
  return label ? <span className="text-xs text-text-muted">{label}</span> : null
}

/** The grid's shared view controls. Every action writes the same ViewConfig. */
export function GridViewToolbar({ leading, orgId, attributes, config, onConfigChange, teamScopeSupported = false, createLabel, onCreate, createDisabled = false, selectedColumnIds = [] }: GridViewToolbarProps) {
  const [columnGroupName, setColumnGroupName] = useState('')
  function setColumnVisible(attributeId: string, visible: boolean) {
    onConfigChange((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.attributeId === attributeId ? { ...column, visible } : column)),
    }))
  }

  function setColumnWidth(attributeId: string, rawValue: string) {
    const width = Number(rawValue)
    if (!Number.isFinite(width)) return
    onConfigChange((current) => ({
      ...current,
      columnWidths: { ...current.columnWidths, [attributeId]: Math.min(500, Math.max(50, Math.round(width))) },
    }))
  }

  function setFrozenCount(key: 'frozenRows' | 'frozenCols', rawValue: string) {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    onConfigChange((current) => ({ ...current, [key]: Math.max(0, Math.floor(value)) }))
  }

  function createColumnGroup() {
    const group = columnGroupName.trim()
    if (!group || selectedColumnIds.length < 2) return
    const selected = new Set(selectedColumnIds)
    onConfigChange((current) => ({
      ...current,
      columns: current.columns.map((column) => selected.has(column.attributeId) ? { ...column, group, collapsed: false } : column),
    }))
    setColumnGroupName('')
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface px-3">
      {leading}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Columns3Cog size={16} />
            Fields
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Visible fields</DropdownMenuLabel>
          {attributes.map((attribute) => {
            const visible = config.columns.find((column) => column.attributeId === attribute.id)?.visible ?? true
            return (
              <DropdownMenuCheckboxItem
                key={attribute.id}
                checked={visible}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => setColumnVisible(attribute.id, checked)}
              >
                {attribute.name}
              </DropdownMenuCheckboxItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Set exact width</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56 p-2">
              {attributes.map((attribute) => (
                <label key={attribute.id} className="mb-2 flex items-center gap-2 text-xs text-text-muted last:mb-0">
                  <span className="min-w-0 flex-1 truncate">{attribute.name}</span>
                  <Input
                    aria-label={`${attribute.name} width in pixels`}
                    className="h-7 w-20"
                    min={50}
                    max={500}
                    type="number"
                    value={config.columnWidths[attribute.id] ?? ''}
                    onChange={(event) => setColumnWidth(attribute.id, event.target.value)}
                  />
                </label>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedColumnIds.length >= 2 && (
        <div className="flex items-center gap-1">
          <Input
            aria-label="Column group name"
            className="h-8 w-36"
            placeholder="Group name"
            value={columnGroupName}
            onChange={(event) => setColumnGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                createColumnGroup()
              }
            }}
          />
          <Button type="button" size="sm" disabled={!columnGroupName.trim()} onClick={createColumnGroup}>Group columns</Button>
        </div>
      )}

      {teamScopeSupported && orgId && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <UsersRound size={16} />
              Team
              <ChevronDown size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <TeamScopeMenu orgId={orgId} config={config} onConfigChange={onConfigChange} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {teamScopeSupported && orgId && config.teamScope && <TeamScopeChip orgId={orgId} config={config} />}

      <GridFilterBuilder attributes={attributes} config={config} onConfigChange={onConfigChange} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <SlidersHorizontal size={16} />
            Group{config.groupBy[0] ? ' · 1' : ''}
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Group records</DropdownMenuLabel>
          {attributes.map((attribute) => (
            <DropdownMenuItem
              key={attribute.id}
              onSelect={() => onConfigChange((current) => ({ ...current, groupBy: [{ attributeId: attribute.id, direction: 'asc' }] }))}
            >
              Group by {attribute.name}
            </DropdownMenuItem>
          ))}
          {config.groupBy.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onConfigChange((current) => ({ ...current, groupBy: [] }))}>
                Clear grouping
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Rows3 size={16} />
            Row height
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Row height</DropdownMenuLabel>
          {(['compact', 'comfortable', 'tall'] as const).map((rowHeight) => (
            <DropdownMenuItem key={rowHeight} onSelect={() => onConfigChange((current) => ({ ...current, rowHeight }))}>
              {rowHeight.slice(0, 1).toUpperCase() + rowHeight.slice(1)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={config.gridLines}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(gridLines) => onConfigChange((current) => ({ ...current, gridLines }))}
          >
            Show grid lines
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <PanelsTopLeft size={16} />
            Freeze
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 p-2">
          <label className="mb-2 flex items-center gap-2 text-xs text-text-muted">
            Frozen rows
            <Input
              aria-label="Frozen rows"
              className="h-7 w-20"
              min={0}
              type="number"
              value={config.frozenRows}
              onChange={(event) => setFrozenCount('frozenRows', event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            Frozen columns
            <Input
              aria-label="Frozen columns"
              className="h-7 w-20"
              min={0}
              type="number"
              value={config.frozenCols}
              onChange={(event) => setFrozenCount('frozenCols', event.target.value)}
            />
          </label>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        {createLabel && onCreate && <Button type="button" size="sm" disabled={createDisabled} onClick={onCreate}>{createLabel}</Button>}
      </div>
    </div>
  )
}
