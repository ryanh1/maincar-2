import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig, ViewFilterCondition, ViewFilterNode, ViewFilterOperator } from './viewConfig'

interface AppliedGridConstraintsProps {
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
}

type AppliedFilter = {
  condition: ViewFilterCondition
  path: number[]
}

const OPERATOR_LABELS: Record<ViewFilterOperator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  in: 'is any of',
  between: 'is between',
  not_in: 'is none of',
}

function appliedFilters(node: ViewFilterNode | undefined, path: number[] = []): AppliedFilter[] {
  if (!node) return []
  if (node.type === 'condition') return [{ condition: node, path }]
  return node.children.flatMap((child, index) => appliedFilters(child, [...path, index]))
}

function removeFilterAtPath(node: ViewFilterNode | undefined, path: number[]): ViewFilterNode | undefined {
  if (!node || path.length === 0) return undefined
  if (node.type === 'condition') return node
  const [targetIndex, ...rest] = path
  const children = node.children.flatMap((child, index) => {
    if (index !== targetIndex) return [child]
    const next = removeFilterAtPath(child, rest)
    return next ? [next] : []
  })
  if (children.length === 0) return undefined
  if (children.length === 1) return children[0]
  return { ...node, children }
}

function optionLabel(attribute: AttributeDef, value: string): string {
  if (!Array.isArray(attribute.optionsJson)) return value
  const option = attribute.optionsJson.find((candidate) => (
    typeof candidate === 'object' && candidate !== null && (candidate as { value?: unknown }).value === value
  )) as { label?: unknown } | undefined
  return typeof option?.label === 'string' ? option.label : value
}

function filterLabel(attribute: AttributeDef, condition: ViewFilterCondition): string {
  const operator = OPERATOR_LABELS[condition.operator]
  if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') return `${attribute.name} ${operator}`
  const values = Array.isArray(condition.value) ? condition.value : [condition.value]
  const valueLabel = values
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => typeof value === 'boolean' ? (value ? 'checked' : 'unchecked') : optionLabel(attribute, String(value)))
    .join(', ')
  return valueLabel ? `${attribute.name} ${operator} ${valueLabel}` : `${attribute.name} ${operator}`
}

/** Compact, reversible representation of the constraints currently applied to the grid. */
export function AppliedGridConstraints({ attributes, config, onConfigChange }: AppliedGridConstraintsProps) {
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const filters = appliedFilters(config.filterTree)
  const sorts = config.sorts.flatMap((sort, index) => {
    const attribute = attributesById.get(sort.attributeId)
    return attribute ? [{ attribute, index, sort }] : []
  })
  if (filters.length === 0 && sorts.length === 0) return null

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1" aria-label="Applied grid constraints">
      {sorts.map(({ attribute, index, sort }) => (
        <Button
          key={`sort-${attribute.id}`}
          type="button"
          size="sm"
          variant="secondary"
          className="rounded-full px-2"
          aria-label={`Remove the ${attribute.name} sort`}
          onClick={() => onConfigChange((current) => ({ ...current, sorts: current.sorts.filter((_, currentIndex) => currentIndex !== index) }))}
        >
          {attribute.name}: {sort.direction === 'asc' ? 'A → Z' : 'Z → A'}
          <X size={14} />
        </Button>
      ))}
      {filters.map(({ condition, path }) => {
        const attribute = attributesById.get(condition.attributeId)
        if (!attribute) return null
        return (
          <Button
            key={`filter-${path.join('.')}`}
            type="button"
            size="sm"
            variant="secondary"
            className="max-w-80 rounded-full px-2"
            aria-label={`Remove the ${attribute.name} filter`}
            onClick={() => onConfigChange((current) => ({ ...current, filterTree: removeFilterAtPath(current.filterTree, path) }))}
          >
            <span className="truncate">{filterLabel(attribute, condition)}</span>
            <X size={14} />
          </Button>
        )
      })}
      <Button type="button" size="sm" variant="ghost" aria-label="Clear all constraints" onClick={() => onConfigChange((current) => ({ ...current, sorts: [], filterTree: undefined }))}>
        Clear all
      </Button>
    </div>
  )
}
