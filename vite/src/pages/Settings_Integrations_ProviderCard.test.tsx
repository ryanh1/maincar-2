// What this card must never get wrong, and what these tests hold it to:
//
//   - GREEN MEANS EVERY PERMISSION. A partially-granted connection is amber and says
//     which capability it costs; a withheld scope never renders as a green check.
//   - Every unhealthy card pairs its status with a recovery block — even for an error
//     code the client has never seen, which falls back to `unknown`.
//   - One primary action per card, by status: Connect · Fix permissions · Reconnect · Test.
//   - Status is carried by a WORD and an ICON, never a colour alone, so no assertion here
//     is on colour: each checks the status word or the lucide icon class.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import {
  ERROR_CODE_RECOVERY,
  INTEGRATION_ERROR_CODES,
  type IntegrationCard,
  type IntegrationConnection,
  type TestConnectionResponse,
} from '@/hooks/integrations'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { Settings_Integrations_ProviderCard } from './Settings_Integrations_ProviderCard'

const REQUIRED = [
  'Read your email',
  'Send email as you',
  'See and add calendar events',
  'Know which account this is',
]

const CONNECTED: IntegrationConnection = {
  id: 'conn-1',
  provider: 'google',
  providerAccountId: 'acct-1',
  emailAddress: 'rep@acme.com',
  scopes: [],
  status: 'connected',
  errorCode: null,
  statusDetail: null,
  // Two minutes ago, so the card reads "Verified 2m ago".
  lastValidatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  lastRefreshAt: null,
  expiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function makeCard(connection: IntegrationConnection | null): IntegrationCard {
  return {
    provider: 'google',
    providerLabel: 'Google',
    requiredPermissions: REQUIRED,
    connection,
  }
}

function renderCard(connection: IntegrationConnection | null, onConnect = vi.fn()) {
  const result = renderWithProviders(
    <Settings_Integrations_ProviderCard card={makeCard(connection)} orgId="org-1" onConnect={onConnect} />,
  )
  return { ...result, onConnect }
}

beforeEach(() => {
  jsonFetch.mockReset()
  jsonFetch.mockResolvedValue(undefined)
})

describe('a provider that is not connected', () => {
  it('reads "Not connected" and offers exactly one Connect action', async () => {
    const { onConnect } = renderCard(null)

    expect(screen.getByText('Not connected')).toBeInTheDocument()
    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()

    await userEvent.click(connect)
    expect(onConnect).toHaveBeenCalledWith('connect')
  })

  it('keeps "Before you connect" collapsed until it is opened', async () => {
    renderCard(null)

    const googleWarning = /Google warns that this app is not verified/
    expect(screen.queryByText(googleWarning)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Before you connect/ }))
    expect(screen.getByText(googleWarning)).toBeInTheDocument()
  })
})

describe('a healthy connection', () => {
  it('shows Connected with a check, the address, and when it was verified', () => {
    const { container } = renderCard(CONNECTED)

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(container.querySelector('.lucide-check')).not.toBeNull()
    expect(screen.getByText('rep@acme.com')).toBeInTheDocument()
    expect(screen.getByText('Verified 2m ago')).toBeInTheDocument()
    // Test is the one primary action on a healthy card.
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument()
  })

  it('shows no timestamp when the connection was never validated', () => {
    renderCard({ ...CONNECTED, lastValidatedAt: null })
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument()
  })
})

describe('a partially-granted connection — the whole point of the card', () => {
  const LIMITED: IntegrationConnection = {
    ...CONNECTED,
    status: 'limited',
    errorCode: 'partial_access',
    statusDetail: 'Maincar cannot send email as you.',
    lastValidatedAt: null,
  }

  it('is amber, names the missing permission, and its primary button reads "Fix permissions"', async () => {
    const { container, onConnect } = renderCard(LIMITED)

    // The word carries the status, not the colour — and it is never the green word.
    expect(screen.getByText('Limited — missing permission')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    // The missing capability is named in the server's plain words.
    expect(screen.getByText('Maincar cannot send email as you.')).toBeInTheDocument()

    // A withheld scope is NEVER shown as a granted (green check): at rest nothing on a
    // limited card is marked granted, so no check icon is present at all.
    expect(container.querySelector('.lucide-check')).toBeNull()

    const fix = screen.getByRole('button', { name: 'Fix permissions' })
    await userEvent.click(fix)
    expect(onConnect).toHaveBeenCalledWith('fix')
  })

  it('renders a recovery block for the partial grant', () => {
    renderCard(LIMITED)
    expect(screen.getByText(ERROR_CODE_RECOVERY.partial_access.title)).toBeInTheDocument()
    expect(
      screen.getByText(ERROR_CODE_RECOVERY.partial_access.fixes[0]!),
    ).toBeInTheDocument()
  })
})

describe('a broken connection', () => {
  const ERRORED: IntegrationConnection = {
    ...CONNECTED,
    status: 'error',
    errorCode: 'token_revoked',
    statusDetail: 'The grant was revoked.',
  }

  it('is red with an alert icon and a Reconnect action', async () => {
    const { container, onConnect } = renderCard(ERRORED)

    expect(screen.getByText('Reconnect needed')).toBeInTheDocument()
    expect(container.querySelector('.lucide-circle-alert')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onConnect).toHaveBeenCalledWith('connect')
  })

  it.each(INTEGRATION_ERROR_CODES)('renders the recovery block for "%s"', (code) => {
    const { unmount } = renderCard({ ...ERRORED, errorCode: code })
    expect(screen.getByText(ERROR_CODE_RECOVERY[code].title)).toBeInTheDocument()
    expect(screen.getByText(ERROR_CODE_RECOVERY[code].fixes[0]!)).toBeInTheDocument()
    unmount()
  })

  it('still renders a recovery block for an error code the client has never seen', () => {
    // A code outside the closed set falls back to `unknown` rather than a blank card.
    renderCard({ ...ERRORED, errorCode: 'brand_new_code' as IntegrationConnection['errorCode'] })
    expect(screen.getByText(ERROR_CODE_RECOVERY.unknown.title)).toBeInTheDocument()
  })
})

describe('the Test result', () => {
  it('lists every capability, with the failed one named — never a bare "Test failed"', async () => {
    const response: TestConnectionResponse = {
      result: {
        ok: false,
        detail: 'One capability failed.',
        errorCode: 'partial_access',
        capabilities: [
          { capability: 'read_email', label: 'Read your email', ok: true, reason: '', errorCode: null },
          {
            capability: 'send_email',
            label: 'Send email as you',
            ok: false,
            reason: 'Google refused the send permission.',
            errorCode: 'partial_access',
          },
          {
            capability: 'calendar',
            label: 'See and add calendar events',
            ok: true,
            reason: '',
            errorCode: null,
          },
        ],
        connection: null,
      },
    }
    jsonFetch.mockResolvedValue(response)

    renderCard(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))

    const panel = (await screen.findByText('Test result')).closest('div')!
    const list = within(panel)
    // All three capabilities are named, not a single flat verdict.
    expect(list.getByText('Read your email')).toBeInTheDocument()
    expect(list.getByText('See and add calendar events')).toBeInTheDocument()
    // The failed one carries its reason.
    expect(
      list.getByText(/Send email as you — Google refused the send permission\./),
    ).toBeInTheDocument()
  })
})

describe('disconnecting', () => {
  it('does nothing until the confirm dialog is accepted', async () => {
    renderCard(CONNECTED)

    // The dialog is not there until Disconnect is clicked.
    expect(screen.queryByText('Disconnect Google?')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByText('Disconnect Google?')).toBeInTheDocument()
    expect(screen.getByText(/Maincar stops reading rep@acme\.com\./)).toBeInTheDocument()
    // No request has gone out yet — the destructive call waits for confirmation.
    expect(jsonFetch).not.toHaveBeenCalled()

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }),
    )
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/conn-1', {
      method: 'DELETE',
    })
  })
})
