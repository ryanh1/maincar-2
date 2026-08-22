import { useEffect, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { EmailDraft } from '@/lib/emailTypes'
import { useAuthStore } from '@/store/authStore'
import { ComposerCard } from './ComposerCard'
import { ComposerContext } from './composerContext'

type ComposeMode = 'new' | 'reply' | 'forward'
type FixtureTheme = 'light' | 'dark'

const BODY_BY_MODE: Record<ComposeMode, string | null> = {
  new: null,
  reply: '<p>Earlier reply context</p>',
  forward: '<p>Forwarded message</p>',
}

function fixtureMode(): ComposeMode {
  const value = new URLSearchParams(window.location.search).get('mode')
  return value === 'reply' || value === 'forward' ? value : 'new'
}

function fixtureTheme(): FixtureTheme {
  return new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
}

function fixtureDraft(mode: ComposeMode): EmailDraft {
  const now = '2026-08-22T12:00:00.000Z'
  return {
    id: `draft-${mode}`,
    mailAccountId: null,
    recordObject: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: mode === 'new' ? null : `Re: ${mode === 'reply' ? 'Earlier message' : 'Forwarded message'}`,
    bodyHtml: BODY_BY_MODE[mode],
    isOpen: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Development-only shell for the real-browser composer focus journey. */
export function ComposerCardFixture() {
  const mode = fixtureMode()
  const theme = fixtureTheme()
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
      <TooltipProvider>
        <ComposerContext.Provider value={{
          drafts: [], openDrafts: [], keptDrafts: [],
          openComposer: async () => null,
          saveDraft: async () => undefined,
          closeCard: async () => undefined,
          reopenCard: async () => undefined,
          discardDraft: async () => undefined,
        }}>
          <main className="min-h-dvh bg-bg p-6">
            <h1 className="mb-6 text-base font-semibold">{mode} composer focus fixture</h1>
            <ComposerCard draft={fixtureDraft(mode)} />
          </main>
        </ComposerContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
