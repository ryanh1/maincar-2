import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { PageLoader } from '@/components/PageLoader'
import { Sidebar } from '@/components/Sidebar'
import { useAuth } from '@/providers/useAuth'

// The auth gate plus the app chrome. Every signed-in route nests under this.
export function ProtectedLayout() {
  const { isLoading, isAuthenticated, needsOnboarding, needsOrg } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (isLoading) return <PageLoader />

  if (!isAuthenticated) {
    const from = location.pathname + location.search
    return <Navigate to="/auth/sign-in" replace state={{ from }} />
  }

  // The two onboarding steps, in order. Name first, then org: an invitee never
  // reaches the second one, because accepting the invite gives them a membership.
  if (needsOnboarding && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />
  }

  if (!needsOnboarding && needsOrg && location.pathname !== '/create-org') {
    return <Navigate to="/create-org" replace />
  }

  // Both steps done, so neither screen has anything left to ask.
  if (!needsOnboarding && !needsOrg && (location.pathname === '/welcome' || location.pathname === '/create-org')) {
    return <Navigate to="/home" replace />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-background/85 px-4 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <span className="display ml-3 font-bold tracking-tight">{APP_NAME}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:ml-56">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
