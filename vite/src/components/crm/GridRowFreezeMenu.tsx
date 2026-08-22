import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { GridMenuAnchor } from './gridFilterMenu'

interface GridRowFreezeMenuProps {
  anchor: GridMenuAnchor
  open: boolean
  row: number
  onFreeze: () => void
  onOpenChange: (open: boolean) => void
  onUnfreeze: () => void
}

/** A row-header action menu. The grid owns the persisted ViewConfig update. */
export function GridRowFreezeMenu({ anchor, open, row, onFreeze, onOpenChange, onUnfreeze }: GridRowFreezeMenuProps) {
  function freeze() {
    onFreeze()
    onOpenChange(false)
  }

  function unfreeze() {
    onUnfreeze()
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="right" className="w-56 p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
        <p className="px-2 py-1 text-xs font-medium text-text-muted">Row {row + 1}</p>
        <Button className="w-full justify-start" size="sm" variant="secondary" onClick={freeze}>Freeze up to this row</Button>
        <Button className="mt-1 w-full justify-start" size="sm" variant="secondary" onClick={unfreeze}>Unfreeze rows</Button>
      </PopoverContent>
    </Popover>
  )
}
