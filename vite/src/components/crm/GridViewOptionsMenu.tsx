import { useState } from 'react'
import { ChevronDown, Grid3X3, History, Palette, PanelsTopLeft, Rows3, SlidersHorizontal, ZoomIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

import type { GridMenuAnchor } from './gridFilterMenu'
import { clampZoom, type ViewConfig, ZOOM_PRESETS } from './viewConfig'

interface GridViewOptionsMenuProps {
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
  onFormat?: (anchor: GridMenuAnchor) => void
}

/** Infrequent grid presentation controls grouped under one stable command. */
export function GridViewOptionsMenu({ config, onConfigChange, onFormat }: GridViewOptionsMenuProps) {
  const [customChangeDays, setCustomChangeDays] = useState('')
  const [customZoom, setCustomZoom] = useState('')

  function applyCustomChangeWindow() {
    const days = Number(customChangeDays)
    if (!Number.isInteger(days) || days < 1 || days > 365) return
    onConfigChange((current) => ({ ...current, changeHighlight: { ...current.changeHighlight, days } }))
  }

  function setFrozenCount(key: 'frozenRows' | 'frozenCols', rawValue: string) {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    onConfigChange((current) => ({ ...current, [key]: Math.max(0, Math.floor(value)) }))
  }

  function applyCustomZoom() {
    const zoom = Number(customZoom)
    if (!Number.isFinite(zoom)) return
    onConfigChange((current) => ({ ...current, zoom: clampZoom(zoom) }))
    setCustomZoom('')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <SlidersHorizontal size={16} />
          View options
          <ChevronDown size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {onFormat && (
          <DropdownMenuItem
            onSelect={(event) => {
              const target = event.currentTarget
              if (!(target instanceof HTMLElement)) return
              const rect = target.getBoundingClientRect()
              onFormat({ x: rect.left, y: rect.bottom, width: rect.width, height: rect.height })
            }}
          >
            <Palette size={16} />
            Format
          </DropdownMenuItem>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <History size={16} />
            Change highlighting
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuCheckboxItem
              checked={config.changeHighlight.mode === 'on'}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onConfigChange((current) => ({
                ...current,
                changeHighlight: { ...current.changeHighlight, mode: checked ? 'on' : 'off' },
              }))}
            >
              Highlight changes
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Change window</DropdownMenuLabel>
            {[1, 7, 30].map((days) => (
              <DropdownMenuItem
                key={days}
                onSelect={(event) => {
                  event.preventDefault()
                  onConfigChange((current) => ({ ...current, changeHighlight: { ...current.changeHighlight, days } }))
                }}
              >
                {days === 1 ? 'Last day' : `Last ${days} days`}
              </DropdownMenuItem>
            ))}
            <label className="mx-2 mt-1 flex items-center gap-2 text-xs text-text-muted">
              Custom days
              <Input
                aria-label="Custom change window in days"
                className="w-20"
                min={1}
                max={365}
                type="number"
                value={customChangeDays}
                onChange={(event) => setCustomChangeDays(event.target.value)}
                onBlur={applyCustomChangeWindow}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyCustomChangeWindow()
                  }
                }}
              />
            </label>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={config.changeHighlight.onlyChangedRows}
              disabled={config.changeHighlight.mode === 'off'}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(onlyChangedRows) => onConfigChange((current) => ({
                ...current,
                changeHighlight: { ...current.changeHighlight, onlyChangedRows },
              }))}
            >
              Show only changed rows
            </DropdownMenuCheckboxItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Rows3 size={16} />
            Density
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuLabel>Row height</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={config.rowHeight}
              onValueChange={(rowHeight) => onConfigChange((current) => ({ ...current, rowHeight: rowHeight as ViewConfig['rowHeight'] }))}
            >
              {(['compact', 'comfortable', 'tall'] as const).map((rowHeight) => (
                <DropdownMenuRadioItem key={rowHeight} value={rowHeight}>
                  {rowHeight.slice(0, 1).toUpperCase() + rowHeight.slice(1)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={config.gridLines}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(gridLines) => onConfigChange((current) => ({ ...current, gridLines }))}
            >
              <Grid3X3 size={16} />
              Show grid lines
            </DropdownMenuCheckboxItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PanelsTopLeft size={16} />
            Freeze
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 p-2">
            <label className="mb-2 flex items-center gap-2 text-xs text-text-muted">
              Frozen rows
              <Input
                aria-label="Frozen rows"
                className="w-20"
                min={0}
                type="number"
                value={config.frozenRows}
                onChange={(event) => setFrozenCount('frozenRows', event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              Frozen columns
              <Input
                aria-label="Frozen columns"
                className="w-20"
                min={0}
                type="number"
                value={config.frozenCols}
                onChange={(event) => setFrozenCount('frozenCols', event.target.value)}
              />
            </label>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ZoomIn size={16} />
            Zoom
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuLabel>Zoom · {config.zoom}%</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(config.zoom)}
              onValueChange={(zoom) => onConfigChange((current) => ({ ...current, zoom: Number(zoom) }))}
            >
              {ZOOM_PRESETS.map((preset) => (
                <DropdownMenuRadioItem key={preset} value={String(preset)}>{preset}%</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <label className="mx-2 mb-1 flex items-center gap-2 text-xs text-text-muted">
              Custom
              <Input
                aria-label="Custom zoom percentage"
                className="w-20"
                min={50}
                max={200}
                type="number"
                value={customZoom}
                onChange={(event) => setCustomZoom(event.target.value)}
                onBlur={applyCustomZoom}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyCustomZoom()
                  }
                }}
              />
            </label>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
