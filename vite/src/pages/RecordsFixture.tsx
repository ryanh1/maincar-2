import { useEffect, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { DialerContext, type DialerContextValue } from '@/components/dialer/dialerContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuthStore } from '@/store/authStore'

import { Records } from './Records'

// The grid reads the dialer only to mark a live Call row. Browser fixtures do
// not exercise calling, so provide the idle state without starting the Voice
// SDK or making an unrelated token request.
const idleDialer: DialerContextValue = {
  view: 'collapsed', phase: 'idle', mode: 'keypad', dialing: false, elapsedSeconds: 0,
  activeCall: null, canControlAudio: false,
  expandDialer: () => {}, collapseDialer: () => {}, toggleView: () => {},
  startCall: () => {}, adoptCall: () => {}, connectCall: () => {}, endCall: () => {},
  cancelCall: () => {}, reset: () => {}, placeDeviceCall: async () => {},
  muteCall: () => {}, sendDigits: () => {},
}

/** Development-only shell for record-grid browser journeys. */
export function RecordsFixture() {
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
        <DialerContext.Provider value={idleDialer}>
          <TooltipProvider>
            <main className="h-dvh bg-bg p-6">
              <Routes><Route path="/__fixtures/records/:slug" element={<Records />} /></Routes>
            </main>
          </TooltipProvider>
        </DialerContext.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
