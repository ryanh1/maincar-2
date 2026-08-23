import { icons, Tag } from 'lucide-react'
import type { CSSProperties } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Disposition } from '@/lib/dispositionTypes'

function colorStyle(color: Disposition['color']): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, var(--${color}) 16%, var(--background))`,
    borderColor: `var(--${color})`,
    color: `var(--${color})`,
  }
}

function DispositionLabel({ disposition }: { disposition: Disposition }) {
  const Icon = disposition.icon ? icons[disposition.icon as keyof typeof icons] ?? Tag : Tag
  return <><Icon size={16} aria-hidden /><span>{disposition.label}</span></>
}

interface Settings_DispositionsBarPreviewProps {
  pinned: Disposition[]
  overflow: Disposition[]
}

/** The settings preview intentionally uses the same ordered and overflowed data that the dialer reads. */
export function Settings_DispositionsBarPreview({ pinned, overflow }: Settings_DispositionsBarPreviewProps) {
  return (
    <div aria-label="Disposition bar preview" role="group" className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto border border-border bg-surface p-3">
      {pinned.map((disposition) => (
        <div key={disposition.id} aria-label={disposition.label} className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-medium" style={colorStyle(disposition.color)}>
          <DispositionLabel disposition={disposition} />
        </div>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="secondary" aria-label={`More dispositions (${overflow.length})`}>
              More <Badge variant="outline" className="tabular-nums">{overflow.length}</Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {overflow.map((disposition) => (
              <DropdownMenuItem key={disposition.id} className="gap-2">
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `var(--${disposition.color})` }} />
                <DispositionLabel disposition={disposition} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
