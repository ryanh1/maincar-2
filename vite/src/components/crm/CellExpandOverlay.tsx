import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

import type { GridMenuAnchor } from './gridFilterMenu'

interface CellExpandOverlayProps {
  anchor: GridMenuAnchor
  onClose: () => void
  open: boolean
  value: string
}

/** Read-only, pointer-dismissed view of a clipped grid cell. */
export function CellExpandOverlay({ anchor, onClose, open, value }: CellExpandOverlayProps) {
  return (
    <Popover open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        className="max-w-md p-3"
        onEscapeKeyDown={onClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerLeave={onClose}
      >
        <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm">{value}</p>
      </PopoverContent>
    </Popover>
  )
}
