import { describe, expect, it } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RefreshCw } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { TooltipProvider } from '@/components/ui/tooltip'

/** Stands in for the provider App.tsx mounts at the root. */
function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('IconButton', () => {
  it('gives the glyph an accessible name, so a screen reader is not left with an empty button', () => {
    render(
      <IconButton tooltip="Refresh the member list">
        <RefreshCw size={16} aria-hidden />
      </IconButton>,
    )

    expect(screen.getByRole('button', { name: 'Refresh the member list' })).toBeInTheDocument()
  })

  it('shows the same words on hover, because a sighted reader never hears the label', async () => {
    const user = userEvent.setup()
    render(
      <IconButton tooltip="Refresh the member list">
        <RefreshCw size={16} aria-hidden />
      </IconButton>,
    )

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name: 'Refresh the member list' }))

    // Radix renders the visible copy and a duplicate for the a11y tree, so more
    // than one node carries the text. What matters is that the visible one is up.
    const shown = await screen.findAllByText('Refresh the member list')
    expect(shown.length).toBeGreaterThan(0)
  })

  it('shows the same words on keyboard focus, so the hint is not mouse-only', async () => {
    const user = userEvent.setup()
    render(
      <IconButton tooltip="Revoke the invite for sam@acme.com">
        <RefreshCw size={16} aria-hidden />
      </IconButton>,
    )

    await user.tab()

    expect(screen.getByRole('button', { name: 'Revoke the invite for sam@acme.com' })).toHaveFocus()
    expect(
      (await screen.findAllByText('Revoke the invite for sam@acme.com')).length,
    ).toBeGreaterThan(0)
  })

  it('still explains itself when disabled, where a bare button would swallow the hover', async () => {
    const user = userEvent.setup()
    render(
      <IconButton disabled tooltip="Create a new invite link for sam@acme.com and cancel the old one">
        <RefreshCw size={16} aria-hidden />
      </IconButton>,
    )

    const button = screen.getByRole('button', {
      name: 'Create a new invite link for sam@acme.com and cancel the old one',
    })
    expect(button).toBeDisabled()

    // The wrapper span is the hover target; the disabled button itself has no
    // pointer events at all.
    await user.hover(button.parentElement as HTMLElement)
    expect(
      (
        await screen.findAllByText(
          'Create a new invite link for sam@acme.com and cancel the old one',
        )
      ).length,
    ).toBeGreaterThan(0)
  })

  it('cannot be rendered without a tooltip — the type checker refuses it', () => {
    // @ts-expect-error `tooltip` is required. Deleting it here must stay an
    // error: this line is the enforcement, and `npm run typecheck` fails if the
    // prop ever becomes optional.
    const missing = <IconButton />
    expect(missing).toBeTruthy()
  })
})
