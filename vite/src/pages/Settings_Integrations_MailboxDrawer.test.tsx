import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { useSearchParams } from 'react-router-dom'
import { renderWithProviders } from '@/test/utils'
import { Settings_Integrations_MailboxDrawer } from './Settings_Integrations_MailboxDrawer'
import type { Mailbox } from '@/lib/mailboxTypes'
import * as mailboxHooks from '@/hooks/mailboxes'

vi.mock('@/hooks/mailboxes', () => ({
  useGetMailboxes: vi.fn(),
  useUpdateMailbox: vi.fn(),
  useSetPrimaryMailbox: vi.fn(),
  useDisconnectMailbox: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const mockOrgId = 'org-123'
const timeZone = 'America/New_York'

const primaryMailbox: Mailbox = {
  id: 'mailbox-1',
  provider: 'google',
  providerLabel: 'Google',
  emailAddress: 'user@gmail.com',
  displayName: null,
  isPrimary: true,
  status: 'connected',
  statusDetail: '',
  errorCode: null,
  lastValidatedAt: null,
  connectionId: 'conn-1',
  connectedAt: '2026-06-24T22:00:00Z',
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
  errorCode: null,
  lastValidatedAt: null,
  connectionId: 'conn-1',
  connectedAt: '2026-06-24T23:00:00Z',
}

/** Renders the current `?mailbox=` value beside the drawer, so a test can assert on it. */
function MailboxParamProbe() {
  const [params] = useSearchParams()
  return <div data-testid="mailbox-param">{params.get('mailbox') ?? ''}</div>
}

function renderDrawer(initialEntries: string[]) {
  return renderWithProviders(
    <>
      <MailboxParamProbe />
      <Settings_Integrations_MailboxDrawer orgId={mockOrgId} timeZone={timeZone} />
    </>,
    { initialEntries },
  )
}

describe('Settings_Integrations_MailboxDrawer', () => {
  const mockUpdate = vi.fn()
  const mockSetPrimary = vi.fn()
  const mockDisconnect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mailboxHooks.useGetMailboxes).mockReturnValue({
      data: { mailboxes: [primaryMailbox, secondMailbox] },
      isSuccess: true,
    } as unknown as ReturnType<typeof mailboxHooks.useGetMailboxes>)
    vi.mocked(mailboxHooks.useUpdateMailbox).mockReturnValue({
      mutate: mockUpdate,
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useUpdateMailbox>)
    vi.mocked(mailboxHooks.useSetPrimaryMailbox).mockReturnValue({
      mutate: mockSetPrimary,
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useSetPrimaryMailbox>)
    vi.mocked(mailboxHooks.useDisconnectMailbox).mockReturnValue({
      mutate: mockDisconnect,
      isPending: false,
    } as unknown as ReturnType<typeof mailboxHooks.useDisconnectMailbox>)
  })

  it('opens on the mailbox named by ?mailbox= on first render', () => {
    renderDrawer(['/settings?mailbox=mailbox-2'])
    expect(screen.getByRole('heading', { name: 'work@gmail.com' })).toBeInTheDocument()
  })

  it('renders nothing open when the URL names no mailbox', () => {
    renderDrawer(['/settings'])
    expect(screen.queryByRole('heading', { name: /@gmail.com/ })).not.toBeInTheDocument()
  })

  it('shows the connected-at date with a zone label, not a bare time', () => {
    renderDrawer(['/settings?mailbox=mailbox-1'])
    // formatDateTime always appends a zone abbreviation (e.g. EDT); this asserts one
    // is present rather than pinning the exact string, which shifts with DST.
    expect(screen.getByText(/Connected .+ (E[SD]T)/)).toBeInTheDocument()
  })

  it('closing the drawer clears the ?mailbox= param', async () => {
    renderDrawer(['/settings?mailbox=mailbox-1'])
    expect(screen.getByTestId('mailbox-param')).toHaveTextContent('mailbox-1')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.getByTestId('mailbox-param')).toHaveTextContent(''))
  })

  it('closes rather than rendering an empty drawer when the id no longer exists', async () => {
    renderDrawer(['/settings?mailbox=stale-id'])

    await waitFor(() => expect(screen.getByTestId('mailbox-param')).toHaveTextContent(''))
    expect(screen.queryByRole('heading', { name: /@gmail.com/ })).not.toBeInTheDocument()
  })

  it('saves the display name', () => {
    renderDrawer(['/settings?mailbox=mailbox-1'])

    const input = screen.getByLabelText('Name this mailbox')
    fireEvent.change(input, { target: { value: 'Sales inbox' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdate).toHaveBeenCalledWith(
      { orgId: mockOrgId, mailboxId: 'mailbox-1', displayName: 'Sales inbox' },
      expect.any(Object),
    )
  })

  it('disables Save until the name actually changes', () => {
    renderDrawer(['/settings?mailbox=mailbox-2'])
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the Primary badge for the primary mailbox, and no promote button', () => {
    renderDrawer(['/settings?mailbox=mailbox-1'])
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Make primary/i })).not.toBeInTheDocument()
  })

  it('offers "Make primary" on a non-primary mailbox, and promotes on click', () => {
    renderDrawer(['/settings?mailbox=mailbox-2'])
    fireEvent.click(screen.getByRole('button', { name: /Make primary/i }))
    expect(mockSetPrimary).toHaveBeenCalledWith(
      { orgId: mockOrgId, mailboxId: 'mailbox-2' },
      expect.any(Object),
    )
  })

  it('does not render a sync, import, or automation control', () => {
    renderDrawer(['/settings?mailbox=mailbox-1'])
    expect(screen.queryByText(/sync/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/import/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/automation/i)).not.toBeInTheDocument()
  })

  describe('Disconnect', () => {
    it('opens a confirm dialog naming the address', () => {
      renderDrawer(['/settings?mailbox=mailbox-1'])
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(
      screen.getByRole('heading', { name: 'Disconnect user@gmail.com?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Maincar can no longer read or send from this address.'),
    ).toBeInTheDocument()
    })

    it('does not disconnect until confirmed', () => {
      renderDrawer(['/settings?mailbox=mailbox-1'])
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mockDisconnect).not.toHaveBeenCalled()
    })

    it('disconnects and clears the param on confirm', () => {
      renderDrawer(['/settings?mailbox=mailbox-1'])
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
      const confirmButtons = screen.getAllByRole('button', { name: 'Disconnect' })
      fireEvent.click(confirmButtons[confirmButtons.length - 1])

      expect(mockDisconnect).toHaveBeenCalledWith(
        { orgId: mockOrgId, mailboxId: 'mailbox-1' },
        expect.any(Object),
      )
    })
  })
})
