import { useEffect, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryKeys } from '@/lib/queryKeys'
import type { VoicemailDropsResponse } from '@/lib/voicemailDropTypes'
import { useAuthStore } from '@/store/authStore'

import { VoicemailDrops } from './VoicemailDrops'

function createSilentWavUrl(seconds: number): string {
  const sampleRate = 8_000
  const dataLength = sampleRate * seconds * 2
  const bytes = new Uint8Array(44 + dataLength)
  const view = new DataView(bytes.buffer)
  const write = (offset: number, value: string) => {
    value.split('').forEach((character, index) => {
      bytes[offset + index] = character.charCodeAt(0)
    })
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  write(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataLength, true)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:audio/wav;base64,${btoa(binary)}`
}

/** Development-only shell for inspecting the MAI-62 library in a real browser. */
export function VoicemailDropsFixture() {
  const audioUrl = useMemo(() => createSilentWavUrl(5), [])
  const client = useMemo(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    const data: VoicemailDropsResponse = {
      drops: [
        {
          id: 'default',
          name: 'Sales follow-up',
          duration: 73,
          transcript: 'Hi, this is Ann from Acme calling about your request.',
          transcriptStatus: 'done',
          status: 'ready',
          isDefault: true,
          audioUrl,
        },
        {
          id: 'callback',
          name: 'After-hours callback',
          duration: 12,
          transcript: null,
          transcriptStatus: 'pending',
          status: 'transcribing',
          isDefault: false,
          audioUrl,
        },
      ],
      total: 2,
    }
    queryClient.setQueryData(queryKeys.voicemailDrops.list('org-fixture'), data)
    return queryClient
  }, [audioUrl])

  useEffect(() => {
    const timestamps = { createdAt: '2026-08-23T12:00:00.000Z', updatedAt: '2026-08-23T12:00:00.000Z' }
    const org = {
      id: 'org-fixture',
      name: 'Fixture organization',
      logo: null,
      avatarUrl: null,
      enabled: true,
      ...timestamps,
    }
    useAuthStore.getState().setMe({
      user: {
        id: 'user-fixture',
        email: 'fixture@example.com',
        firstName: 'Fixture',
        lastName: 'Rep',
        imageUrl: null,
        avatarUrl: null,
        title: null,
        roles: ['basic'],
        enabled: true,
        currentOrgId: org.id,
        timeZone: 'America/New_York',
        ...timestamps,
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
            <VoicemailDrops />
          </main>
          <Toaster />
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
