import { Button } from '@/components/ui/button'
import type { AttributeDef, FieldChange } from '@/lib/crmTypes'
import { formatCellValue } from './recordCellValue'

export interface ChangeHighlightTarget {
  recordId: string
  attribute: AttributeDef
  change: FieldChange
  bounds: { x: number; y: number; width: number; height: number }
}

interface ChangeHighlightOverlayProps {
  hover: ChangeHighlightTarget | null
  timeZone: string | null | undefined
  onShowFullHistory: (target: ChangeHighlightTarget) => void
}

/** HTML hover detail for a canvas cell, including the handoff to full history. */
export function ChangeHighlightOverlay({ hover, timeZone, onShowFullHistory }: ChangeHighlightOverlayProps) {
  if (!hover) return null
  const { attribute, change, bounds } = hover
  const previous = formatCellValue(change.previousValue, attribute.type, timeZone)
  const current = formatCellValue(change.currentValue, attribute.type, timeZone)

  return (
    <aside
      aria-label={`${attribute.name} change details`}
      className="absolute z-30 w-72 border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
      style={{ left: bounds.x + 8, top: bounds.y + bounds.height + 4 }}
    >
      <p className="font-medium">{attribute.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{change.changeCount} {change.changeCount === 1 ? 'change' : 'changes'}</p>
      <p className="mt-2 break-words">{previous || '—'} → {current || '—'}</p>
      <Button type="button" variant="link" size="sm" className="mt-2 h-auto px-0" onClick={() => onShowFullHistory(hover)}>
        See full history
      </Button>
    </aside>
  )
}
