import { Funnel, Plus } from 'lucide-react'
import { format } from 'date-fns'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SelectedValuesPicker } from '@/components/ui/selected-values-picker'
import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig, ViewFilterCondition, ViewFilterGroup, ViewFilterNode, ViewFilterOperator } from './viewConfig'

interface GridFilterBuilderProps {
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
}

type FilterKind = 'text' | 'number' | 'date' | 'select' | 'checkbox'

type OperatorOption = { value: ViewFilterOperator; label: string; values?: 0 | 1 | 2 }

const UNFILTERABLE_TYPES = new Set(['multiselect', 'record_reference', 'location', 'ai'])

function filterableAttributes(attributes: AttributeDef[]): AttributeDef[] {
  return attributes.filter((attribute) => attribute.storage !== 'list' && !attribute.isArchived && !attribute.isMulti && !UNFILTERABLE_TYPES.has(attribute.type))
}

function filterKind(attribute: AttributeDef): FilterKind {
  if (attribute.type === 'select' || attribute.type === 'status') return 'select'
  if (attribute.type === 'checkbox') return 'checkbox'
  if (attribute.type === 'number' || attribute.type === 'currency' || attribute.type === 'rating') return 'number'
  if (attribute.type === 'date' || attribute.type === 'timestamp') return 'date'
  return 'text'
}

function operatorOptions(attribute: AttributeDef): OperatorOption[] {
  switch (filterKind(attribute)) {
    case 'number': return [
      { value: 'eq', label: 'is', values: 1 },
      { value: 'gt', label: 'is greater than', values: 1 },
      { value: 'lt', label: 'is less than', values: 1 },
      { value: 'between', label: 'is between', values: 2 },
    ]
    case 'date': return [
      { value: 'eq', label: 'is', values: 1 },
      { value: 'lt', label: 'is before', values: 1 },
      { value: 'gt', label: 'is after', values: 1 },
      { value: 'is_empty', label: 'is empty', values: 0 },
    ]
    case 'select': return [
      { value: 'in', label: 'is any of', values: 1 },
      { value: 'not_in', label: 'is none of', values: 1 },
    ]
    case 'checkbox': return [{ value: 'eq', label: 'is checked', values: 0 }]
    default: return [
      { value: 'eq', label: 'is', values: 1 },
      { value: 'neq', label: 'is not', values: 1 },
      { value: 'contains', label: 'contains', values: 1 },
      { value: 'is_empty', label: 'is empty', values: 0 },
    ]
  }
}

function defaultCondition(attribute: AttributeDef): ViewFilterCondition {
  const option = operatorOptions(attribute)[0]!
  return {
    type: 'condition',
    attributeId: attribute.id,
    operator: option.value,
    ...(filterKind(attribute) === 'checkbox' ? { value: true } : option.values === 2 ? { value: ['', ''] } : option.values ? { value: filterKind(attribute) === 'select' ? [] : '' } : {}),
  }
}

function isActiveCondition(condition: ViewFilterCondition): boolean {
  if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') return true
  if (condition.operator === 'between') return Array.isArray(condition.value) && condition.value.every((value) => value !== '')
  if (condition.operator === 'in' || condition.operator === 'not_in') return Array.isArray(condition.value) && condition.value.length > 0
  return condition.value !== undefined && condition.value !== ''
}

function countConditions(node: ViewFilterNode | undefined): number {
  if (!node) return 0
  return node.type === 'condition' ? Number(isActiveCondition(node)) : node.children.reduce((count, child) => count + countConditions(child), 0)
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function optionValues(attribute: AttributeDef): Array<{ value: string; label: string }> {
  if (!Array.isArray(attribute.optionsJson)) return []
  return attribute.optionsJson.flatMap((option) => (
    typeof option === 'object' && option !== null && typeof (option as { value?: unknown }).value === 'string' && typeof (option as { label?: unknown }).label === 'string' && !(option as { isArchived?: unknown }).isArchived
      ? [{ value: (option as { value: string }).value, label: (option as { label: string }).label }]
      : []
  ))
}

function rootGroup(tree: ViewFilterNode | undefined): ViewFilterGroup {
  if (!tree) return { type: 'group', op: 'and', children: [] }
  return tree.type === 'group' ? tree : { type: 'group', op: 'and', children: [tree] }
}

function ConditionEditor({ attributes, condition, onChange, onRemove }: { attributes: AttributeDef[]; condition: ViewFilterCondition; onChange: (condition: ViewFilterCondition) => void; onRemove: () => void }) {
  const attribute = attributes.find((candidate) => candidate.id === condition.attributeId) ?? attributes[0]
  if (!attribute) return null
  const options = operatorOptions(attribute)
  const operator = options.find((option) => option.value === condition.operator) ?? options[0]!
  const values = Array.isArray(condition.value) ? condition.value.map(String) : [typeof condition.value === 'string' ? condition.value : '']
  const selectValues = Array.isArray(condition.value) ? condition.value.filter((value): value is string => typeof value === 'string') : []

  function changeAttribute(attributeId: string) {
    const nextAttribute = attributes.find((candidate) => candidate.id === attributeId)
    if (nextAttribute) onChange(defaultCondition(nextAttribute))
  }

  function changeOperator(operatorValue: ViewFilterOperator) {
    const nextOperator = options.find((option) => option.value === operatorValue)!
    onChange({
      type: 'condition',
      attributeId: attribute.id,
      operator: operatorValue,
      ...(filterKind(attribute) === 'checkbox' ? { value: true } : nextOperator.values === 2 ? { value: ['', ''] } : nextOperator.values ? { value: filterKind(attribute) === 'select' ? [] : '' } : {}),
    })
  }

  function changeValue(index: number, value: string) {
    const next = operator.values === 2 ? values.map((entry, entryIndex) => entryIndex === index ? value : entry) : value
    onChange({ ...condition, value: next })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
      <Select value={attribute.id} onValueChange={changeAttribute}>
        <SelectTrigger size="sm" aria-label="Field"><SelectValue /></SelectTrigger>
        <SelectContent>{attributes.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={condition.operator} onValueChange={(value) => changeOperator(value as ViewFilterOperator)}>
        <SelectTrigger size="sm" aria-label={`Operator for ${attribute.name}`}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      {filterKind(attribute) === 'select' && operator.values ? (
        <SelectedValuesPicker label={`Select ${attribute.name}`} options={optionValues(attribute)} value={selectValues} onValueChange={(value) => onChange({ ...condition, value })} />
      ) : filterKind(attribute) === 'date' && operator.values ? (
        Array.from({ length: operator.values }, (_, index) => (
          <DatePicker key={index} value={dateValue(values[index])} onChange={(value) => changeValue(index, value ? format(value, 'yyyy-MM-dd') : '')} ariaLabel={`${index === 0 ? 'First' : 'Second'} date for ${attribute.name}`} placeholder={index === 0 && operator.values === 2 ? 'Start date' : index === 1 ? 'End date' : 'Choose date'} className="w-40" />
        ))
      ) : operator.values ? (
        Array.from({ length: operator.values }, (_, index) => <Input key={index} aria-label={`${index === 0 ? 'Value' : 'Second value'} for ${attribute.name}`} className="h-8 w-40" inputMode={filterKind(attribute) === 'number' ? 'decimal' : undefined} value={values[index] ?? ''} onChange={(event) => changeValue(index, event.target.value)} />)
      ) : null}
      <Button type="button" variant="secondary" size="sm" onClick={onRemove}>Remove condition</Button>
    </div>
  )
}

function GroupEditor({ attributes, group, isRoot = false, onChange, onRemove }: { attributes: AttributeDef[]; group: ViewFilterGroup; isRoot?: boolean; onChange: (group: ViewFilterGroup) => void; onRemove?: () => void }) {
  function updateChild(index: number, child: ViewFilterNode) {
    onChange({ ...group, children: group.children.map((current, currentIndex) => currentIndex === index ? child : current) })
  }

  function addCondition() {
    const attribute = attributes[0]
    if (attribute) onChange({ ...group, children: [...group.children, defaultCondition(attribute)] })
  }

  function addGroup() {
    const attribute = attributes[0]
    if (attribute) onChange({ ...group, children: [...group.children, { type: 'group', op: 'and', children: [defaultCondition(attribute)] }] })
  }

  return (
    <div className={isRoot ? 'flex flex-col gap-2' : 'flex flex-col gap-2 rounded-md border border-border bg-bg p-2'}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-muted">Match</span>
        <Button type="button" size="sm" variant={group.op === 'and' ? 'default' : 'secondary'} aria-pressed={group.op === 'and'} onClick={() => onChange({ ...group, op: 'and' })}>AND</Button>
        <Button type="button" size="sm" variant={group.op === 'or' ? 'default' : 'secondary'} aria-pressed={group.op === 'or'} onClick={() => onChange({ ...group, op: 'or' })}>OR</Button>
        {!isRoot && onRemove && <Button type="button" variant="secondary" size="sm" onClick={onRemove}>Remove group</Button>}
      </div>
      {group.children.map((child, index) => child.type === 'condition' ? (
        <ConditionEditor key={index} attributes={attributes} condition={child} onChange={(next) => updateChild(index, next)} onRemove={() => onChange({ ...group, children: group.children.filter((_, childIndex) => childIndex !== index) })} />
      ) : (
        <GroupEditor key={index} attributes={attributes} group={child} onChange={(next) => updateChild(index, next)} onRemove={() => onChange({ ...group, children: group.children.filter((_, childIndex) => childIndex !== index) })} />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={addCondition}><Plus size={16} />Add condition</Button>
        <Button type="button" variant="secondary" size="sm" onClick={addGroup}><Plus size={16} />Add group</Button>
      </div>
    </div>
  )
}

/** Builds the durable filter tree the record-list query already compiles. */
export function GridFilterBuilder({ attributes, config, onConfigChange }: GridFilterBuilderProps) {
  const filterable = filterableAttributes(attributes)
  const activeCount = countConditions(config.filterTree)

  function updateTree(update: (group: ViewFilterGroup) => ViewFilterGroup) {
    onConfigChange((current) => {
      const next = update(rootGroup(current.filterTree))
      return { ...current, ...(next.children.length ? { filterTree: next } : { filterTree: undefined }) }
    })
  }

  if (filterable.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <Funnel size={16} />
          Filter
          {activeCount > 0 && <Badge variant="outline" aria-hidden="true">{activeCount}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[32rem] w-[44rem] overflow-y-auto p-3">
        <PopoverHeader><PopoverTitle>Filter records</PopoverTitle></PopoverHeader>
        <div className="mt-3 flex flex-col gap-3">
          <GroupEditor attributes={filterable} group={rootGroup(config.filterTree)} isRoot onChange={(next) => updateTree(() => next)} />
          {activeCount > 0 && <div className="border-t border-border pt-3"><Button type="button" variant="secondary" size="sm" onClick={() => onConfigChange((current) => ({ ...current, filterTree: undefined }))}>Clear filters</Button></div>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
