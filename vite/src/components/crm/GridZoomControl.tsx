import { useState } from 'react'
import { ChevronDown, ZoomIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { clampZoom, ZOOM_PRESETS } from './viewConfig'

interface GridZoomControlProps {
  zoom: number
  onZoomChange: (zoom: number) => void
}

/**
 * The Sheets-style zoom control (journey 4b.10.1): presets plus a custom
 * percentage, shown in the grid's bottom status bar. The grid owns persistence;
 * this only reports the chosen percentage.
 */
export function GridZoomControl({ zoom, onZoomChange }: GridZoomControlProps) {
  const [custom, setCustom] = useState('')

  function applyCustom() {
    const value = Number(custom)
    if (!Number.isFinite(value)) return
    onZoomChange(clampZoom(value))
    setCustom('')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-text-muted">
          <ZoomIn size={14} />
          {zoom}%
          <ChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-40">
        <DropdownMenuLabel>Zoom</DropdownMenuLabel>
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset} onSelect={() => onZoomChange(preset)}>
            {preset}%
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <label className="mx-2 mb-1 flex items-center gap-2 text-xs text-text-muted">
          Custom
          <Input
            aria-label="Custom zoom percentage"
            className="h-7 w-16"
            min={50}
            max={200}
            type="number"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onBlur={applyCustom}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyCustom()
              }
            }}
          />
        </label>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
