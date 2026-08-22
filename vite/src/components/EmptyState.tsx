import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  children: ReactNode
}

/** Contextual guidance for a screen with nothing actionable to display yet. */
export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-md border border-border bg-bg p-6" aria-live="polite">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="flex flex-col items-start gap-3 text-sm text-text-muted">{children}</div>
    </section>
  )
}
