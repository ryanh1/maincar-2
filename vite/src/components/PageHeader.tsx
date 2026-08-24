import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  icon?: LucideIcon
  iconNode?: ReactNode
  title: string
  count?: number
  action?: ReactNode
}

/**
 * The sticky 48px bar every page opens with (design-system.md → Page and
 * section structure): icon, title, an optional count, and a primary action on
 * the right. One component so every screen's header reads the same way.
 */
export function PageHeader({ icon: Icon, iconNode, title, count, action }: PageHeaderProps) {
  return (
    <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b border-border bg-background">
      <div className="flex items-center gap-2">
        {iconNode ?? (Icon ? <Icon size={16} aria-hidden className="text-muted-foreground" /> : null)}
        <h1 className="text-base font-semibold">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 text-muted-foreground tabular-nums">{count}</span>
          )}
        </h1>
      </div>
      {action}
    </div>
  )
}
