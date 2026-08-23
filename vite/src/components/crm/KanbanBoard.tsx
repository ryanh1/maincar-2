import type { AttributeDef, RecordRow } from '@/lib/crmTypes'

import { KanbanCard } from './KanbanCard'
import { formatCellValue } from './recordCellValue'
import type { ViewConfig } from './viewConfig'

type KanbanColumn = {
  key: string
  label: string
  color?: string
  rows: RecordRow[]
}

interface KanbanBoardProps {
  attributes: AttributeDef[]
  config: ViewConfig
  rows: RecordRow[]
}

function selectOptions(attribute: AttributeDef): Array<{ value: string; label: string; color?: string; order: number }> {
  if (!Array.isArray(attribute.optionsJson)) return []
  return attribute.optionsJson
    .reduce<Array<{ value: string; label: string; color?: string; order: number }>>((options, option, index) => {
      if (!option || typeof option !== 'object') return options
      const value = option as { value?: unknown; label?: unknown; color?: unknown; order?: unknown; isArchived?: unknown }
      if (typeof value.value === 'string' && typeof value.label === 'string' && !value.isArchived) {
        options.push({ value: value.value, label: value.label, ...(typeof value.color === 'string' ? { color: value.color } : {}), order: typeof value.order === 'number' ? value.order : index })
      }
      return options
    }, [])
    .sort((left, right) => left.order - right.order)
}

/** Builds Kanban columns from the field's configured option ordering, including blank values. */
function buildKanbanColumns(groupAttribute: AttributeDef, rows: RecordRow[]): KanbanColumn[] {
  const options = selectOptions(groupAttribute)
  const columns = options.map((option) => ({ key: option.value, label: option.label, color: option.color, rows: [] as RecordRow[] }))
  const columnsByValue = new Map(columns.map((column) => [column.key, column]))
  const noValue: KanbanColumn = { key: '__no-value__', label: 'No value', rows: [] }

  for (const row of rows) {
    const value = row[groupAttribute.slug]
    const column = typeof value === 'string' ? columnsByValue.get(value) : undefined
    if (column) column.rows.push(row)
    else noValue.rows.push(row)
  }

  return [...columns, noValue]
}

function totalLabel(rows: RecordRow[], attribute: AttributeDef | undefined): string | null {
  if (!attribute) return null
  const values = rows
    .map((row) => row[attribute.slug])
    .map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN)
    .filter((value) => Number.isFinite(value))
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return `Total ${formatCellValue(total, attribute.type, null)}`
}

/** A saved-view Kanban board. Cards stay intentionally compact so a busy pipeline remains scannable. */
export function KanbanBoard({ attributes, config, rows }: KanbanBoardProps) {
  const groupAttribute = attributes.find((attribute) => attribute.id === config.groupBy[0]?.attributeId && (attribute.type === 'select' || attribute.type === 'status'))
  const titleAttribute = attributes.find((attribute) => attribute.isIdentity) ?? attributes[0]
  const configuredFieldIds = config.kanbanCardFieldIds
  const cardFields = (configuredFieldIds
    ? attributes.filter((attribute) => configuredFieldIds.includes(attribute.id))
    : attributes.filter((attribute) => attribute.id !== titleAttribute?.id && attribute.id !== groupAttribute?.id && config.columns.find((column) => column.attributeId === attribute.id)?.visible !== false).slice(0, 3))
    .filter((attribute) => attribute.id !== titleAttribute?.id)
  const summaryAttribute = attributes.find((attribute) => attribute.id === config.kanbanSummaryAttributeId && (attribute.type === 'number' || attribute.type === 'currency'))

  if (!groupAttribute || !titleAttribute) {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">Choose a select or status field to group this board.</div>
  }

  const columns = buildKanbanColumns(groupAttribute, rows)
  return (
    <div className="min-h-0 flex-1 overflow-x-auto bg-surface p-3">
      <div className="flex min-h-full min-w-max gap-3">
        {columns.map((column) => (
          <section key={column.key} className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-surface-2">
            <header className="border-b border-border px-3 py-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
                {column.color?.startsWith('option-') && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `var(--${column.color})` }} />}
                {column.label} <span className="tabular-nums text-text-muted">{column.rows.length}</span>
              </h2>
              {totalLabel(column.rows, summaryAttribute) && <p className="mt-1 text-xs tabular-nums text-text-muted">{totalLabel(column.rows, summaryAttribute)}</p>}
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {column.rows.map((row) => <KanbanCard key={row.id} record={row} titleAttribute={titleAttribute} fields={cardFields} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
