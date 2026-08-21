import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ComposerContextValue } from '@/components/composer/composerContext'
import { ComposerContext } from '@/components/composer/composerContext'
import type { BrokenConnection } from '@/lib/integrationTypes'
import { renderWithProviders } from '@/test/utils'

const { useAuthMock, jsonFetchMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  jsonFetchMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
// The switcher fetches orgs of its own, and none of that is what these tests are
// about. The Compose button above it is.
vi.mock('@/components/OrgSwitcher', () => ({ OrgSwitcher: () => <div>org switcher</div> }))
// The health badge reads GET …/health through the real useGetIntegrationHealth hook.
// Mocking `jsonFetch` — not the hook — keeps the hook's own `enabled: !!orgId` gate
// honest, so the "no org never fetches" test proves the query really does not fire.
vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>()
  return { ...actual, jsonFetch: jsonFetchMock }
})

import { Sidebar } from '@/components/Sidebar'

/** One broken (status='error') connection, the slim shape GET …/health returns. */
function brokenConnection(n: number): BrokenConnection {
  return {
    connectionId: `conn-${n}`,
    provider: 'google',
    providerLabel: 'Google',
    emailAddress: `rep${n}@acme.test`,
    errorCode: 'token_revoked',
    detail: 'Reconnect to restore access.',
  }
}

const ORG = { id: 'org-1', name: 'Acme' }

/**
 * @param width the viewport, because Compose is desktop-only. 1440 is a laptop.
 * @param withComposer false renders the sidebar outside `ComposerProvider`,
 *   which is what a page test that only wants the nav rows does.
 */
function renderSidebar({
  width = 1440,
  withComposer = true,
}: { width?: number; withComposer?: boolean } = {}) {
  window.innerWidth = width

  const openComposer = vi.fn().mockResolvedValue(null)
  const value = { openComposer } as unknown as ComposerContextValue

  const sidebar = <Sidebar open={false} onClose={vi.fn()} />

  renderWithProviders(
    withComposer ? (
      <ComposerContext.Provider value={value}>{sidebar}</ComposerContext.Provider>
    ) : (
      sidebar
    ),
  )

  return { openComposer }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({
    user: { firstName: 'Ann', lastName: 'Ray', email: 'ann@acme.test' },
    signOut: vi.fn(),
  })
  // Default: nothing broken. Tests that want a badge override this.
  jsonFetchMock.mockResolvedValue({ broken: [] })
})

/** Sign in with an active org, so the health query is enabled. */
function withOrg() {
  useAuthMock.mockReturnValue({
    user: { firstName: 'Ann', lastName: 'Ray', email: 'ann@acme.test' },
    signOut: vi.fn(),
    org: ORG,
  })
}

describe('Sidebar', () => {
  it('opens a composer when the rep clicks Compose', async () => {
    const user = userEvent.setup()
    const { openComposer } = renderSidebar()

    await user.click(screen.getByRole('button', { name: 'Compose' }))

    expect(openComposer).toHaveBeenCalledTimes(1)
  })

  it('names the c shortcut in the tooltip, so the hotkey is discoverable', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.hover(screen.getByRole('button', { name: 'Compose' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Press c to compose.')
  })

  it('hides Compose below lg, where there is no dock to open a card into', () => {
    renderSidebar({ width: 375 })

    expect(screen.queryByRole('button', { name: 'Compose' })).not.toBeInTheDocument()
    // The nav the drawer exists for is still there.
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
  })

  it('hides Compose outside the composer provider, rather than draw a dead button', () => {
    renderSidebar({ withComposer: false })

    expect(screen.queryByRole('button', { name: 'Compose' })).not.toBeInTheDocument()
  })
})

describe('Sidebar broken-connection badge', () => {
  it('shows the count beside Settings when a connection is broken', async () => {
    withOrg()
    jsonFetchMock.mockResolvedValue({ broken: [brokenConnection(1)] })
    renderSidebar()

    const badge = await screen.findByRole('link', {
      name: 'Reconnect 1 broken email connection in Integrations.',
    })
    expect(badge).toHaveTextContent('1')
  })

  it('counts every broken connection and links to the Integrations tab', async () => {
    withOrg()
    jsonFetchMock.mockResolvedValue({ broken: [brokenConnection(1), brokenConnection(2)] })
    renderSidebar()

    const badge = await screen.findByRole('link', {
      name: 'Reconnect 2 broken email connections in Integrations.',
    })
    expect(badge).toHaveTextContent('2')
    // Clicking it lands on the Integrations tab, not the default Settings tab.
    expect(badge).toHaveAttribute('href', '/settings?tab=integrations')
  })

  it('names the problem in the accessible label, never a bare number', async () => {
    withOrg()
    jsonFetchMock.mockResolvedValue({ broken: [brokenConnection(1)] })
    renderSidebar()

    // The badge's accessible name says what is wrong and what to do — a screen
    // reader hearing only "1" would learn nothing.
    const badge = await screen.findByRole('link', { name: /reconnect .* broken .* integrations/i })
    expect(badge).toHaveAccessibleName('Reconnect 1 broken email connection in Integrations.')
  })

  it('shows no badge when nothing is broken', async () => {
    withOrg()
    jsonFetchMock.mockResolvedValue({ broken: [] })
    renderSidebar()

    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  it('shows no badge for a deliberately limited connection', async () => {
    withOrg()
    // The health endpoint returns only status='error' rows, so a limited-only org
    // yields an empty list — the badge must stay silent to stay trustworthy.
    jsonFetchMock.mockResolvedValue({ broken: [] })
    renderSidebar()

    await waitFor(() => expect(jsonFetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  it('never fires the health query without an active org', () => {
    // Default useAuth has no org.
    renderSidebar()

    expect(jsonFetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /reconnect/i })).not.toBeInTheDocument()
  })
})
