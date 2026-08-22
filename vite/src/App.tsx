import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProtectedLayout } from '@/components/ProtectedLayout'
import { RouteErrorPage } from '@/components/RouteErrorPage'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/providers/AuthProvider'

import { SignIn } from '@/pages/auth/SignIn'
import { SignUp } from '@/pages/auth/SignUp'
import { Calls } from '@/pages/Calls'
import { CallDetail } from '@/pages/CallDetail'
import { CrmGrid } from '@/pages/CrmGrid'
import { CreateOrg } from '@/pages/CreateOrg'
import { Home } from '@/pages/Home'
import { JoinOrg } from '@/pages/JoinOrg'
import { Records } from '@/pages/Records'
import { Settings } from '@/pages/Settings'
import { Welcome } from '@/pages/Welcome'

const routeErrorElement = <RouteErrorPage />

const router = createBrowserRouter([
  { path: '/auth/sign-in', element: <SignIn />, errorElement: routeErrorElement },
  { path: '/auth/sign-up', element: <SignUp />, errorElement: routeErrorElement },
  // Public on purpose: the person opening an invite link may have no account.
  { path: '/join/:token', element: <JoinOrg />, errorElement: routeErrorElement },
  {
    path: '/',
    element: <ProtectedLayout />,
    errorElement: routeErrorElement,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <Home /> },
      { path: 'calls', element: <Calls /> },
      { path: 'calls/:id', element: <CallDetail /> },
      { path: 'records/:slug', element: <Records /> },
      { path: 'lists/:listId', element: <CrmGrid /> },
      { path: 'welcome', element: <Welcome /> },
      { path: 'create-org', element: <CreateOrg /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        {/* One TooltipProvider for the whole app. Every icon-only button owes a
            tooltip (.claude/rules/design-system.md), so mounting the provider
            per screen meant the same four lines of boilerplate at every call
            site, and a forgotten one throws at runtime rather than at build. */}
        <TooltipProvider>
          <div className="flex h-dvh min-h-dvh flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <RouterProvider router={router} />
            </div>
            <Toaster />
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
