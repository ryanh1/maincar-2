import type { CSSProperties } from 'react'

import { Badge } from '@/components/ui/badge'

interface OptionChipProps {
  label: string
  color?: string
}

/** A compact, consistently styled display value for select-like CRM fields. */
export function OptionChip({ label, color }: OptionChipProps) {
  return (
    <Badge variant="secondary" className="max-w-full">
      {color && (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          data-testid="option-chip-color"
          style={{ backgroundColor: color } as CSSProperties}
        />
      )}
      <span className="truncate">{label}</span>
    </Badge>
  )
}
