import { ChevronDown } from 'lucide-react'

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
import type { ViewConfig, ViewFilterCondition } from './viewConfig'

interface GridViewToolbarProps {
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
}

function selectedValues(config: ViewConfig, attributeId: string): string[] {
  const filter = config.filterTree
  return filter?.type === 'condition' && filter.attributeId === attributeId && filter.operator === 'in' && Array.isArray(filter.value)
    ? filter.value.filter((value): value is string => typeof value === 'string')
    : []
}

/** The grid's shared view controls. Every action writes the same ViewConfig. */
export function GridViewToolbar({ attributes, config, onConfigChange }: GridViewToolbarProps) {
  const activeSort = config.sorts[0]
  const activeSortAttribute = attributes.find((attribute) => attribute.id === activeSort?.attributeId)
  const selectableAttributes = attributes.filter(
    (attribute) => (attribute.type === 'select' || attribute.type === 'status') && Array.isArray(attribute.optionsJson),
  )

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

  function setSort(attributeId: string, direction: 'asc' | 'desc') {
    onConfigChange((current) => ({ ...current, sorts: [{ attributeId, direction }] }))
  }

  function toggleValue(attribute: AttributeDef, value: string) {
    onConfigChange((current) => {
      const values = selectedValues(current, attribute.id)
      const nextValues = values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
      const filterTree: ViewFilterCondition | undefined = nextValues.length
        ? { type: 'condition', attributeId: attribute.id, operator: 'in', value: nextValues }
        : undefined
      return { ...current, ...(filterTree ? { filterTree } : { filterTree: undefined }) }
    })
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            Sort{activeSortAttribute ? `: ${activeSortAttribute.name} ${activeSort?.direction === 'asc' ? 'A→Z' : 'Z→A'}` : ''}
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Sort by field</DropdownMenuLabel>
          {attributes.flatMap((attribute) => [
            <DropdownMenuItem key={`${attribute.id}-asc`} onSelect={() => setSort(attribute.id, 'asc')}>
              {attribute.name}: Sort A→Z
            </DropdownMenuItem>,
            <DropdownMenuItem key={`${attribute.id}-desc`} onSelect={() => setSort(attribute.id, 'desc')}>
              {attribute.name}: Sort Z→A
            </DropdownMenuItem>,
          ])}
          {activeSort && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onConfigChange((current) => ({ ...current, sorts: [] }))}>
                Clear sort
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            Filter{config.filterTree ? ' · 1' : ''}
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Filter by values</DropdownMenuLabel>
          {selectableAttributes.map((attribute) => (
            <DropdownMenuSub key={attribute.id}>
              <DropdownMenuSubTrigger>{attribute.name}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(attribute.optionsJson as Array<{ value: string; label: string }>).map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={selectedValues(config, attribute.id).includes(option.value)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleValue(attribute, option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          {selectableAttributes.length === 0 && <DropdownMenuItem disabled>No selectable fields</DropdownMenuItem>}
          {config.filterTree && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onConfigChange((current) => ({ ...current, filterTree: undefined }))}>
                Clear filter
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
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

      {activeSortAttribute && (
        <span className="ml-auto text-xs tabular-nums text-text-muted">Sorted by {activeSortAttribute.name}</span>
      )}
    </div>
  )
}
