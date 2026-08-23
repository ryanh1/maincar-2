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
})
