import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { IntegrationCard, IntegrationConnection } from '@/hooks/integrations'
import type { Mailbox } from '@/lib/mailboxTypes'
import { renderWithProviders } from '@/test/utils'

const useGetMailboxes = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/mailboxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/mailboxes')>()
  return { ...actual, useGetMailboxes }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { Settings_Integrations_ProviderCard } from './Settings_Integrations_ProviderCard'

const REQUIRED = [
  'Read your email',
  'Send email as you',
  'See and add calendar events',
  'Know which account this is',
]

const GOOGLE_CONNECTION: IntegrationConnection = {
  id: 'conn-google',
  provider: 'google',
  providerAccountId: 'acct-google',
  emailAddress: 'google@acme.com',
  scopes: [],
  status: 'connected',
  errorCode: null,
  statusDetail: null,
  lastValidatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  lastRefreshAt: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

const GOOGLE_MAILBOX: Mailbox = {
  id: 'mailbox-google',
  provider: 'google',
  providerLabel: 'Google',
  emailAddress: 'google@acme.com',
  displayName: null,
  isPrimary: true,
  status: 'connected',
  statusDetail: '',
  errorCode: null,
  lastValidatedAt: GOOGLE_CONNECTION.lastValidatedAt,
  connectionId: GOOGLE_CONNECTION.id,
  connectedAt: GOOGLE_CONNECTION.createdAt,
}

const MICROSOFT_MAILBOX: Mailbox = {
  ...GOOGLE_MAILBOX,
  id: 'mailbox-microsoft',
  provider: 'microsoft',
  providerLabel: 'Microsoft',
  emailAddress: 'microsoft@acme.com',
  connectionId: 'conn-microsoft',
}

function makeCard(connections: IntegrationConnection[]): IntegrationCard {
  return {
    provider: 'google',
    providerLabel: 'Google Workspace',
    providerShortName: 'Google',
    requiredPermissions: REQUIRED,
    connections,
    connection: connections[0] ?? null,
  }
}

function renderCard(connections: IntegrationConnection[] = [], onConnect = vi.fn()) {
  const result = renderWithProviders(
    <Settings_Integrations_ProviderCard
      card={makeCard(connections)}
      orgId="org-1"
      onConnect={onConnect}
      onMailboxOpenSettings={vi.fn()}
      onMailboxReconnect={vi.fn()}
    />,
  )
  return { ...result, onConnect }
}

beforeEach(() => {
  vi.clearAllMocks()
  useGetMailboxes.mockReturnValue({
    data: { mailboxes: [] },
    isPending: false,
    isError: false,
  })
})

describe('provider-level copy and controls', () => {
  it('uses the approved product description and removes the permission checklist', () => {
    renderCard()

    expect(screen.getByText('Read and send from Google Workspace')).toBeInTheDocument()
    for (const permission of REQUIRED) {
      expect(screen.queryByText(permission)).not.toBeInTheDocument()
    }
  })

  it('shows Not connected and Connect only when this provider has no connections', async () => {
    const { onConnect } = renderCard()

    expect(screen.getByText('Not connected')).toBeInTheDocument()
    const connect = screen.getByRole('button', { name: 'Connect' })
    await userEvent.click(connect)
    expect(onConnect).toHaveBeenCalledWith('connect')
  })

  it('removes provider-level connection status, account identity, verification, Test, and Disconnect', () => {
    useGetMailboxes.mockReturnValue({
      data: { mailboxes: [GOOGLE_MAILBOX] },
      isPending: false,
      isError: false,
    })
    renderCard([GOOGLE_CONNECTION])

    expect(screen.queryByText('Not connected')).not.toBeInTheDocument()
    expect(screen.getAllByText('Connected')).toHaveLength(1)
    expect(screen.getAllByText('google@acme.com')).toHaveLength(1)
    expect(screen.getAllByText('Verified 2m ago')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect another' })).toBeInTheDocument()
  })
})

describe('provider mailbox scoping', () => {
  it('shows only Google mailboxes under the Google card and has no divider above them', () => {
    useGetMailboxes.mockReturnValue({
      data: { mailboxes: [GOOGLE_MAILBOX, MICROSOFT_MAILBOX] },
      isPending: false,
      isError: false,
    })

    const { container } = renderCard([GOOGLE_CONNECTION])

    expect(screen.getByText('google@acme.com')).toBeInTheDocument()
    expect(screen.queryByText('microsoft@acme.com')).not.toBeInTheDocument()
    expect(container.querySelector('.border-t')).toBeNull()
  })
})
