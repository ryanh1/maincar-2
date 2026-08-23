import { closestCorners, DndContext, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type CSSProperties } from 'react'

import type { AttributeDef, RecordRow } from '@/lib/crmTypes'

import { KanbanCard } from './KanbanCard'
import { formatCellValue } from './recordCellValue'
import type { ViewConfig } from './viewConfig'

type KanbanColumn = { key: string; label: string; color?: string; rows: RecordRow[] }

interface KanbanBoardProps {
  attributes: AttributeDef[]
  config: ViewConfig
  rows: RecordRow[]
  /** Writes a cross-column drop through the grid's existing optimistic update path. */
  onRecordMove?: (record: RecordRow, value: string | null) => void
}

type KanbanDragData = { type: 'card'; recordId: string; columnKey: string } | { type: 'column'; columnKey: string }

function cardDndId(recordId: string) { return `card:${recordId}` }
function columnDndId(columnKey: string) { return `column:${columnKey}` }

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
  const values = rows.map((row) => row[attribute.slug]).map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN).filter((value) => Number.isFinite(value))
  if (values.length === 0) return null
  return `Total ${formatCellValue(values.reduce((sum, value) => sum + value, 0), attribute.type, null)}`
}

function dragData(value: unknown): KanbanDragData | null {
  if (!value || typeof value !== 'object' || !('type' in value) || !('columnKey' in value)) return null
  const candidate = value as { type?: unknown; recordId?: unknown; columnKey?: unknown }
  if (candidate.type === 'column' && typeof candidate.columnKey === 'string') return { type: 'column', columnKey: candidate.columnKey }
  if (candidate.type === 'card' && typeof candidate.recordId === 'string' && typeof candidate.columnKey === 'string') return { type: 'card', recordId: candidate.recordId, columnKey: candidate.columnKey }
  return null
}

function SortableKanbanCard({ record, columnKey, titleAttribute, fields }: { record: RecordRow; columnKey: string; titleAttribute: AttributeDef; fields: AttributeDef[] }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cardDndId(record.id), data: { type: 'card', recordId: record.id, columnKey } satisfies KanbanDragData })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}><KanbanCard record={record} titleAttribute={titleAttribute} fields={fields} /></div>
}

function KanbanColumnView({ column, titleAttribute, fields, orderedRows, summary }: { column: KanbanColumn; titleAttribute: AttributeDef; fields: AttributeDef[]; orderedRows: RecordRow[]; summary: string | null }) {
  const { setNodeRef } = useDroppable({ id: columnDndId(column.key), data: { type: 'column', columnKey: column.key } satisfies KanbanDragData })
  return (
    <section className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-surface-2">
      <header className="border-b border-border px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          {column.color?.startsWith('option-') && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `var(--${column.color})` }} />}
          {column.label} <span className="tabular-nums text-text-muted">{column.rows.length}</span>
        </h2>
        {summary && <p className="mt-1 text-xs tabular-nums text-text-muted">{summary}</p>}
      </header>
      <SortableContext items={orderedRows.map((row) => cardDndId(row.id))} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} aria-label={`${column.label} cards`} className="flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {orderedRows.map((row) => <SortableKanbanCard key={row.id} record={row} columnKey={column.key} titleAttribute={titleAttribute} fields={fields} />)}
        </div>
      </SortableContext>
    </section>
  )
}

/** A saved-view Kanban board. Cards can be reordered, while column drops update the grouping field. */
export function KanbanBoard({ attributes, config, rows, onRecordMove }: KanbanBoardProps) {
  const groupAttribute = attributes.find((attribute) => attribute.id === config.groupBy[0]?.attributeId && (attribute.type === 'select' || attribute.type === 'status'))
  const titleAttribute = attributes.find((attribute) => attribute.isIdentity) ?? attributes[0]
  const configuredFieldIds = config.kanbanCardFieldIds
  const cardFields = (configuredFieldIds ? attributes.filter((attribute) => configuredFieldIds.includes(attribute.id)) : attributes.filter((attribute) => attribute.id !== titleAttribute?.id && attribute.id !== groupAttribute?.id && config.columns.find((column) => column.attributeId === attribute.id)?.visible !== false).slice(0, 3)).filter((attribute) => attribute.id !== titleAttribute?.id)
  const summaryAttribute = attributes.find((attribute) => attribute.id === config.kanbanSummaryAttributeId && (attribute.type === 'number' || attribute.type === 'currency'))
  const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({})
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  if (!groupAttribute || !titleAttribute) return <div className="flex h-full items-center justify-center text-sm text-text-muted">Choose a select or status field to group this board.</div>

  const columns = buildKanbanColumns(groupAttribute, rows)
  const rowsForColumn = (column: KanbanColumn, ordering = manualOrder): RecordRow[] => {
    const positions = new Map((ordering[column.key] ?? []).map((recordId, index) => [recordId, index]))
    return column.rows.slice().sort((left, right) => (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  }
  const reorder = (sourceColumnKey: string, targetColumnKey: string, recordId: string, overRecordId: string | null) => {
    setManualOrder((previous) => {
      const sourceColumn = columns.find((column) => column.key === sourceColumnKey)
      const targetColumn = columns.find((column) => column.key === targetColumnKey)
      if (!sourceColumn || !targetColumn) return previous
      const sourceIds = rowsForColumn(sourceColumn, previous).map((row) => row.id)
      const targetIds = sourceColumnKey === targetColumnKey ? sourceIds : rowsForColumn(targetColumn, previous).map((row) => row.id)
      const sourceIndex = sourceIds.indexOf(recordId)
      if (sourceIndex < 0) return previous
      if (sourceColumnKey === targetColumnKey) {
        const targetIndex = overRecordId ? sourceIds.indexOf(overRecordId) : sourceIds.length - 1
        return targetIndex < 0 ? previous : { ...previous, [sourceColumnKey]: arrayMove(sourceIds, sourceIndex, targetIndex) }
      }
      sourceIds.splice(sourceIndex, 1)
      const nextTargetIds = targetIds.filter((id) => id !== recordId)
      const targetIndex = overRecordId ? nextTargetIds.indexOf(overRecordId) : nextTargetIds.length
      nextTargetIds.splice(targetIndex < 0 ? nextTargetIds.length : targetIndex, 0, recordId)
      return { ...previous, [sourceColumnKey]: sourceIds, [targetColumnKey]: nextTargetIds }
    })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={({ active, over }) => {
      const activeData = dragData(active.data.current)
      const overData = dragData(over?.data.current)
      if (!activeData || activeData.type !== 'card' || !overData) return
      const targetColumnKey = overData.columnKey
      if (activeData.columnKey !== targetColumnKey && !onRecordMove) return
      reorder(activeData.columnKey, targetColumnKey, activeData.recordId, overData.type === 'card' ? overData.recordId : null)
      if (activeData.columnKey !== targetColumnKey) {
        const record = rows.find((candidate) => candidate.id === activeData.recordId)
        if (record) onRecordMove?.(record, targetColumnKey === '__no-value__' ? null : targetColumnKey)
      }
    }}>
      <div className="min-h-0 flex-1 overflow-x-auto bg-surface p-3"><div className="flex min-h-full min-w-max gap-3">
        {columns.map((column) => <KanbanColumnView key={column.key} column={column} titleAttribute={titleAttribute} fields={cardFields} orderedRows={rowsForColumn(column)} summary={totalLabel(column.rows, summaryAttribute)} />)}
      </div></div>
    </DndContext>
  )
}
