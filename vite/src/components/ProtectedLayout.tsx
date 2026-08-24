import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { APP_NAME } from '@/config'
import { ComposerCard } from '@/components/composer/ComposerCard'
import { ComposerDock } from '@/components/composer/ComposerDock'
import { ComposerProvider } from '@/components/composer/ComposerProvider'
import { CommandBar } from '@/components/command-bar/CommandBar'
import { DialerDock } from '@/components/dialer/DialerDock'
import { DialerProvider } from '@/components/dialer/DialerProvider'
import { KeyboardProvider } from '@/components/keyboard/KeyboardProvider'
import { OutreachLayoutProvider } from '@/components/OutreachLayoutProvider'
import { useOutreachLayout } from '@/components/outreachLayout'
import { PageLoader } from '@/components/PageLoader'
import { Sidebar } from '@/components/Sidebar'
import { IconButton } from '@/components/ui/icon-button'
import { useAuth } from '@/providers/useAuth'

// The auth gate plus the app chrome. Every signed-in route nests under this.
export function ProtectedLayout() {
  const { isLoading, isAuthenticated, needsOnboarding, needsOrg } = useAuth()
  const location = useLocation()

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
    <DialerProvider>
      <ComposerProvider>
        <OutreachLayoutProvider>
          <ProtectedApplication />
        </OutreachLayoutProvider>
      </ComposerProvider>
    </DialerProvider>
  )
}

function ProtectedApplication() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [hiddenDraftIds, setHiddenDraftIds] = useState<string[]>([])
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const outreachLayout = useOutreachLayout()

  // ComposerProvider wraps everything and sits OUTSIDE <Outlet />, which is the
  // whole point of it: a half-written email survives navigation only because the
  // state holding it never unmounts when the route under it changes. The dock is
  // out here with it, for the same reason and one more: it is `fixed` to the
  // bottom-right corner, so nesting it inside the scrolling <Outlet /> would let
  // a page's own scroll container clip it.
  //
  // DialerProvider wraps this tree for the same reason ComposerProvider does: a
  // call in progress survives navigation only because the state holding it never
  // unmounts when the route under it changes. OutreachLayoutProvider gives the
  // page, rail, composer, dialer, and portalled drawers one geometry contract.
  return (
    <>
      <KeyboardProvider>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          data-outreach-layout={outreachLayout.usesRail ? 'rail' : 'bottom'}
          style={{
            paddingRight: outreachLayout.pageRightInsetPx,
            paddingBottom: outreachLayout.pageBottomInsetPx,
          }}
        >
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
            <main id="app-main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none lg:ml-56">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 md:px-6 lg:px-8 lg:py-8">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </KeyboardProvider>

      <ComposerDock
        renderCard={(draft) => <ComposerCard draft={draft} />}
        selectedDraftId={selectedDraftId}
        onHiddenDraftIdsChange={setHiddenDraftIds}
      />
      <CommandBar hiddenDraftIds={hiddenDraftIds} onSelectDraft={setSelectedDraftId} />
      <DialerDock />
    </>
  )
}
