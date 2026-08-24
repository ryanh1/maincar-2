import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { BrowserRouter } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/store/authStore'

import { CalendarWorkspace } from './CalendarWorkspace'

/** Development-only shell for the real-browser calendar event lifecycle journey. */
export function CalendarWorkspaceFixture() {
  const fixtureTimeZone = new URLSearchParams(window.location.search).get('timeZone') ?? 'America/New_York'
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
    [],
  )

  useEffect(() => {
    const org = {
      id: 'org-fixture', name: 'Fixture organization', logo: null, avatarUrl: null, enabled: true,
      createdAt: '2026-08-23T12:00:00.000Z', updatedAt: '2026-08-23T12:00:00.000Z',
    }
    useAuthStore.getState().setMe({
      user: {
        id: 'user-fixture', email: 'fixture@example.com', firstName: 'Fixture', lastName: 'Rep',
        imageUrl: null, avatarUrl: null, title: null, roles: ['basic'], enabled: true,
        currentOrgId: org.id, timeZone: fixtureTimeZone, createdAt: org.createdAt, updatedAt: org.updatedAt,
      },
      org,
      memberships: [{ orgId: org.id, org, roles: ['basic'] }],
    })
    return () => useAuthStore.getState().reset()
  }, [fixtureTimeZone])

  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <TooltipProvider>
          <CalendarWorkspace />
          <Toaster />
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
