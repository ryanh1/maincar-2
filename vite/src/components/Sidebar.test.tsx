import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ComposerContextValue } from '@/components/composer/composerContext'
import { ComposerContext } from '@/components/composer/composerContext'
import { renderWithProviders } from '@/test/utils'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
// The switcher fetches orgs of its own, and none of that is what these tests are
// about. The Compose button above it is.
vi.mock('@/components/OrgSwitcher', () => ({ OrgSwitcher: () => <div>org switcher</div> }))

import { Sidebar } from '@/components/Sidebar'

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
})

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
