import type { ReactNode } from 'react'

interface GridWorkspaceShellProps {
  header: ReactNode
  viewBar?: ReactNode
  recordCount?: ReactNode
  notice?: ReactNode
  children: ReactNode
}

/** Shared page geometry for object and saved-list grid routes. */
export function GridWorkspaceShell({ header, viewBar, recordCount, notice, children }: GridWorkspaceShellProps) {
  const hasViewBar = viewBar !== undefined || recordCount !== undefined

  return (
    <section data-testid="grid-workspace" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {header}
      {hasViewBar && (
        <div role="region" aria-label="View bar" className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
          <div className="min-w-0 flex-1">{viewBar}</div>
          {recordCount}
        </div>
      )}
      {notice}
      <div data-testid="grid-workspace-canvas" className="min-h-0 flex-1 overflow-hidden pt-4">
        {children}
      </div>
    </section>
  )
}
