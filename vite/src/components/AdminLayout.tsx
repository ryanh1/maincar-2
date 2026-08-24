import { Activity } from 'lucide-react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { PageLoader } from '@/components/PageLoader'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/useAuth'

/** Authenticated operator chrome, kept separate from the customer application. */
export function AdminLayout() {
  const { isLoading, isAuthenticated, isSuperadmin } = useAuth()
  const location = useLocation()

  if (isLoading) return <PageLoader />
  if (!isAuthenticated) {
    return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname + location.search }} />
  }
  if (!isSuperadmin) return <Navigate to="/home" replace />

  return (
    <div className="flex min-h-0 flex-1 bg-bg">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface p-3">
        <div className="flex h-12 items-center px-2 text-base font-semibold">{APP_NAME} admin</div>
        <nav aria-label="Admin" className="flex flex-col gap-1">
          <NavLink
            to="/admin/sync-health"
            className={({ isActive }) => cn(
              'flex h-8 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
              isActive ? 'bg-surface-2 text-text' : 'text-text-muted hover:bg-surface-2',
            )}
          >
            <Activity size={16} aria-hidden />
            Sync health
          </NavLink>
        </nav>
      </aside>
      <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto p-6 outline-none">
        <Outlet />
      </main>
    </div>
  )
}
