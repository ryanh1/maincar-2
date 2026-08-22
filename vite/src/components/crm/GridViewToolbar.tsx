import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
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

      {activeSortAttribute && (
        <span className="ml-auto text-xs tabular-nums text-text-muted">Sorted by {activeSortAttribute.name}</span>
      )}
    </div>
  )
}
