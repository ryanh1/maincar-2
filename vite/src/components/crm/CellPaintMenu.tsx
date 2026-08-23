import { Check, PaintBucket, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { PAINT_TOKENS } from '@/lib/paintTokens'
import type { GridMenuAnchor } from './gridFilterMenu'

interface CellPaintMenuProps {
  anchor: GridMenuAnchor
  open: boolean
  backgroundToken: string | null
  textToken: string | null
  colors: Record<string, string>
  onPaint: (backgroundToken: string | null, textToken: string | null) => void
  onOpenChange: (open: boolean) => void
}

function Swatch({ color, selected, label, onClick }: { color: string; selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      className="flex size-6 items-center justify-center rounded-md border border-border"
      style={{ backgroundColor: color }}
      onClick={onClick}
    >
      {selected && <Check className="size-3 text-white" />}
    </button>
  )
}

/**
 * The manual cell-paint popover (SPEC-CHUNK-2 J2.5 §D). Offers the muted palette
 * for a cell's background and text, plus a clear action. The grid owns the
 * persistence; this only reports the chosen tokens.
 */
export function CellPaintMenu({ anchor, open, backgroundToken, textToken, colors, onPaint, onOpenChange }: CellPaintMenuProps) {
  function setBackground(token: string | null) {
    onPaint(token, textToken)
  }

  function setText(token: string | null) {
    onPaint(backgroundToken, token)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="right" className="w-64 p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex items-center gap-2">
          <PaintBucket className="size-4 text-text-muted" />
          <p className="text-sm font-medium">Paint cell</p>
        </div>

        <p className="mt-3 text-xs font-medium text-text-muted">Background</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {PAINT_TOKENS.map((token) => (
            <Swatch key={token} color={colors[token]} selected={backgroundToken === token} label={`Background ${token}`} onClick={() => setBackground(token)} />
          ))}
          <button type="button" className="flex size-6 items-center justify-center rounded-md border border-border text-text-muted" aria-label="No background" onClick={() => setBackground(null)}>
            <X className="size-3" />
          </button>
        </div>

        <p className="mt-3 text-xs font-medium text-text-muted">Text</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {PAINT_TOKENS.map((token) => (
            <Swatch key={token} color={colors[token]} selected={textToken === token} label={`Text ${token}`} onClick={() => setText(token)} />
          ))}
          <button type="button" className="flex size-6 items-center justify-center rounded-md border border-border text-text-muted" aria-label="No text colour" onClick={() => setText(null)}>
            <X className="size-3" />
          </button>
        </div>

        <Button className="mt-3 w-full justify-start" size="sm" variant="secondary" onClick={() => { onPaint(null, null); onOpenChange(false) }}>
          Clear paint
        </Button>
      </PopoverContent>
    </Popover>
  )
}
