import { useState } from 'react'

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

/** Header menus retain sorting and freezing; filtering lives in GridFilterBuilder. */
export function GridColumnFilterMenu({ attribute, anchor, config, freezeActions, onConfigChange, onOpenChange, onToggleWrap, open, wrap = false }: GridColumnFilterMenuProps) {
  const activeSort = config.sorts[0]
  const [draftSort, setDraftSort] = useState<'asc' | 'desc' | undefined>(activeSort?.attributeId === attribute.id ? activeSort.direction : undefined)
  const [clearSort, setClearSort] = useState(false)

  function closeMenu() {
    onOpenChange(false)
  }

  function apply() {
    onConfigChange((current) => ({
      ...current,
      ...(clearSort ? { sorts: [] } : draftSort ? { sorts: [{ attributeId: attribute.id, direction: draftSort }] } : {}),
    }))
    closeMenu()
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={draftSort === 'asc' && !clearSort ? 'default' : 'secondary'} onClick={() => { setDraftSort('asc'); setClearSort(false) }}>A to Z</Button>
            <Button size="sm" variant={draftSort === 'desc' && !clearSort ? 'default' : 'secondary'} onClick={() => { setDraftSort('desc'); setClearSort(false) }}>Z to A</Button>
            {(draftSort || activeSort?.attributeId === attribute.id) && <Button size="sm" variant="secondary" onClick={() => { setDraftSort(undefined); setClearSort(true) }}>Clear sort</Button>}
          </div>
          <div className="flex justify-end border-t border-border pt-3">
            <Button size="sm" onClick={apply}>Apply sort</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
