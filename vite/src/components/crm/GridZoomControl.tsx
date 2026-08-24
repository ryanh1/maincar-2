import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

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
 * Zoom presets plus a custom percentage under the grid's View options menu.
 * The grid owns persistence; this only reports the chosen percentage.
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
        <Button variant="secondary" size="sm">
          <SlidersHorizontal size={16} />
          View options
          <ChevronDown size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Zoom · {zoom}%</DropdownMenuLabel>
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
            className="h-8 w-16"
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
