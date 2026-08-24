import { useMemo, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

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
import { PAINT_TOKENS } from '@/lib/paintTokens'
import { setColumnHeaderColor, type ViewConfig, type ViewFilterCondition } from './viewConfig'
import {
  CONDITION_GROUPS,
  conditionChoice,
  filterForAttribute,
  filterKind,
  removeFiltersForAttribute,
  stringValue,
  upsertFilterForAttribute,
  type ConditionChoice,
  type GridFilterValue,
  type GridMenuAnchor,
} from './gridFilterMenu'

interface GridColumnFilterMenuProps {
  attribute: AttributeDef
  anchor: GridMenuAnchor
  config: ViewConfig
  freezeActions?: {
    freezeLabel: string
    onFreeze: () => void
    onUnfreeze: () => void
    unfreezeLabel: string
  }
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
  onOpenChange: (open: boolean) => void
  onToggleWrap?: () => void
  onConditionalFormat?: () => void
  open: boolean
  values: GridFilterValue[]
  wrap?: boolean
}

/** Header-owned sorting and filtering stay as drafts until Apply. */
export function GridColumnFilterMenu({ attribute, anchor, config, freezeActions, onConfigChange, onOpenChange, onToggleWrap, onConditionalFormat, open, values, wrap = false }: GridColumnFilterMenuProps) {
  const currentFilter = filterForAttribute(config, attribute.id)
  const activeSort = config.sorts.find((sort) => sort.attributeId === attribute.id)
  const headerColor = config.columnStyles.find((style) => style.attributeId === attribute.id)?.headerColor
  const [draftSort, setDraftSort] = useState<'asc' | 'desc' | undefined>(activeSort?.direction)
  const [sortTouched, setSortTouched] = useState(false)
  const [draftCondition, setDraftCondition] = useState<ConditionChoice | undefined>(() => {
    if (currentFilter?.operator === 'in') return undefined
    if (attribute.type === 'checkbox' && currentFilter?.operator === 'eq' && typeof currentFilter.value === 'boolean') {
      return CONDITION_GROUPS.boolean[0]?.choices.find((choice) => choice.fixedValue === currentFilter.value)
    }
    return conditionChoice(attribute, currentFilter?.operator)
  })
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
  const canApply = !draftCondition?.needsValue || draftValue.trim().length > 0

  function closeMenu() {
    onOpenChange(false)
  }

  function toggleDraftValue(value: string) {
    setFilterTouched(true)
    setDraftCondition(undefined)
    setDraftValues((current) => attribute.type === 'checkbox'
      ? (current.includes(value) ? [] : [value])
      : current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value])
  }

  function draftFilter(): ViewFilterCondition | undefined {
    if (draftCondition) {
      return {
        type: 'condition',
        attributeId: attribute.id,
        operator: draftCondition.operator,
        ...(draftCondition.needsValue ? { value: draftValue.trim() } : draftCondition.fixedValue === undefined ? {} : { value: draftCondition.fixedValue }),
      }
    }
    if (draftValues.length === 0) return undefined
    return attribute.type === 'checkbox'
      ? { type: 'condition', attributeId: attribute.id, operator: 'eq', value: draftValues[0] === 'true' }
      : { type: 'condition', attributeId: attribute.id, operator: 'in', value: draftValues }
  }

  function apply() {
    if (!canApply) return
    const condition = draftFilter()
    onConfigChange((current) => {
      const otherSorts = current.sorts.filter((sort) => sort.attributeId !== attribute.id)
      return {
        ...current,
        ...(sortTouched ? { sorts: draftSort ? [{ attributeId: attribute.id, direction: draftSort }, ...otherSorts] : otherSorts } : {}),
        ...(filterTouched ? { filterTree: condition
          ? upsertFilterForAttribute(current.filterTree, condition)
          : removeFiltersForAttribute(current.filterTree, attribute.id) } : {}),
      }
    })
    closeMenu()
  }

  function clearFilterDraft() {
    setDraftCondition(undefined)
    setDraftValue('')
    setDraftValues([])
    setFilterTouched(true)
  }

  function freezeColumn() {
    freezeActions?.onFreeze()
    closeMenu()
  }

  function unfreezeColumns() {
    freezeActions?.onUnfreeze()
    closeMenu()
  }

  function setHeaderColor(token: string | undefined) {
    onConfigChange((current) => ({ ...current, columnStyles: setColumnHeaderColor(current.columnStyles, attribute.id, token) }))
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="max-h-[32rem] w-80 overflow-y-auto p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <PopoverHeader><PopoverTitle>Column actions for {attribute.name}</PopoverTitle></PopoverHeader>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted">Sort</span>
            <Button size="sm" variant={draftSort === 'asc' ? 'default' : 'secondary'} onClick={() => { setDraftSort('asc'); setSortTouched(true) }}>A to Z</Button>
            <Button size="sm" variant={draftSort === 'desc' ? 'default' : 'secondary'} onClick={() => { setDraftSort('desc'); setSortTouched(true) }}>Z to A</Button>
            {(draftSort || activeSort) && <Button size="sm" variant="secondary" onClick={() => { setDraftSort(undefined); setSortTouched(true) }}>Clear sort</Button>}
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
                          setDraftValue('')
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
                {draftCondition.needsValue && (
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
            <Button size="sm" variant="secondary" disabled={!currentFilter && !filterTouched} onClick={clearFilterDraft}>Clear filter</Button>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={closeMenu}>Cancel</Button>
              <Button size="sm" disabled={!canApply} onClick={apply}>Apply</Button>
            </div>
          </div>

          {freezeActions && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <Button size="sm" variant="secondary" className="w-full justify-start" onClick={freezeColumn}>{freezeActions.freezeLabel}</Button>
              <Button size="sm" variant="secondary" className="w-full justify-start" onClick={unfreezeColumns}>{freezeActions.unfreezeLabel}</Button>
              {onToggleWrap && <Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => { onToggleWrap(); closeMenu() }}>{wrap ? 'Clip text' : 'Wrap text'}</Button>}
            </div>
          )}

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-muted">Header colour</p>
            <div className="flex flex-wrap gap-1">
              {PAINT_TOKENS.map((token) => (
                <button key={token} type="button" aria-label={`Header colour ${token}`} aria-pressed={headerColor === token} className="flex size-6 items-center justify-center rounded-md border border-border" style={{ backgroundColor: `var(--${token})` }} onClick={() => setHeaderColor(token)}>
                  {headerColor === token && <Check className="size-3 text-white" />}
                </button>
              ))}
              <button type="button" aria-label="Clear header colour" className="flex size-6 items-center justify-center rounded-md border border-border text-text-muted" onClick={() => setHeaderColor(undefined)}><X className="size-3" /></button>
            </div>
          </div>

          {onConditionalFormat && <Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => { onConditionalFormat(); closeMenu() }}>Conditional formatting…</Button>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
