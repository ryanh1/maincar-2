import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig, ViewFilterCondition } from './viewConfig'

export interface GridFilterValue {
  value: string
  label: string
}

export interface GridMenuAnchor {
  x: number
  y: number
  width: number
  height: number
}

export type FilterKind = 'text' | 'number' | 'date' | 'boolean'

export type ConditionChoice = {
  label: string
  operator: ViewFilterCondition['operator']
  fixedValue?: boolean
  needsValue?: boolean
}

const EMPTY_CONDITIONS: ConditionChoice[] = [
  { label: 'Is empty', operator: 'is_empty' },
  { label: 'Is not empty', operator: 'is_not_empty' },
]

export const CONDITION_GROUPS: Record<FilterKind, Array<{ label: string; choices: ConditionChoice[] }>> = {
  text: [
    { label: 'Text', choices: [
      { label: 'Text is', operator: 'eq', needsValue: true },
      { label: 'Text is not', operator: 'neq', needsValue: true },
      { label: 'Text contains', operator: 'contains', needsValue: true },
      { label: 'Text does not contain', operator: 'not_contains', needsValue: true },
      { label: 'Text starts with', operator: 'starts_with', needsValue: true },
      { label: 'Text ends with', operator: 'ends_with', needsValue: true },
    ] },
    { label: 'Empty', choices: EMPTY_CONDITIONS },
  ],
  number: [
    { label: 'Number', choices: [
      { label: 'Number is', operator: 'eq', needsValue: true },
      { label: 'Number is not', operator: 'neq', needsValue: true },
      { label: 'Number is greater than', operator: 'gt', needsValue: true },
      { label: 'Number is at least', operator: 'gte', needsValue: true },
      { label: 'Number is less than', operator: 'lt', needsValue: true },
      { label: 'Number is at most', operator: 'lte', needsValue: true },
    ] },
    { label: 'Empty', choices: EMPTY_CONDITIONS },
  ],
  date: [
    { label: 'Date', choices: [
      { label: 'Date is', operator: 'eq', needsValue: true },
      { label: 'Date is not', operator: 'neq', needsValue: true },
      { label: 'Date is after', operator: 'gt', needsValue: true },
      { label: 'Date is on or after', operator: 'gte', needsValue: true },
      { label: 'Date is before', operator: 'lt', needsValue: true },
      { label: 'Date is on or before', operator: 'lte', needsValue: true },
    ] },
    { label: 'Empty', choices: EMPTY_CONDITIONS },
  ],
  boolean: [
    { label: 'Checkbox', choices: [
      { label: 'Is checked', operator: 'eq', fixedValue: true },
      { label: 'Is unchecked', operator: 'eq', fixedValue: false },
    ] },
    { label: 'Empty', choices: EMPTY_CONDITIONS },
  ],
}

export function filterKind(attribute: AttributeDef): FilterKind {
  if (attribute.type === 'number' || attribute.type === 'currency' || attribute.type === 'rating') return 'number'
  if (attribute.type === 'date' || attribute.type === 'timestamp') return 'date'
  if (attribute.type === 'checkbox') return 'boolean'
  return 'text'
}

export function filterForAttribute(config: ViewConfig, attributeId: string): ViewFilterCondition | undefined {
  const filter = config.filterTree
  return filter?.type === 'condition' && filter.attributeId === attributeId ? filter : undefined
}

export function conditionChoice(attribute: AttributeDef, operator: ViewFilterCondition['operator'] | undefined): ConditionChoice | undefined {
  return CONDITION_GROUPS[filterKind(attribute)].flatMap((group) => group.choices).find((choice) => choice.operator === operator)
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}
