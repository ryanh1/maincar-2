import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProtectedLayout } from '@/components/ProtectedLayout'
import { AdminLayout } from '@/components/AdminLayout'
import { RouteErrorPage } from '@/components/RouteErrorPage'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/providers/AuthProvider'

import { SignIn } from '@/pages/auth/SignIn'
import { SignUp } from '@/pages/auth/SignUp'
import { Calls } from '@/pages/Calls'
import { CalendarWorkspace } from '@/pages/CalendarWorkspace'
import { CallDetail } from '@/pages/CallDetail'
import { CrmGrid } from '@/pages/CrmGrid'
import { CreateOrg } from '@/pages/CreateOrg'
import { Home } from '@/pages/Home'
import { JoinOrg } from '@/pages/JoinOrg'
import { Records } from '@/pages/Records'
import { RecordPage } from '@/pages/RecordPage'
import { Reports } from '@/pages/Reports'
import { Tasks } from '@/pages/Tasks'
import { Settings, SettingsLegacyRedirect } from '@/pages/Settings'
import { Welcome } from '@/pages/Welcome'
import { VoicemailDetail } from '@/pages/VoicemailDetail'
import { VoicemailDrops } from '@/pages/VoicemailDrops'
import { Voicemails } from '@/pages/Voicemails'
import { AdminSyncHealth } from '@/pages/AdminSyncHealth'

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
      { path: 'calendar', element: <CalendarWorkspace /> },
      { path: 'calls/:id', element: <CallDetail /> },
      { path: 'voicemails/:id', element: <VoicemailDetail /> },
      { path: 'voicemails', element: <Voicemails /> },
      { path: 'voicemail-drops', element: <VoicemailDrops /> },
      { path: 'records/:slug', element: <Records /> },
      { path: 'records/:slug/:recordId', element: <RecordPage /> },
      { path: 'reports', element: <Reports /> },
      { path: 'tasks', element: <Tasks /> },
      { path: 'lists/:listId', element: <CrmGrid /> },
      { path: 'welcome', element: <Welcome /> },
      { path: 'create-org', element: <CreateOrg /> },
      { path: 'settings', element: <SettingsLegacyRedirect /> },
      { path: 'settings/:section', element: <Settings /> },
    ],
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    errorElement: routeErrorElement,
    children: [
      { index: true, element: <Navigate to="/admin/sync-health" replace /> },
      { path: 'sync-health', element: <AdminSyncHealth /> },
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
