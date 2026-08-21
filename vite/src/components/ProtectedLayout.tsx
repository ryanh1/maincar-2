import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { ComposerCard } from '@/components/composer/ComposerCard'
import { ComposerDock } from '@/components/composer/ComposerDock'
import { ComposerProvider } from '@/components/composer/ComposerProvider'
import { DialerDock } from '@/components/dialer/DialerDock'
import { DialerProvider } from '@/components/dialer/DialerProvider'
import { PageLoader } from '@/components/PageLoader'
import { Sidebar } from '@/components/Sidebar'
import { IconButton } from '@/components/ui/icon-button'
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

  // ComposerProvider wraps everything and sits OUTSIDE <Outlet />, which is the
  // whole point of it: a half-written email survives navigation only because the
  // state holding it never unmounts when the route under it changes. The dock is
  // out here with it, for the same reason and one more: it is `fixed` to the
  // bottom-right corner, so nesting it inside the scrolling <Outlet /> would let
  // a page's own scroll container clip it.
  //
  // The dock takes the card through `renderCard` rather than importing it, so
  // the corner's arithmetic and the card's autosave stay testable apart. This is
  // the only place the two meet.
  // DialerProvider wraps the tree for the same reason ComposerProvider does: a
  // call in progress survives navigation only because the state holding it never
  // unmounts when the route under it changes. DialerDock sits out here beside the
  // composer dock, both `fixed` to the bottom-right corner — the dialer owns the
  // corner (z-100) and the composer reserves its width, so the two never overlap.
  return (
    <DialerProvider>
      <ComposerProvider>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center border-b border-border bg-background/85 px-4 backdrop-blur lg:hidden">
            <IconButton
              tooltip="Open the navigation menu"
              tooltipSide="bottom"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} aria-hidden />
            </IconButton>
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

        <ComposerDock renderCard={(draft) => <ComposerCard draft={draft} />} />
      </ComposerProvider>
      <DialerDock />
    </DialerProvider>
  )
}
