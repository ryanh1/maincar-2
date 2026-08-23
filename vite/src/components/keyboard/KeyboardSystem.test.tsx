import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { KeyboardSystem } from '@/components/keyboard/KeyboardSystem'
import { renderWithProviders } from '@/test/utils'

describe('KeyboardSystem', () => {
  it('opens the command palette with Cmd-K and runs its selected action', async () => {
    const user = userEvent.setup()
    const openCalls = vi.fn()

    renderWithProviders(
      <KeyboardSystem
        commands={[
          {
            id: 'calls',
            title: 'Calls',
            group: 'Views',
            execute: openCalls,
          },
        ]}
      >
        <button type="button">Return focus here</button>
      </KeyboardSystem>,
    )

    await user.tab()
    await user.keyboard('{Meta>}k{/Meta}')

    await user.click(screen.getByRole('option', { name: 'Calls' }))

    expect(openCalls).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return focus here' })).toHaveFocus()
  })

  it('opens the shortcuts overlay only outside of a typing field', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <KeyboardSystem
        commands={[
          {
            id: 'compose',
            title: 'Compose email',
            group: 'Actions',
            shortcut: 'C',
            execute: vi.fn(),
          },
        ]}
      >
        <input aria-label="Search" />
      </KeyboardSystem>,
    )

    await user.click(screen.getByRole('textbox', { name: 'Search' }))
    await user.keyboard('?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()

    await user.tab()
    await user.keyboard('?')

    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByText('Compose email')).toBeInTheDocument()
  })

  it('opens the shortcuts overlay from the command palette', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <KeyboardSystem commands={[]}>
        <button type="button">Return focus here</button>
      </KeyboardSystem>,
    )

    await user.tab()
    await user.keyboard('{Meta>}k{/Meta}')
    await user.click(screen.getByRole('option', { name: /show keyboard shortcuts/i }))

    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('runs a modifier shortcut outside a typing field', async () => {
    const user = userEvent.setup()
    const openCalls = vi.fn()

    renderWithProviders(
      <KeyboardSystem commands={[{ id: 'compose', title: 'Compose email', group: 'Actions', shortcut: 'Ctrl+G', execute: openCalls }]} />,
    )

    await user.keyboard('{Control>}g{/Control}')

    expect(openCalls).toHaveBeenCalledOnce()
  })
})
