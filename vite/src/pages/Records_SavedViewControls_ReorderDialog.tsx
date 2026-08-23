import { useState } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { CSSProperties } from 'react'

import { IconButton } from '@/components/ui/icon-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { SavedView } from '@/hooks/savedViews'

interface ReorderDialogProps {
  open: boolean
  views: SavedView[]
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onReorder: (viewIds: string[]) => void | Promise<void>
}

function SortableView({ view, disabled }: { view: SavedView; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: view.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className="flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-1 text-sm">
      <IconButton disabled={disabled} tooltip={`Reorder ${view.name} view`} {...attributes} {...listeners}>
        <GripVertical />
      </IconButton>
      <span className="min-w-0 flex-1 truncate">{view.name}</span>
      <span className="text-xs text-text-muted">{view.isShared ? 'Shared' : 'Personal'}</span>
    </div>
  )
}

/** Dialog used by the view menu to persist a drag-and-drop order. */
export function Records_SavedViewControls_ReorderDialog({ open, views, disabled, onOpenChange, onReorder }: ReorderDialogProps) {
  const [orderedViews, setOrderedViews] = useState(views)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Reorder views</DialogTitle>
          <DialogDescription>Drag views to change their order.</DialogDescription>
        </DialogHeader>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return
            const oldIndex = orderedViews.findIndex((view) => view.id === active.id)
            const newIndex = orderedViews.findIndex((view) => view.id === over.id)
            if (oldIndex < 0 || newIndex < 0) return
            const nextViews = arrayMove(orderedViews, oldIndex, newIndex)
            setOrderedViews(nextViews)
            void onReorder(nextViews.map((view) => view.id))
          }}
        >
          <SortableContext items={orderedViews.map((view) => view.id)} strategy={verticalListSortingStrategy}>
            <div aria-label="Saved view order" className="flex flex-col gap-1">
              {orderedViews.map((view) => <SortableView key={view.id} view={view} disabled={disabled} />)}
            </div>
          </SortableContext>
        </DndContext>
        {disabled && <p className="text-xs text-text-muted">Wait for the current view update to finish.</p>}
      </DialogContent>
    </Dialog>
  )
}
