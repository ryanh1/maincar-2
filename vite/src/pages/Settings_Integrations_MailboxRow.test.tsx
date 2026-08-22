import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import {
  Settings_Integrations_MailboxRow,
  Settings_Integrations_MailboxList,
} from './Settings_Integrations_MailboxRow'
import type { Mailbox } from '@/lib/mailboxTypes'
import * as mailboxHooks from '@/hooks/mailboxes'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

// Mock the mailboxes hooks
vi.mock('@/hooks/mailboxes', () => ({
  useSetPrimaryMailbox: vi.fn(),
  useDisconnectMailbox: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const mockOrgId = 'org-123'

const connectedMailbox: Mailbox = {
  id: 'mailbox-1',
  provider: 'google',
  providerLabel: 'Google',
  emailAddress: 'user@gmail.com',
  displayName: null,
  isPrimary: true,
  status: 'connected',
  statusDetail: '',
  errorCode: null,
  lastValidatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  connectionId: 'conn-1',
  connectedAt: '2026-08-21T00:00:00Z',
}

const secondMailbox: Mailbox = {
  id: 'mailbox-2',
  provider: 'google',
  providerLabel: 'Google',
  emailAddress: 'work@gmail.com',
  displayName: 'Work inbox',
  isPrimary: false,
  status: 'connected',
  statusDetail: '',
  connectionId: 'conn-2',
  connectedAt: '2026-08-21T01:00:00Z',
}

const needsReconnect: Mailbox = {
  id: 'mailbox-3',
  provider: 'microsoft',
  providerLabel: 'Outlook',
  emailAddress: 'old@outlook.com',
  displayName: null,
  isPrimary: false,
  status: 'error',
  statusDetail: 'Needs reconnection',
  errorCode: 'token_revoked',
  lastValidatedAt: null,
  connectionId: 'conn-3',
  connectedAt: '2026-08-21T02:00:00Z',
}

describe('Settings_Integrations_MailboxRow', () => {
  const mockOnOpenSettings = vi.fn()
  const mockOnReconnect = vi.fn()
  const mockSetPrimary = vi.fn()
  const mockDisconnect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    jsonFetch.mockResolvedValue(undefined)
    vi.mocked(mailboxHooks.useSetPrimaryMailbox).mockReturnValue({
      mutate: mockSetPrimary,
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useSetPrimaryMailbox>)
    vi.mocked(mailboxHooks.useDisconnectMailbox).mockReturnValue({
      mutate: mockDisconnect,
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useDisconnectMailbox>)
  })

  describe('Single row rendering', () => {
    it('renders mailbox address when no display name', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      expect(screen.getByText('user@gmail.com')).toBeInTheDocument()
    })

    it('renders display name and address when display name exists', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={secondMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      expect(screen.getByText('Work inbox')).toBeInTheDocument()
      expect(screen.getByText('work@gmail.com')).toBeInTheDocument()
    })

    it('shows Primary badge on primary mailbox', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      expect(screen.getByText('Primary')).toBeInTheDocument()
    })

    it('shows the compact "Make primary" button on a non-primary mailbox', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={secondMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const button = screen.getByRole('button', { name: 'Make primary' })
      expect(button).toBeInTheDocument()
      expect(button).toHaveAttribute('data-size', 'xs')
    })

    it('shows connected status', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('shows the verification time within this mailbox sub-card', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )

      const mailboxCard = screen.getByRole('article', { name: 'Mailbox user@gmail.com' })
      expect(within(mailboxCard).getByText('Verified 2m ago')).toBeInTheDocument()
    })

    it('shows reconnect needed status', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={needsReconnect}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      expect(screen.getByText('Reconnect needed')).toBeInTheDocument()
    })
  })

  describe('Toolbar buttons', () => {
    it('shows settings button', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const settingsButton = screen.getByRole('button', { name: 'Open settings for user@gmail.com' })
      expect(settingsButton).toBeInTheDocument()
    })

    it('calls onOpenSettings when settings button clicked', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const settingsButton = screen.getByRole('button', { name: 'Open settings for user@gmail.com' })
      fireEvent.click(settingsButton)
      expect(mockOnOpenSettings).toHaveBeenCalledWith('mailbox-1')
    })

    it('does not show reconnect button on healthy mailbox', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const reconnectButton = screen.queryByRole('button', { name: /Reconnect/i })
      expect(reconnectButton).not.toBeInTheDocument()
    })

    it('shows reconnect button on broken mailbox', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={needsReconnect}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const reconnectButton = screen.getByRole('button', { name: /Reconnect/i })
      expect(reconnectButton).toBeInTheDocument()
    })

    it('calls onReconnect when reconnect button clicked', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={needsReconnect}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const reconnectButton = screen.getByRole('button', { name: /Reconnect/i })
      fireEvent.click(reconnectButton)
      expect(mockOnReconnect).toHaveBeenCalledWith(needsReconnect)
    })

    it('shows disconnect button', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const disconnectButton = screen.getByRole('button', { name: 'Disconnect user@gmail.com' })
      expect(disconnectButton).toBeInTheDocument()
    })

    it('tests this mailbox from the icon between Settings and Disconnect', async () => {
      jsonFetch.mockResolvedValue({
        result: {
          ok: true,
          detail: '',
          errorCode: null,
          capabilities: [
            { capability: 'read_email', label: 'Read your email', ok: true, reason: '', errorCode: null },
            { capability: 'send_email', label: 'Send email as you', ok: true, reason: '', errorCode: null },
            { capability: 'calendar', label: 'See and add calendar events', ok: true, reason: '', errorCode: null },
          ],
          connection: null,
        },
      })

      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )

      const mailboxCard = screen.getByRole('article', { name: 'Mailbox user@gmail.com' })
      const buttons = within(mailboxCard).getAllByRole('button')
      const settingsIndex = buttons.findIndex((button) => button.getAttribute('aria-label') === 'Open settings for user@gmail.com')
      const testIndex = buttons.findIndex((button) => button.getAttribute('aria-label') === 'Test user@gmail.com')
      const disconnectIndex = buttons.findIndex((button) => button.getAttribute('aria-label') === 'Disconnect user@gmail.com')
      expect(settingsIndex).toBeLessThan(testIndex)
      expect(testIndex).toBeLessThan(disconnectIndex)

      await userEvent.click(within(mailboxCard).getByRole('button', { name: 'Test user@gmail.com' }))
      expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-123/conn-1/test', {
        method: 'POST',
      })
      expect(await within(mailboxCard).findByText('Test result')).toBeInTheDocument()
      expect(within(mailboxCard).getByText('Read your email')).toBeInTheDocument()
    })

    it('replaces the Test icon with a spinner while the request is pending', async () => {
      let resolveTest: (value: undefined) => void
      jsonFetch.mockImplementationOnce(
        () => new Promise<undefined>((resolve) => {
          resolveTest = resolve
        }),
      )

      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )

      const testButton = screen.getByRole('button', { name: 'Test user@gmail.com' })
      await userEvent.click(testButton)

      expect(await screen.findByLabelText('Testing user@gmail.com')).toHaveClass('animate-spin')
      expect(screen.getByRole('button', { name: 'Test user@gmail.com' })).toBeDisabled()

      resolveTest!(undefined)
      await waitFor(() =>
        expect(screen.queryByLabelText('Testing user@gmail.com')).not.toBeInTheDocument(),
      )
    })
  })

  describe('Promote to primary', () => {
    it('calls useSetPrimaryMailbox when "Make primary" is clicked', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={secondMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const promoteButton = screen.getByRole('button', { name: 'Make primary' })
      fireEvent.click(promoteButton)
      expect(mockSetPrimary).toHaveBeenCalledWith(
        { orgId: mockOrgId, mailboxId: 'mailbox-2' },
        expect.any(Object),
      )
    })

    it('disables promote button while pending', () => {
      vi.mocked(mailboxHooks.useSetPrimaryMailbox).mockReturnValue({
        mutate: mockSetPrimary,
        isPending: true,
      } as unknown as ReturnType<typeof mailboxHooks.useSetPrimaryMailbox>)

      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={secondMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const promoteButton = screen.getByRole('button', { name: /Setting…/ })
      expect(promoteButton).toBeDisabled()
    })
  })

  describe('Disconnect', () => {
    it('opens alert dialog when disconnect clicked', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const disconnectButton = screen.getByRole('button', { name: 'Disconnect user@gmail.com' })
      fireEvent.click(disconnectButton)
      expect(screen.getByRole('heading', { name: /Disconnect/ })).toBeInTheDocument()
    })

    it('calls mutation when confirm clicked', async () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const disconnectButton = screen.getByRole('button', { name: 'Disconnect user@gmail.com' })
      fireEvent.click(disconnectButton)

      const confirmButton = screen.getByRole('button', { name: /Disconnect/ })
      fireEvent.click(confirmButton)

      expect(mockDisconnect).toHaveBeenCalledWith(
        { orgId: mockOrgId, mailboxId: 'mailbox-1' },
        expect.any(Object),
      )
    })

    it('does not call mutation when cancel clicked', () => {
      renderWithProviders(
        <Settings_Integrations_MailboxRow
          mailbox={connectedMailbox}
          orgId={mockOrgId}
          onOpenSettings={mockOnOpenSettings}
          onReconnect={mockOnReconnect}
        />,
      )
      const disconnectButton = screen.getByRole('button', { name: 'Disconnect user@gmail.com' })
      fireEvent.click(disconnectButton)

      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      fireEvent.click(cancelButton)

      expect(mockDisconnect).not.toHaveBeenCalled()
    })
  })
})

describe('Settings_Integrations_MailboxList', () => {
  const mockOnOpenSettings = vi.fn()
  const mockOnReconnect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    jsonFetch.mockResolvedValue(undefined)
    vi.mocked(mailboxHooks.useSetPrimaryMailbox).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useSetPrimaryMailbox>)
    vi.mocked(mailboxHooks.useDisconnectMailbox).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useDisconnectMailbox>)
  })

  it('renders all mailboxes', () => {
    renderWithProviders(
      <Settings_Integrations_MailboxList
        mailboxes={[connectedMailbox, secondMailbox]}
        orgId={mockOrgId}
        onOpenSettings={mockOnOpenSettings}
        onReconnect={mockOnReconnect}
      />,
    )
    expect(screen.getByText('user@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('Work inbox')).toBeInTheDocument()
  })

  it('shows exactly one Primary badge with two mailboxes', () => {
    renderWithProviders(
      <Settings_Integrations_MailboxList
        mailboxes={[connectedMailbox, secondMailbox]}
        orgId={mockOrgId}
        onOpenSettings={mockOnOpenSettings}
        onReconnect={mockOnReconnect}
      />,
    )
    const badges = screen.getAllByText('Primary')
    expect(badges).toHaveLength(1)
  })

  it('renders empty state when no mailboxes', () => {
    renderWithProviders(
      <Settings_Integrations_MailboxList
        mailboxes={[]}
        orgId={mockOrgId}
        onOpenSettings={mockOnOpenSettings}
        onReconnect={mockOnReconnect}
      />,
    )
    expect(screen.getByText(/Connect an account to send email from Maincar/i)).toBeInTheDocument()
  })

  it('empty state does not render a list', () => {
    const { container } = renderWithProviders(
      <Settings_Integrations_MailboxList
        mailboxes={[]}
        orgId={mockOrgId}
        onOpenSettings={mockOnOpenSettings}
        onReconnect={mockOnReconnect}
      />,
    )
    // Should be just a paragraph, not a div with flex gap-2 list
    const listContainer = container.querySelector('.flex.flex-col.gap-2')
    expect(listContainer).not.toBeInTheDocument()
  })
})
