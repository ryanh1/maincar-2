import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save changes</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save changes
      </Button>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  // House rule: every button carries a border, and a primary button's border
  // matches its fill (CLAUDE.md → UI Components → Buttons).
  it('always has a border, whichever variant is used', () => {
    render(
      <>
        <Button variant="default">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('border-primary')
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass(
      'border-secondary-foreground/20',
    )
    expect(screen.getByRole('button', { name: 'Outline' })).toHaveClass('border-input')
  })

  it('records the variant and size as data attributes, so they can be asserted on', () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveAttribute('data-variant', 'destructive')
    expect(button).toHaveAttribute('data-size', 'sm')
  })
})
