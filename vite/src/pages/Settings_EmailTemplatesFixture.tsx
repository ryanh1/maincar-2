import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuthStore } from '@/store/authStore'

import { Settings_EmailTemplatesTab } from './Settings_EmailTemplatesTab'

/** Development-only shell for the MAI-254 browser sharing journey. */
export function Settings_EmailTemplatesFixture() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    return () => document.documentElement.classList.remove('dark')
  }, [theme])

  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <TooltipProvider>
          <main className="min-h-dvh bg-bg p-6">
            <div className="mb-6 flex justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
                Use {theme === 'light' ? 'dark' : 'light'} theme
              </Button>
            </div>
            <Settings_EmailTemplatesTab />
          </main>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
