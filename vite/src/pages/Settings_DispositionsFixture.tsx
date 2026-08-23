import { useEffect, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/store/authStore'

import { Settings_DispositionsTab } from './Settings_DispositionsTab'

/** Development-only shell for the MAI-401 disposition configuration browser journey. */
export function Settings_DispositionsFixture() {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
    [],
  )

  useEffect(() => {
    const org = {
      id: 'org-fixture', name: 'Fixture organization', logo: null, avatarUrl: null, enabled: true,
      createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
    }
    useAuthStore.getState().setMe({
      user: {
        id: 'user-fixture', email: 'fixture@example.com', firstName: 'Fixture', lastName: 'Admin',
        imageUrl: null, avatarUrl: null, title: null, roles: ['basic'], enabled: true,
        currentOrgId: org.id, timeZone: 'America/New_York', createdAt: org.createdAt, updatedAt: org.updatedAt,
      },
      org,
      memberships: [{ orgId: org.id, org, roles: ['admin'] }],
    })
    return () => useAuthStore.getState().reset()
  }, [])

  return <QueryClientProvider client={client}>
    <BrowserRouter>
      <TooltipProvider>
        <main className="min-h-dvh bg-background p-6"><Settings_DispositionsTab /></main>
        <Toaster />
      </TooltipProvider>
    </BrowserRouter>
  </QueryClientProvider>
}
