// What the tab must never get wrong, and what these tests hold it to:
//
//   - The popup is opened synchronously inside the click. A blocked popup toasts the
//     "allow pop-ups" line and leaves NO card spinning.
//   - A `message` is trusted only from the app's own origin. A foreign-origin message
//     is ignored — no toast, no refetch.
//   - A same-origin success message refetches the cards and toasts.
//   - The rep closing the popup by hand clears the busy state (a 500 ms poll), so a
//     card can never spin forever.
//   - Loading renders a skeleton, not a spinner on an empty page.
//   - The listener is removed on unmount.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { ApiError } from '@/lib/api'
import type { GetIntegrationsResponse, IntegrationCard } from '@/hooks/integrations'

const { jsonFetch, useAuthMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  jsonFetch: vi.fn(),
  useAuthMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})
vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_IntegrationsTab } from './Settings_IntegrationsTab'
import { OAUTH_MESSAGE_TYPE } from '@/hooks/integrations'

const ORG = { id: 'org-1', name: 'Acme' }
const LIST_URL = '/api/integrations/orgs/org-1'
const GOOGLE_AUTHORIZE_URL = '/api/integrations/orgs/org-1/google/authorize'

function card(provider: 'google' | 'microsoft', label: string, shortName: string): IntegrationCard {
  return {
    provider,
    providerLabel: label,
    providerShortName: shortName,
    requiredPermissions: ['Read your email', 'Send email as you'],
    connection: null,
  }
}

const TWO_PROVIDERS: GetIntegrationsResponse = {
  integrations: [
    card('google', 'Google Workspace', 'Google'),
    card('microsoft', 'Microsoft 365', 'Microsoft'),
  ],
}

/** Route jsonFetch by URL, so the GET list and the POST authorize each get their own answer. */
function routeFetch(handlers: {
  list?: () => Promise<unknown>
  authorize?: () => Promise<unknown>
}) {
  jsonFetch.mockImplementation((input: string) => {
    if (input === LIST_URL) return (handlers.list ?? (() => Promise.resolve(TWO_PROVIDERS)))()
    if (input === GOOGLE_AUTHORIZE_URL) {
      return (handlers.authorize ?? (() => Promise.resolve({ url: 'https://consent.example' })))()
    }
    return Promise.resolve(undefined)
  })
}

function successMessage() {
  return {
    type: OAUTH_MESSAGE_TYPE,
    provider: 'google' as const,
    ok: true,
    status: 'connected' as const,
    errorCode: null,
    statusDetail: '',
    emailAddress: 'rep@acme.com',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, isAdmin: true })
  routeFetch({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rendering the cards', () => {
  it('renders one card per provider from the server list', async () => {
    renderWithProviders(<Settings_IntegrationsTab />)

    expect(await screen.findByText('Google Workspace')).toBeInTheDocument()
    expect(screen.getByText('Microsoft 365')).toBeInTheDocument()
    // Each unconnected card offers exactly one Connect.
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2)
    expect(screen.getAllByText('Not connected')).toHaveLength(2)
  })

  it('renders nothing for a user with no active org', () => {
    useAuthMock.mockReturnValue({ org: null, isAdmin: false })
    const { container } = renderWithProviders(<Settings_IntegrationsTab />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a skeleton while loading, not a spinner on an empty page', () => {
    // A list request that never settles, so the tab stays in its loading state.
    routeFetch({ list: () => new Promise(() => {}) })
    const { container } = renderWithProviders(<Settings_IntegrationsTab />)

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByText('Google Workspace')).not.toBeInTheDocument()
  })

  it('renders the server message and a retry when the list fails', async () => {
    routeFetch({ list: () => Promise.reject(new ApiError('Our servers had a problem.', 500)) })
    renderWithProviders(<Settings_IntegrationsTab />)

    expect(await screen.findByText('Our servers had a problem.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('the popup consent flow', () => {
  it('toasts and leaves no card busy when the popup is blocked', async () => {
    // A blocked popup: window.open returns null.
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderWithProviders(<Settings_IntegrationsTab />)

    const google = (await screen.findByText('Google Workspace')).closest('div.rounded-md') as HTMLElement
    await userEvent.click(within(google).getByRole('button', { name: 'Connect' }))

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Allow pop-ups for this site, then click Connect again.',
    )
    // No spinner: the button never flips to "Connecting…", and no authorize call went out.
    expect(within(google).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(jsonFetch).not.toHaveBeenCalledWith(GOOGLE_AUTHORIZE_URL, expect.anything())
  })

  it('opens the popup and points it at the authorize URL the server returns', async () => {
    const popup = { closed: false, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    renderWithProviders(<Settings_IntegrationsTab />)

    const google = (await screen.findByText('Google Workspace')).closest('div.rounded-md') as HTMLElement
    await userEvent.click(within(google).getByRole('button', { name: 'Connect' }))

    // Opened synchronously with an empty URL, then navigated after the server answers.
    expect(open).toHaveBeenCalledWith('', expect.any(String), expect.any(String))
    await waitFor(() => expect(popup.location.href).toBe('https://consent.example'))
  })

  it('ignores a message from a foreign origin', async () => {
    renderWithProviders(<Settings_IntegrationsTab />)
    await screen.findByText('Google Workspace')
    jsonFetch.mockClear()

    window.dispatchEvent(
      new MessageEvent('message', { data: successMessage(), origin: 'https://evil.example' }),
    )

    // A foreign-origin message is neither trusted nor acted on.
    await Promise.resolve()
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(jsonFetch).not.toHaveBeenCalled()
  })

  it('refetches and toasts on a same-origin success message', async () => {
    renderWithProviders(<Settings_IntegrationsTab />)
    await screen.findByText('Google Workspace')
    jsonFetch.mockClear()

    window.dispatchEvent(
      new MessageEvent('message', { data: successMessage(), origin: window.location.origin }),
    )

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Connected rep@acme.com.'))
    // Invalidation refetches the card list.
    await waitFor(() => expect(jsonFetch).toHaveBeenCalledWith(LIST_URL))
  })

  it('clears the busy state when the rep closes the popup by hand', async () => {
    const popup = { closed: false, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    renderWithProviders(<Settings_IntegrationsTab />)

    const google = (await screen.findByText('Google Workspace')).closest('div.rounded-md') as HTMLElement
    await userEvent.click(within(google).getByRole('button', { name: 'Connect' }))

    // The card is busy while the popup is open.
    await waitFor(() =>
      expect(within(google).getByRole('button', { name: 'Connecting…' })).toBeInTheDocument(),
    )

    // The rep closes the window. The 500 ms poll catches it and clears the busy state.
    popup.closed = true
    await waitFor(
      () => expect(within(google).getByRole('button', { name: 'Connect' })).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })

  it('removes the message listener on unmount', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderWithProviders(<Settings_IntegrationsTab />)
    await screen.findByText('Google Workspace')

    unmount()
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
