import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@/components/ui/popover'
import type { GridMenuAnchor } from './gridFilterMenu'

interface CellCopyMenuProps {
  anchor: GridMenuAnchor
  /** The store-canonical value (E.164 for a phone). */
  rawValue: string
  /** The display-formatted value (national format for a phone). */
  displayValue: string
  onClose: () => void
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied.`)
  } catch {
    toast.error('Could not copy. Check your browser permissions and try again.')
  }
}

/**
 * The right-click copy menu for a phone cell (MAI-365): copy the store-canonical
 * E.164 value or the display-formatted national number, so a rep can paste either
 * into another tool without the grid's default copy deciding for them.
 */
export function CellCopyMenu({ anchor, rawValue, displayValue, onClose }: CellCopyMenuProps) {
  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-56 p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <PopoverHeader><PopoverTitle>Copy</PopoverTitle></PopoverHeader>
        <div className="mt-3 flex flex-col gap-1">
          <Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => { void copyText(rawValue, 'Raw number'); onClose() }}>Copy raw (E.164)</Button>
          <Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => { void copyText(displayValue, 'Formatted number'); onClose() }}>Copy formatted</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
