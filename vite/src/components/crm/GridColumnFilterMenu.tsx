import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@/components/ui/popover'
import type { AttributeDef } from '@/lib/crmTypes'
import type { ViewConfig } from './viewConfig'
import type { GridMenuAnchor } from './gridFilterMenu'

interface GridColumnFilterMenuProps {
  attribute: AttributeDef
  anchor: GridMenuAnchor
  config: ViewConfig
  freezeActions?: {
    freezeLabel: string
    onFreeze: () => void
    onUnfreeze: () => void
    unfreezeLabel: string
  }
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
  onOpenChange: (open: boolean) => void
  onToggleWrap?: () => void
  open: boolean
  wrap?: boolean
}

/** Header menus retain freezing and text wrapping; multi-level sorting lives in GridSortPopover. */
export function GridColumnFilterMenu({ attribute, anchor, freezeActions, onOpenChange, onToggleWrap, open, wrap = false }: GridColumnFilterMenuProps) {
  function closeMenu() {
    onOpenChange(false)
  }

  function freezeColumn() {
    freezeActions?.onFreeze()
    closeMenu()
  }

  function unfreezeColumns() {
    freezeActions?.onUnfreeze()
    closeMenu()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-64 p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <PopoverHeader><PopoverTitle>Column actions for {attribute.name}</PopoverTitle></PopoverHeader>
        <div className="mt-3 flex flex-col gap-3">
          {freezeActions && (
            <div className="flex flex-col gap-1 border-b border-border pb-3">
              <Button size="sm" variant="secondary" className="w-full justify-start" onClick={freezeColumn}>{freezeActions.freezeLabel}</Button>
              <Button size="sm" variant="secondary" className="w-full justify-start" onClick={unfreezeColumns}>{freezeActions.unfreezeLabel}</Button>
              {onToggleWrap && <Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => { onToggleWrap(); closeMenu() }}>{wrap ? 'Clip text' : 'Wrap text'}</Button>}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
