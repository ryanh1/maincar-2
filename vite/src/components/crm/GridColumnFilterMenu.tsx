import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@/components/ui/popover'
import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig, ViewFilterCondition } from './viewConfig'
import {
  CONDITION_GROUPS,
  conditionChoice,
  filterForAttribute,
  filterKind,
  stringValue,
  type GridFilterValue,
  type GridMenuAnchor,
  type ConditionChoice,
} from './gridFilterMenu'

interface GridColumnFilterMenuProps {
  attribute: AttributeDef
  anchor: GridMenuAnchor
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  values: GridFilterValue[]
}


/**
 * The shared header-owned control for every record grid. It owns a draft until
 * Apply, so a menu can be explored without changing the record query beneath it.
 */
export function GridColumnFilterMenu({ attribute, anchor, config, onConfigChange, onOpenChange, open, values }: GridColumnFilterMenuProps) {
  const currentFilter = filterForAttribute(config, attribute.id)
  const activeSort = config.sorts[0]
  const [draftSort, setDraftSort] = useState<'asc' | 'desc' | undefined>(activeSort?.attributeId === attribute.id ? activeSort.direction : undefined)
  const [clearSort, setClearSort] = useState(false)
  const [draftCondition, setDraftCondition] = useState<ConditionChoice | undefined>(currentFilter?.operator === 'in' ? undefined : conditionChoice(attribute, currentFilter?.operator))
  const [draftValue, setDraftValue] = useState(stringValue(currentFilter?.value))
  const [draftValues, setDraftValues] = useState<string[]>(currentFilter?.operator === 'in' && Array.isArray(currentFilter.value)
    ? currentFilter.value.filter((value): value is string => typeof value === 'string')
    : [])
  const [filterTouched, setFilterTouched] = useState(false)
  const [valueSearch, setValueSearch] = useState('')

  const visibleValues = useMemo(() => {
    const query = valueSearch.trim().toLocaleLowerCase()
    return query ? values.filter((value) => value.label.toLocaleLowerCase().includes(query)) : values
  }, [valueSearch, values])
  const choiceNeedsValue = draftCondition?.needsValue ?? false
  const canApply = !choiceNeedsValue || draftValue.trim().length > 0

  function closeMenu() {
    onOpenChange(false)
  }

  function toggleDraftValue(value: string) {
    setFilterTouched(true)
    setDraftCondition(undefined)
    setDraftValues((current) => attribute.type === 'checkbox' ? (current.includes(value) ? [] : [value]) : current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value])
  }

  function apply() {
    if (!canApply) return
    const condition: ViewFilterCondition | undefined = draftCondition
      ? {
          type: 'condition',
          attributeId: attribute.id,
          operator: draftCondition.operator,
          ...(draftCondition.needsValue ? { value: draftValue.trim() } : draftCondition.fixedValue === undefined ? {} : { value: draftCondition.fixedValue }),
        }
      : draftValues.length > 0
        ? attribute.type === 'checkbox'
          ? { type: 'condition', attributeId: attribute.id, operator: 'eq', value: draftValues[0] === 'true' }
          : { type: 'condition', attributeId: attribute.id, operator: 'in', value: draftValues }
        : undefined

    onConfigChange((current) => ({
      ...current,
      ...(clearSort ? { sorts: [] } : draftSort ? { sorts: [{ attributeId: attribute.id, direction: draftSort }] } : {}),
      ...(filterTouched ? (condition ? { filterTree: condition } : { filterTree: undefined }) : {}),
    }))
    closeMenu()
  }

  function clear() {
    onConfigChange((current) => ({ ...current, filterTree: undefined }))
    closeMenu()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-80 p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <PopoverHeader>
          <PopoverTitle>Filter {attribute.name}</PopoverTitle>
        </PopoverHeader>

        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted">Sort</span>
            <Button size="sm" variant={draftSort === 'asc' && !clearSort ? 'default' : 'secondary'} onClick={() => { setDraftSort('asc'); setClearSort(false) }}>A to Z</Button>
            <Button size="sm" variant={draftSort === 'desc' && !clearSort ? 'default' : 'secondary'} onClick={() => { setDraftSort('desc'); setClearSort(false) }}>Z to A</Button>
            {(draftSort || activeSort?.attributeId === attribute.id) && <Button size="sm" variant="secondary" onClick={() => { setDraftSort(undefined); setClearSort(true) }}>Clear sort</Button>}
          </div>

          <div className="border-t border-border pt-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" className="w-full justify-between">
                  Filter by condition
                  <ChevronDown size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                {CONDITION_GROUPS[filterKind(attribute)].map((group, groupIndex) => (
                  <div key={group.label}>
                    {groupIndex > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                    {group.choices.map((choice) => (
                      <DropdownMenuItem
                        key={`${choice.operator}-${choice.label}`}
                        onSelect={() => {
                          setDraftCondition(choice)
                          setDraftValues([])
                          setDraftValue(choice.operator === 'eq' && attribute.type === 'checkbox' ? 'true' : '')
                          setFilterTouched(true)
                        }}
                      >
                        {choice.label}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {draftCondition && (
              <div className="mt-2 flex flex-col gap-1">
                <span className="text-xs text-text-muted">{draftCondition.label}</span>
                {draftCondition.needsValue && attribute.type !== 'checkbox' && (
                  <Input
                    aria-label={`Value for ${attribute.name}`}
                    className="h-8"
                    inputMode={filterKind(attribute) === 'number' ? 'decimal' : undefined}
                    placeholder={filterKind(attribute) === 'date' ? 'YYYY-MM-DD' : 'Enter a value'}
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                  />
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-muted">Filter by values</span>
              <span className="text-xs tabular-nums text-text-muted" aria-live="polite">{draftValues.length} selected</span>
            </div>
            <Input
              aria-label={`Search values for ${attribute.name}`}
              className="mt-2 h-8"
              type="search"
              placeholder="Search values"
              value={valueSearch}
              onChange={(event) => setValueSearch(event.target.value)}
            />
            <div className="mt-2 max-h-40 overflow-y-auto" role="group" aria-label={`Values for ${attribute.name}`}>
              {visibleValues.map((value) => (
                <label key={value.value} className="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-sm">
                  <Checkbox checked={draftValues.includes(value.value)} onCheckedChange={() => toggleDraftValue(value.value)} />
                  <span className="min-w-0 truncate">{value.label}</span>
                </label>
              ))}
              {visibleValues.length === 0 && <p className="px-1 py-2 text-xs text-text-muted">No matching values.</p>}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button size="sm" variant="secondary" disabled={!currentFilter} onClick={clear}>Clear filter</Button>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" aria-label="Cancel filter changes" onClick={closeMenu}>Cancel</Button>
              <Button size="sm" disabled={!canApply} onClick={apply}>Apply filter</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
