import { closestCorners, DndContext, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { AttributeDef, RecordRow } from '@/lib/crmTypes'

import { KanbanCard } from './KanbanCard'
import type { ViewConfig } from './viewConfig'

type KanbanColumn = { key: string; label: string; color?: string; rows: RecordRow[] }

interface KanbanBoardProps {
  attributes: AttributeDef[]
  config: ViewConfig
  rows: RecordRow[]
  /** Writes a cross-column drop through the grid's existing optimistic update path. */
  onRecordMove?: (record: RecordRow, value: string | null) => void
  /** Uses the grid's selection when the board is rendered inside RecordGrid. */
  selectedRecordIds?: ReadonlySet<string>
  /** Keeps Kanban selection changes in the grid's existing selection model. */
  onToggleRecordSelection?: (recordId: string, extendRange?: boolean) => void
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
function buildKanbanColumns(groupAttribute: AttributeDef, rows: RecordRow[], visibleOptionValues: string[], hiddenOptionValues: string[]): KanbanColumn[] {
  const options = selectOptions(groupAttribute)
  const visible = new Set(visibleOptionValues)
  const hidden = new Set(hiddenOptionValues)
  const columns = options
    .filter((option) => visible.has(option.value) && !hidden.has(option.value))
    .map((option) => ({ key: option.value, label: option.label, color: option.color, rows: [] as RecordRow[] }))
  const columnsByValue = new Map(columns.map((column) => [column.key, column]))
  const validOptionValues = new Set(options.map((option) => option.value))
  const noValue: KanbanColumn = { key: '__no-value__', label: 'No value', rows: [] }

  for (const row of rows) {
    const value = row[groupAttribute.slug]
    const column = typeof value === 'string' ? columnsByValue.get(value) : undefined
    if (column) column.rows.push(row)
    else if (typeof value !== 'string' || !validOptionValues.has(value)) noValue.rows.push(row)
  }
  return [...columns, noValue]
}

function dragData(value: unknown): KanbanDragData | null {
  if (!value || typeof value !== 'object' || !('type' in value) || !('columnKey' in value)) return null
  const candidate = value as { type?: unknown; recordId?: unknown; columnKey?: unknown }
  if (candidate.type === 'column' && typeof candidate.columnKey === 'string') return { type: 'column', columnKey: candidate.columnKey }
  if (candidate.type === 'card' && typeof candidate.recordId === 'string' && typeof candidate.columnKey === 'string') return { type: 'card', recordId: candidate.recordId, columnKey: candidate.columnKey }
  return null
}

type MovePickerState = { recordId: string; query: string; activeIndex: number }
type PendingMove = { records: RecordRow[]; targetValue: string | null; targetLabel: string }

function SortableKanbanCard({
  record,
  columnKey,
  titleAttribute,
  fields,
  selected,
  onToggleSelection,
  onKeyDown,
  onCardRef,
  movePicker,
  options,
  onQueryChange,
  onActiveIndexChange,
  onChooseOption,
  onCancel,
}: {
  record: RecordRow
  columnKey: string
  titleAttribute: AttributeDef
  fields: AttributeDef[]
  selected: boolean
  onToggleSelection: (event: ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onCardRef: (element: HTMLDivElement | null) => void
  movePicker: MovePickerState | null
  options: Array<{ value: string; label: string }>
  onQueryChange: (query: string) => void
  onActiveIndexChange: (index: number) => void
  onChooseOption: (option: { value: string; label: string }) => void
  onCancel: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cardDndId(record.id), data: { type: 'card', recordId: record.id, columnKey } satisfies KanbanDragData })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  const setRefs = (element: HTMLDivElement | null) => {
    setNodeRef(element)
    onCardRef(element)
  }

  return (
    <div ref={setRefs} style={style} className="relative" {...attributes} {...listeners} onKeyDown={onKeyDown}>
      <div className="absolute right-2 top-2 z-10 rounded bg-bg/80 p-0.5">
        <input
          type="checkbox"
          aria-label={`Select ${record[titleAttribute.slug] || 'Untitled record'}`}
          checked={selected}
          onChange={onToggleSelection}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      <KanbanCard record={record} titleAttribute={titleAttribute} fields={fields} />
      {movePicker && (
        <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md" role="listbox" aria-label={`Move ${record[titleAttribute.slug] || 'Untitled record'}`}>
          <input
            autoFocus
            value={movePicker.query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                onActiveIndexChange(Math.min(movePicker.activeIndex + 1, options.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                onActiveIndexChange(Math.max(movePicker.activeIndex - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const option = options[movePicker.activeIndex]
                if (option) onChooseOption(option)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onCancel()
              }
            }}
            placeholder="Move to stage…"
            aria-label="Move to stage"
            className="h-8 w-full rounded border border-border bg-bg px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-1 max-h-40 overflow-y-auto" role="presentation">
            {options.length === 0
              ? <p className="px-2 py-2 text-xs text-text-muted">No matching stages.</p>
              : options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={index === movePicker.activeIndex}
                  className={`flex h-8 w-full items-center rounded px-2 text-left text-sm ${index === movePicker.activeIndex ? 'bg-accent text-accent-foreground' : ''}`}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  onClick={() => onChooseOption(option)}
                >
                  {option.label}
                </button>
              ))}
          </div>
          <p className="px-2 pb-1 pt-1 text-[11px] text-text-muted">Enter to move · Esc to cancel</p>
        </div>
      )}
    </div>
  )
}

function KanbanColumnView({
  column,
  titleAttribute,
  fields,
  orderedRows,
  selectedRecordIds,
  onToggleSelection,
  onCardKeyDown,
  onCardRef,
  movePicker,
  moveOptions,
  onQueryChange,
  onActiveIndexChange,
  onChooseOption,
  onCancel,
}: {
  column: KanbanColumn
  titleAttribute: AttributeDef
  fields: AttributeDef[]
  orderedRows: RecordRow[]
  selectedRecordIds: ReadonlySet<string>
  onToggleSelection: (recordId: string, event: ChangeEvent<HTMLInputElement>) => void
  onCardKeyDown: (record: RecordRow, event: ReactKeyboardEvent<HTMLDivElement>) => void
  onCardRef: (recordId: string, element: HTMLDivElement | null) => void
  movePicker: MovePickerState | null
  moveOptions: Map<string, Array<{ value: string; label: string }>>
  onQueryChange: (query: string) => void
  onActiveIndexChange: (index: number) => void
  onChooseOption: (option: { value: string; label: string }) => void
  onCancel: () => void
}) {
  const { setNodeRef } = useDroppable({ id: columnDndId(column.key), data: { type: 'column', columnKey: column.key } satisfies KanbanDragData })
  return (
    <section className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-surface-2">
      <header className="border-b border-border px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          {column.color?.startsWith('option-') && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: `var(--${column.color})` }} />}
          {column.label} <span className="tabular-nums text-text-muted">{column.rows.length} records</span>
        </h2>
      </header>
      <SortableContext items={orderedRows.map((row) => cardDndId(row.id))} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} aria-label={`${column.label} cards`} className="flex min-h-20 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {orderedRows.map((row) => (
            <SortableKanbanCard
              key={row.id}
              record={row}
              columnKey={column.key}
              titleAttribute={titleAttribute}
              fields={fields}
              selected={selectedRecordIds.has(row.id)}
              onToggleSelection={(event) => onToggleSelection(row.id, event)}
              onKeyDown={(event) => onCardKeyDown(row, event)}
              onCardRef={(element) => onCardRef(row.id, element)}
              movePicker={movePicker?.recordId === row.id ? movePicker : null}
              options={moveOptions.get(row.id) ?? []}
              onQueryChange={onQueryChange}
              onActiveIndexChange={onActiveIndexChange}
              onChooseOption={onChooseOption}
              onCancel={onCancel}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  )
}

/** A saved-view Kanban board. Cards can be reordered, while column drops update the grouping field. */
export function KanbanBoard({ attributes, config, rows, onRecordMove, selectedRecordIds, onToggleRecordSelection }: KanbanBoardProps) {
  const groupAttribute = attributes.find((attribute) => attribute.id === config.kanban?.groupAttributeId && (attribute.type === 'select' || attribute.type === 'status'))
  const titleAttribute = attributes.find((attribute) => attribute.isIdentity) ?? attributes[0]
  const configuredFieldIds = config.kanban?.cardAttributeIds
  const cardFields = (configuredFieldIds ? attributes.filter((attribute) => configuredFieldIds.includes(attribute.id)) : attributes.filter((attribute) => attribute.id !== titleAttribute?.id && attribute.id !== groupAttribute?.id && config.columns.find((column) => column.attributeId === attribute.id)?.visible !== false).slice(0, 3)).filter((attribute) => attribute.id !== titleAttribute?.id)
  const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({})
  const [localSelectedRecordIds, setLocalSelectedRecordIds] = useState<Set<string>>(new Set())
  const [movePicker, setMovePicker] = useState<MovePickerState | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const selectedIds = selectedRecordIds ?? localSelectedRecordIds

  const stageOptions = useMemo(() => {
    if (!groupAttribute) return []
    const visible = new Set(config.kanban?.visibleOptionValues ?? [])
    const hidden = new Set(config.kanban?.hiddenTerminalOptionValues ?? [])
    return [
      ...selectOptions(groupAttribute)
        .filter((option) => visible.has(option.value) && !hidden.has(option.value))
        .map(({ value, label }) => ({ value, label })),
      { value: '__no-value__', label: 'No value' },
    ]
  }, [config.kanban?.hiddenTerminalOptionValues, config.kanban?.visibleOptionValues, groupAttribute])

  const filteredMoveOptions = useMemo(() => {
    if (!movePicker) return []
    const query = movePicker.query.trim().toLocaleLowerCase()
    return stageOptions.filter((option) => !query || option.label.toLocaleLowerCase().includes(query) || option.value.toLocaleLowerCase().includes(query))
  }, [movePicker, stageOptions])

  const renderMovePicker = useMemo(() => {
    if (!movePicker || filteredMoveOptions.length === 0 || movePicker.activeIndex < filteredMoveOptions.length) return movePicker
    return { ...movePicker, activeIndex: filteredMoveOptions.length - 1 }
  }, [filteredMoveOptions.length, movePicker])

  const closeMovePicker = useCallback((recordId = movePicker?.recordId) => {
    setMovePicker(null)
    if (recordId) window.requestAnimationFrame(() => cardRefs.current.get(recordId)?.focus())
  }, [movePicker?.recordId])

  const toggleSelection = useCallback((recordId: string, event: ChangeEvent<HTMLInputElement>) => {
    const extendRange = event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey
    if (onToggleRecordSelection) {
      onToggleRecordSelection(recordId, extendRange)
      return
    }
    setLocalSelectedRecordIds((current) => {
      const next = new Set(current)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }, [onToggleRecordSelection])

  const openMovePicker = useCallback((record: RecordRow, initialQuery: string) => {
    if (!onRecordMove) return
    setMovePicker({ recordId: record.id, query: initialQuery, activeIndex: 0 })
  }, [onRecordMove])

  const onCardKeyDown = useCallback((record: RecordRow, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.target instanceof HTMLInputElement) return
    if (event.key.length !== 1 || !onRecordMove) return
    event.preventDefault()
    event.stopPropagation()
    openMovePicker(record, event.key)
  }, [onRecordMove, openMovePicker])

  const chooseMoveOption = useCallback((option: { value: string; label: string }) => {
    if (!movePicker || !groupAttribute || !onRecordMove) return
    const focusedRecord = rows.find((record) => record.id === movePicker.recordId)
    if (!focusedRecord) return
    const selectedRecordIdsForMove = selectedIds.has(focusedRecord.id) ? [...selectedIds] : [focusedRecord.id]
    const records = rows.filter((record) => selectedRecordIdsForMove.includes(record.id))
    const targetValue = option.value === '__no-value__' ? null : option.value
    const recordsToMove = records.filter((record) => !Object.is(record[groupAttribute.slug], targetValue))
    closeMovePicker(focusedRecord.id)
    if (recordsToMove.length === 0) return
    if (recordsToMove.length > 1) {
      setPendingMove({ records: recordsToMove, targetValue, targetLabel: option.label })
      return
    }
    onRecordMove(recordsToMove[0], targetValue)
  }, [closeMovePicker, groupAttribute, movePicker, onRecordMove, rows, selectedIds])

  const confirmPendingMove = useCallback(() => {
    if (!pendingMove || !onRecordMove) return
    for (const record of pendingMove.records) onRecordMove(record, pendingMove.targetValue)
    setPendingMove(null)
  }, [onRecordMove, pendingMove])

  if (!groupAttribute || !titleAttribute) return <div className="flex h-full items-center justify-center text-sm text-text-muted">Choose a select or status field to group this board.</div>

  const columns = buildKanbanColumns(groupAttribute, rows, config.kanban?.visibleOptionValues ?? [], config.kanban?.hiddenTerminalOptionValues ?? [])
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
    <>
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
          {columns.map((column) => (
            <KanbanColumnView
              key={column.key}
              column={column}
              titleAttribute={titleAttribute}
              fields={cardFields}
              orderedRows={rowsForColumn(column)}
              selectedRecordIds={selectedIds}
              onToggleSelection={toggleSelection}
              onCardKeyDown={onCardKeyDown}
              onCardRef={(recordId, element) => {
                if (element) cardRefs.current.set(recordId, element)
                else cardRefs.current.delete(recordId)
              }}
              movePicker={renderMovePicker}
              moveOptions={new Map(renderMovePicker ? [[renderMovePicker.recordId, filteredMoveOptions]] : [])}
              onQueryChange={(query) => setMovePicker((current) => current ? { ...current, query, activeIndex: 0 } : current)}
              onActiveIndexChange={(activeIndex) => setMovePicker((current) => current ? { ...current, activeIndex } : current)}
              onChooseOption={chooseMoveOption}
              onCancel={() => closeMovePicker()}
            />
          ))}
        </div></div>
      </DndContext>
      <AlertDialog open={pendingMove !== null} onOpenChange={(open) => { if (!open) setPendingMove(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {pendingMove?.records.length ?? 0} cards?</AlertDialogTitle>
            <AlertDialogDescription>
              Move {pendingMove?.records.length ?? 0} selected cards by <strong>{groupAttribute.name}</strong> to <strong>{pendingMove?.targetLabel}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingMove}>Move cards</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
