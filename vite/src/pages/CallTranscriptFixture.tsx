import { useEffect, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuthStore } from '@/store/authStore'

import { CallDetail } from './CallDetail'
import { Calls } from './Calls'

/** Development-only shell for the MAI-262 outbound recording browser journey. */
export function CallTranscriptFixture() {
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
        id: 'user-fixture', email: 'fixture@example.com', firstName: 'Fixture', lastName: 'Rep',
        imageUrl: null, avatarUrl: null, title: null, roles: ['basic'], enabled: true,
        currentOrgId: org.id, timeZone: 'America/New_York', createdAt: org.createdAt, updatedAt: org.updatedAt,
      },
      org,
      memberships: [{ orgId: org.id, org, roles: ['basic'] }],
    })
    return () => useAuthStore.getState().reset()
  }, [])

  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <TooltipProvider>
          <main className="min-h-dvh bg-bg p-6">
            <Routes>
              <Route path="/__fixtures/call-transcript" element={<Calls />} />
              <Route path="/calls" element={<Calls />} />
              <Route path="/calls/:id" element={<CallDetail />} />
            </Routes>
          </main>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
