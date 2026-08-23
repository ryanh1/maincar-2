import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig, ViewSort } from './viewConfig'

interface GridSortPopoverProps {
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
}

interface SortRowProps {
  attribute: AttributeDef
  index: number
  sort: ViewSort
  onDirectionChange: (index: number, direction: ViewSort['direction']) => void
  onRemove: (index: number) => void
}

function SortRow({ attribute, index, sort, onDirectionChange, onRemove }: SortRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: sort.attributeId })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  const nextDirection = sort.direction === 'asc' ? 'desc' : 'asc'

  return (
    <div ref={setNodeRef} style={style} className="flex h-8 items-center gap-1 border-b border-border last:border-b-0">
      <button
        type="button"
        aria-label={`Reorder sort by ${attribute.name}`}
        className="cursor-grab px-1 text-text-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm">{attribute.name}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={`Sort ${attribute.name} ${nextDirection === 'asc' ? 'ascending' : 'descending'}`}
        onClick={() => onDirectionChange(index, nextDirection)}
      >
        {sort.direction === 'asc' ? 'A → Z' : 'Z → A'}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => onRemove(index)}>Remove</Button>
    </div>
  )
}

/** Ordered view sorting: each row is one server-side ORDER BY priority. */
export function GridSortPopover({ attributes, config, onConfigChange }: GridSortPopoverProps) {
  const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]))
  const activeSorts = config.sorts.filter((sort) => attributesById.has(sort.attributeId))
  const availableAttributes = attributes.filter((attribute) => !activeSorts.some((sort) => sort.attributeId === attribute.id))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function updateSort(index: number, direction: ViewSort['direction']) {
    onConfigChange((current) => ({
      ...current,
      sorts: current.sorts.map((sort, currentIndex) => currentIndex === index ? { ...sort, direction } : sort),
    }))
  }

  function removeSort(index: number) {
    onConfigChange((current) => ({ ...current, sorts: current.sorts.filter((_, currentIndex) => currentIndex !== index) }))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          Sort{activeSorts.length ? ` · ${activeSorts.length}` : ''}
          <ChevronDown size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <PopoverHeader><PopoverTitle>Sort records</PopoverTitle></PopoverHeader>
        {activeSorts.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return
              onConfigChange((current) => {
                const from = current.sorts.findIndex((sort) => sort.attributeId === active.id)
                const to = current.sorts.findIndex((sort) => sort.attributeId === over.id)
                return from < 0 || to < 0 ? current : { ...current, sorts: arrayMove(current.sorts, from, to) }
              })
            }}
          >
            <SortableContext items={activeSorts.map((sort) => sort.attributeId)} strategy={verticalListSortingStrategy}>
              <div className="mt-3 border border-border">
                {activeSorts.map((sort, index) => (
                  <SortRow
                    key={sort.attributeId}
                    attribute={attributesById.get(sort.attributeId)!}
                    index={index}
                    sort={sort}
                    onDirectionChange={updateSort}
                    onRemove={removeSort}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : <p className="mt-3 text-sm text-text-muted">Choose a field to sort these records.</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="secondary" disabled={availableAttributes.length === 0}>
                <Plus size={16} />
                Add another sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {availableAttributes.map((attribute) => (
                <DropdownMenuItem
                  key={attribute.id}
                  onSelect={() => onConfigChange((current) => ({ ...current, sorts: [...current.sorts, { attributeId: attribute.id, direction: 'asc' }] }))}
                >
                  {attribute.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {activeSorts.length > 0 && <Button type="button" size="sm" variant="secondary" onClick={() => onConfigChange((current) => ({ ...current, sorts: [] }))}>Clear sort</Button>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
