import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import type { CSSProperties } from 'react'

export type ColumnGroupHeader = {
  name: string
  width: number
  collapsed: boolean
}

type HeaderSegment =
  | { kind: 'group'; group: ColumnGroupHeader }
  | { kind: 'spacer'; width: number }

interface ColumnGroupHeadersProps {
  columns: Array<{ width: number; group?: string; collapsed?: boolean }>
  onCollapsedChange: (group: string, collapsed: boolean) => void
  onReorder: (activeGroup: string, overGroup: string) => void
  reorderDisabled?: boolean
}

function SortableGroupHeader({ group, onCollapsedChange, reorderDisabled = false }: { group: ColumnGroupHeader; onCollapsedChange: ColumnGroupHeadersProps['onCollapsedChange']; reorderDisabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: group.name, disabled: reorderDisabled })
  const style: CSSProperties = { width: group.width, transform: CSS.Transform.toString(transform), transition }
  const action = group.collapsed ? 'Expand' : 'Collapse'

  return (
    <div ref={setNodeRef} style={style} className="flex h-7 shrink-0 items-center border-r border-border bg-muted/60 text-xs text-text-muted">
      <button type="button" aria-label={`Reorder ${group.name} column group`} disabled={reorderDisabled} className="cursor-grab px-1 active:cursor-grabbing disabled:cursor-not-allowed" {...attributes} {...listeners}>
        <GripVertical className="size-3.5" />
      </button>
      <button type="button" aria-label={`${action} ${group.name} column group`} className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left hover:text-foreground" onClick={() => onCollapsedChange(group.name, !group.collapsed)}>
        {group.collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
        <span className="truncate">{group.name}</span>
      </button>
    </div>
  )
}

/** Column groups sit directly above Glide's normal header, while its canvas remains responsible for the fields themselves. */
export function ColumnGroupHeaders({ columns, onCollapsedChange, onReorder, reorderDisabled = false }: ColumnGroupHeadersProps) {
  const segments: HeaderSegment[] = []
  const groups: ColumnGroupHeader[] = []
  for (let index = 0; index < columns.length;) {
    const column = columns[index]
    if (!column.group) {
      segments.push({ kind: 'spacer', width: column.width })
      index += 1
      continue
    }

    let width = column.width
    let end = index + 1
    while (columns[end]?.group === column.group) {
      width += columns[end].width
      end += 1
    }
    const group = { name: column.group, width, collapsed: column.collapsed === true }
    segments.push({ kind: 'group', group })
    groups.push(group)
    index = end
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (groups.length === 0) return null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) onReorder(String(active.id), String(over.id))
      }}
    >
      <SortableContext items={groups.map((group) => group.name)} strategy={horizontalListSortingStrategy}>
        <div aria-label="Column groups" className="flex h-7 shrink-0 overflow-hidden border-b border-border bg-surface">
          {segments.map((segment, index) => segment.kind === 'spacer'
            ? <div key={`spacer-${index}`} style={{ width: segment.width }} className="shrink-0 border-r border-border" />
            : <SortableGroupHeader key={segment.group.name} group={segment.group} onCollapsedChange={onCollapsedChange} reorderDisabled={reorderDisabled} />,
          )}
        </div>
      </SortableContext>
    </DndContext>
  )
}
