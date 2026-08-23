import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useState, type CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CrmListEntry } from '@/lib/crmTypes'

function entryLabel(entry: CrmListEntry): string {
  const name = entry.target?.name
  return typeof name === 'string' && name.trim() ? name : entry.targetId
}

function SortableEntry({ entry }: { entry: CrmListEntry }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: entry.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} className="flex h-8 items-center gap-2 border-b border-border px-2 text-sm last:border-b-0" {...attributes} {...listeners}>
      <GripVertical size={16} aria-hidden="true" className="text-text-muted" />
      {entryLabel(entry)}
    </div>
  )
}

/** Keyboard- and pointer-draggable manual order for list memberships only. */
export function ListEntryReorderDialog({ open, onOpenChange, entries, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; entries: CrmListEntry[]; onSave: (entryIds: string[]) => Promise<void> }) {
  const [orderedEntries, setOrderedEntries] = useState(entries)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  async function save() {
    setSaving(true)
    try {
      await onSave(orderedEntries.map((entry) => entry.id))
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reorder list</DialogTitle>
          <DialogDescription>Drag a member to set the saved call order.</DialogDescription>
        </DialogHeader>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return
          setOrderedEntries((current) => {
            const from = current.findIndex((entry) => entry.id === active.id)
            const to = current.findIndex((entry) => entry.id === over.id)
            return from < 0 || to < 0 ? current : arrayMove(current, from, to)
          })
        }}>
          <SortableContext items={orderedEntries.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
            <div className="max-h-80 overflow-y-auto border border-border"><div className="flex flex-col">{orderedEntries.map((entry) => <SortableEntry key={entry.id} entry={entry} />)}</div></div>
          </SortableContext>
        </DndContext>
        <DialogFooter>
          <Button variant="secondary" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? 'Saving' : 'Save order'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
