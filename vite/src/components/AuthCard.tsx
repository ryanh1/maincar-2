import type { ReactNode } from 'react'

/**
 * Shared shell for every auth-style screen (sign in, sign up, invitation join).
 * Centers a single `max-w-sm` column and applies the auth-only type scale from
 * design-system.md — never re-create this wrapper locally.
 */
type AuthCardProps = {
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {title && (
          <div className="mb-8 text-center">
            <h1 className="display text-xl font-semibold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        )}

        {children}

        {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  )
}
