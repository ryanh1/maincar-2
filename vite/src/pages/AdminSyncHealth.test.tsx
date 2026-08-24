import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

const { useAuthMock, useGetAdminSyncHealthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetAdminSyncHealthMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/admin', () => ({ useGetAdminSyncHealth: useGetAdminSyncHealthMock }))

import { AdminSyncHealth } from './AdminSyncHealth'

const report = {
  generatedAt: '2026-08-24T00:00:00.000Z',
  windowHours: 24,
  queues: [{ queue: 'mail-sync', queueDepth: 2, failureCount: 1, deadLetterCount: 0 }],
  accounts: [{
    id: 'mail-1', orgId: 'org-1', orgName: 'Acme', emailAddress: 'rep@acme.test', provider: 'google',
    lastSyncedAt: '2026-08-23T23:00:00.000Z', cursorAgeSeconds: 3_600, syncRuns: 4,
    fullResyncs: 1, fullResyncRate: 0.25, messagesScanned: 100, messagesMatched: 60, matchRate: 0.6,
  }],
  subscriptions: [{
    mailAccountId: 'mail-1', orgId: 'org-1', orgName: 'Acme', emailAddress: 'rep@acme.test',
    kind: 'google_mail', expiresAt: '2026-08-25T00:00:00.000Z', expiresInSeconds: 86_400,
  }],
  holdBuffer: { total: 3, byOrg: [{ orgId: 'org-1', orgName: 'Acme', count: 3 }] },
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ user: { timeZone: 'America/New_York' } })
  useGetAdminSyncHealthMock.mockReturnValue({ isLoading: false, isError: false, data: { syncHealth: report } })
})

describe('AdminSyncHealth', () => {
  it('shows every required sync signal with zone-labeled timestamps', () => {
    renderWithProviders(<AdminSyncHealth />)

    expect(screen.getByRole('heading', { name: 'F-job queues', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Cursor age per account')).toBeInTheDocument()
    expect(screen.getByText('Full resync and match rates')).toBeInTheDocument()
    expect(screen.getByText('Push-subscription expiry')).toBeInTheDocument()
    expect(screen.getByText('Unmatched hold buffer')).toBeInTheDocument()
    expect(screen.getAllByText(/EDT/).length).toBeGreaterThan(0)
    expect(screen.getByText('25% resync · 60% match')).toBeInTheDocument()
    expect(screen.getAllByText('3 held')).toHaveLength(2)
  })

  it('shows an actionable load error', () => {
    useGetAdminSyncHealthMock.mockReturnValue({ isLoading: false, isError: true })

    renderWithProviders(<AdminSyncHealth />)

    expect(screen.getByText('Could not load sync health. Refresh the page.')).toBeInTheDocument()
  })
})
