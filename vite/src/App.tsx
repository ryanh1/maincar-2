import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProtectedLayout } from '@/components/ProtectedLayout'
import { RouteErrorPage } from '@/components/RouteErrorPage'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/providers/AuthProvider'

import { SignIn } from '@/pages/auth/SignIn'
import { SignUp } from '@/pages/auth/SignUp'
import { Home } from '@/pages/Home'
import { Settings } from '@/pages/Settings'
import { Welcome } from '@/pages/Welcome'

const routeErrorElement = <RouteErrorPage />

const router = createBrowserRouter([
  { path: '/auth/sign-in', element: <SignIn />, errorElement: routeErrorElement },
  { path: '/auth/sign-up', element: <SignUp />, errorElement: routeErrorElement },
  {
    path: '/',
    element: <ProtectedLayout />,
    errorElement: routeErrorElement,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <Home /> },
      { path: 'welcome', element: <Welcome /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <div className="flex h-dvh min-h-dvh flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RouterProvider router={router} />
          </div>
          <Toaster />
        </div>
      </AuthProvider>
    </ErrorBoundary>
  )
}
