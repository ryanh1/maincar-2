import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, ArrowLeft, ArrowRight, PinOff } from 'lucide-react'
import type { CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { MAX_PINNED_DISPOSITIONS, pinDisposition, reorderPinned } from '@/lib/dispositionBar'
import type { Disposition } from '@/lib/dispositionTypes'

interface SortableDispositionProps {
  disposition: Disposition
  index: number
  total: number
  onMove: (id: string, direction: -1 | 1) => void
  onUnpin: (id: string) => void
}

function SortableDisposition({ disposition, index, total, onMove, onUnpin }: SortableDispositionProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: disposition.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className="flex h-10 items-center gap-2 border border-border bg-background px-2 text-sm">
      <button type="button" aria-label={`Drag ${disposition.label}`} className="cursor-grab text-text-muted active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical size={16} aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate">{disposition.label}</span>
      <IconButton type="button" size="icon-sm" variant="ghost" tooltip={`Move ${disposition.label} left`} disabled={index === 0} onClick={() => onMove(disposition.id, -1)}>
        <ArrowLeft size={16} aria-hidden />
      </IconButton>
      <IconButton type="button" size="icon-sm" variant="ghost" tooltip={`Move ${disposition.label} right`} disabled={index === total - 1} onClick={() => onMove(disposition.id, 1)}>
        <ArrowRight size={16} aria-hidden />
      </IconButton>
      <IconButton type="button" size="icon-sm" variant="ghost" tooltip={`Remove ${disposition.label} from the bar`} onClick={() => onUnpin(disposition.id)}>
        <PinOff size={16} aria-hidden />
      </IconButton>
    </div>
  )
}

interface Settings_DispositionsBarEditorProps {
  dispositions: Disposition[]
  pinnedIds: string[]
  isPublishing: boolean
  warning: string | null
  onPinnedIdsChange: (pinnedIds: string[]) => void
  onWarningChange: (warning: string | null) => void
  onPublish: () => void
}

export function Settings_DispositionsBarEditor({ dispositions, pinnedIds, isPublishing, warning, onPinnedIdsChange, onWarningChange, onPublish }: Settings_DispositionsBarEditorProps) {
  const byId = new Map(dispositions.map((disposition) => [disposition.id, disposition]))
  const pinned = pinnedIds.flatMap((id) => {
    const disposition = byId.get(id)
    return disposition ? [disposition] : []
  })
  const overflow = dispositions.filter((disposition) => !pinnedIds.includes(disposition.id))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function change(next: string[]): void {
    onWarningChange(null)
    onPinnedIdsChange(next)
  }

  function move(id: string, direction: -1 | 1): void {
    const index = pinnedIds.indexOf(id)
    const target = pinnedIds[index + direction]
    if (!target) return
    change(reorderPinned(pinnedIds, id, target))
  }

  function pin(id: string): void {
    const result = pinDisposition(pinnedIds, id)
    if (result.overflowed) {
      const label = byId.get(id)?.label ?? 'This disposition'
      onWarningChange(`Only seven dispositions fit in the bar. ${label} stays in More.`)
      return
    }
    change(result.pinnedIds)
  }

  return (
    <section aria-labelledby="bar-order-heading" className="flex flex-col gap-3 border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="bar-order-heading" className="text-sm font-semibold">Bar order</h3>
          <p className="text-xs text-text-muted">Drag to reorder. Use the arrow buttons for keyboard reordering.</p>
        </div>
        <Button type="button" size="sm" disabled={isPublishing} onClick={onPublish}>{isPublishing ? 'Publishing' : 'Publish bar'}</Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) change(reorderPinned(pinnedIds, String(active.id), String(over.id)))
      }}>
        <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2" aria-label="Pinned dispositions">
            {pinned.map((disposition, index) => <SortableDisposition key={disposition.id} disposition={disposition} index={index} total={pinned.length} onMove={move} onUnpin={(id) => change(pinnedIds.filter((pinnedId) => pinnedId !== id))} />)}
          </div>
        </SortableContext>
      </DndContext>

      {warning && <p className="text-xs text-status-attention" role="status">{warning}</p>}
      <p className="text-xs text-text-muted">{pinned.length} of {MAX_PINNED_DISPOSITIONS} positions pinned. Remaining dispositions appear in More.</p>

      {overflow.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Overflow dispositions">
          {overflow.map((disposition) => <Button key={disposition.id} type="button" size="sm" variant="secondary" onClick={() => pin(disposition.id)}>Pin {disposition.label}</Button>)}
        </div>
      )}
    </section>
  )
}
