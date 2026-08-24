import { type ReactNode, useState } from 'react'
import { ChevronDown, Columns3Cog, LayoutList, Search, SlidersHorizontal, Table2, UsersRound, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
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
import { createKanbanConfig, isKanbanGroupAttribute, type TeamScope, type ViewConfig } from './viewConfig'
import { GridFilterBuilder } from './GridFilterBuilder'
import { GridSortPopover } from './GridSortPopover'
import type { GridMenuAnchor } from './gridFilterMenu'
import { GridViewOptionsMenu } from './GridViewOptionsMenu'
import { KanbanCardFieldPicker } from './KanbanCardFieldPicker'

interface GridViewToolbarProps {
  leading?: ReactNode
  orgId?: string
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
  teamScopeSupported?: boolean
  selectedColumnIds?: string[]
  layout?: 'grid' | 'kanban'
  onLayoutChange?: (layout: 'grid' | 'kanban') => void
  searchValue?: string
  searchPending?: boolean
  onSearchChange?: (value: string) => void
  onFindInGrid?: () => void
  onFormat?: (anchor: GridMenuAnchor) => void
  trailing?: ReactNode
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

/** Stable saved-view controls above task-oriented grid commands. */
export function GridViewToolbar({ leading, orgId, attributes, config, onConfigChange, teamScopeSupported = false, selectedColumnIds = [], layout = 'grid', onLayoutChange, searchValue = '', searchPending = false, onSearchChange, onFindInGrid, onFormat, trailing }: GridViewToolbarProps) {
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

  const kanbanGroupFields = attributes.filter(isKanbanGroupAttribute)
  const isKanban = layout === 'kanban'
  const hasGrouping = layout === 'kanban' ? Boolean(config.kanban) : config.groupBy.length > 0

  return (
    <>
      <div role="region" aria-label="View bar" className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex w-max min-w-full items-center gap-1">{leading}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {onLayoutChange && (
            <div role="group" aria-label="Layout" className="flex items-center gap-1">
              <Button type="button" variant="secondary" size="sm" aria-pressed={layout === 'grid'} onClick={() => onLayoutChange('grid')}>
                <Table2 size={16} /> Table
              </Button>
              <Button type="button" variant="secondary" size="sm" aria-pressed={layout === 'kanban'} onClick={() => onLayoutChange('kanban')}>
                <LayoutList size={16} /> Kanban
              </Button>
            </div>
          )}
          {trailing}
        </div>
      </div>

      <div role="region" aria-label="Command bar" className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border bg-surface px-3">
      {onSearchChange && (
        <div className="relative w-56 shrink-0">
          <Search className={`pointer-events-none absolute top-1/2 left-2 z-10 size-4 -translate-y-1/2 ${searchValue ? 'text-primary' : 'text-text-muted'}`} />
          <Input
            type="search"
            aria-label="Search all records"
            aria-busy={searchPending}
            maxLength={200}
            placeholder="Search all records"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            className={`h-8 px-8 text-sm ${searchValue ? 'border-primary bg-bg' : 'bg-bg'}`}
          />
          {searchValue && (
            <IconButton
              type="button"
              tooltip="Clear the record search"
              className="absolute top-0 right-0 h-8 w-8"
              onClick={() => onSearchChange('')}
            >
              <X size={16} />
            </IconButton>
          )}
        </div>
      )}
      {onFindInGrid && (
        <Button type="button" variant="secondary" size="sm" onClick={onFindInGrid}>
          <Search size={16} />
          Find in grid
        </Button>
      )}
      {!isKanban && (
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
      )}

      {!isKanban && selectedColumnIds.length >= 2 && (
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

      <GridSortPopover attributes={attributes} config={config} onConfigChange={onConfigChange} />
      {config.sorts.length > 0 && <span className="text-xs text-text-muted">Clear sort to reorder by hand.</span>}

      <GridFilterBuilder attributes={attributes} config={config} onConfigChange={onConfigChange} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <SlidersHorizontal size={16} />
            Group{hasGrouping ? ' · 1' : ''}
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Group records</DropdownMenuLabel>
          {(layout === 'kanban' ? kanbanGroupFields : attributes).map((attribute) => (
            <DropdownMenuItem
              key={attribute.id}
              onSelect={() => onConfigChange((current) => {
                if (layout !== 'kanban') return { ...current, groupBy: [{ attributeId: attribute.id, direction: 'asc' }] }
                const kanban = createKanbanConfig(attributes, attribute.id)
                return kanban ? { ...current, kanban } : current
              })}
            >
              Group by {attribute.name}
            </DropdownMenuItem>
          ))}
          {hasGrouping && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onConfigChange((current) => layout === 'kanban' ? { ...current, kanban: undefined } : { ...current, groupBy: [] })}>
                Clear grouping
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {layout === 'kanban' && (
        <>
          <KanbanCardFieldPicker attributes={attributes} config={config} onConfigChange={onConfigChange} />
        </>
      )}

      {!isKanban && <GridViewOptionsMenu config={config} onConfigChange={onConfigChange} onFormat={onFormat} />}
      </div>
    </>
  )
}
