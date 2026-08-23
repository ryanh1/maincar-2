import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'

import { KeyboardProvider } from '@/components/keyboard/KeyboardProvider'
import { renderWithProviders } from '@/test/utils'

const { useAuthMock, openComposerMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  openComposerMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/components/composer/composerContext', () => ({ useComposer: () => ({ openComposer: openComposerMock }) }))
vi.mock('@/hooks/keyboardBindings', () => ({
  useGetKeyboardBindings: () => ({ data: { bindings: [{ actionId: 'compose-email', keys: 'G' }] } }),
}))

function LocationProbe() {
  const location = useLocation()
  return <p>{`${location.pathname}${location.search}`}</p>
}

describe('KeyboardProvider', () => {
  it('registers accessible settings destinations in the command palette', async () => {
    const user = userEvent.setup()
    useAuthMock.mockReturnValue({ org: { id: 'org-1' }, isAdmin: true })

    renderWithProviders(
      <KeyboardProvider>
        <LocationProbe />
      </KeyboardProvider>,
      { initialEntries: ['/home'] },
    )

    await user.keyboard('{Meta>}k{/Meta}')
    await user.click(screen.getByRole('option', { name: 'Phone numbers' }))

    expect(screen.getByText('/settings/numbers')).toBeInTheDocument()
  })

  it('registers Tasks as a keyboard-reachable view', async () => {
    const user = userEvent.setup()
    useAuthMock.mockReturnValue({ org: { id: 'org-1' }, isAdmin: false })

    renderWithProviders(
      <KeyboardProvider>
        <LocationProbe />
      </KeyboardProvider>,
      { initialEntries: ['/home'] },
    )

    await user.keyboard('{Meta>}k{/Meta}')
    await user.click(screen.getByRole('option', { name: 'Tasks' }))

    expect(screen.getByText('/tasks')).toBeInTheDocument()
  })

  it('uses a saved binding in both keyboard surfaces', async () => {
    const user = userEvent.setup()
    useAuthMock.mockReturnValue({ org: { id: 'org-1' }, isAdmin: true })

    renderWithProviders(
      <KeyboardProvider>
        <LocationProbe />
      </KeyboardProvider>,
      { initialEntries: ['/home'] },
    )

    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByRole('option', { name: /compose email/i })).toHaveTextContent('G')

    await user.click(screen.getByRole('option', { name: /show keyboard shortcuts/i }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveTextContent('Compose emailG')
  })
})
