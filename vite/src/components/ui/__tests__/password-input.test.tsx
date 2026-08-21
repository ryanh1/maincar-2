import type * as React from 'react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PasswordInput } from '@/components/ui/password-input'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE } from '@/lib/passwordPolicy'

/**
 * The TooltipProvider stands in for the one App.tsx mounts at the root. The eye
 * toggle owes a tooltip like every other icon-only control, and Radix throws
 * without a provider above it.
 */
function Harness({ showRequirement = false }: { showRequirement?: boolean }) {
  const [value, setValue] = useState('')
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="pw">Password</label>
      <PasswordInput
        id="pw"
        showRequirement={showRequirement}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit">Submit</button>
    </form>
  )
}

function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('PasswordInput', () => {
  it('flips the field between masked and readable, and renames itself as it goes', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')

    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(field).toHaveAttribute('type', 'text')
    const hide = screen.getByRole('button', { name: 'Hide password' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')

    await user.click(hide)
    expect(field).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
  })

  // A bare <button> inside a form submits it, which would sign the person in
  // the moment they tried to look at what they typed.
  it('never submits the form it sits in', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('type', 'button')
  })

  it('is reachable from the keyboard, one Tab past the field, and lets Tab out again', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.tab()
    expect(screen.getByLabelText('Password')).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveFocus()
  })

  it('states the rule before anything is typed, and links it to the field', async () => {
    const user = userEvent.setup()
    render(<Harness showRequirement />)

    const rule = screen.getByText(PASSWORD_RULE)
    expect(rule).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', 'pw-rule')
    expect(rule).toHaveAttribute('id', 'pw-rule')

    // Met and unmet are not colour alone — the class changes and a tick appears.
    expect(rule.className).toContain('text-muted-foreground')
    await user.type(screen.getByLabelText('Password'), 'x'.repeat(PASSWORD_MIN_LENGTH))
    expect(screen.getByText(PASSWORD_RULE).className).toContain('text-status-success')
  })

  it('says nothing about the rule on a screen that only asks for an existing password', () => {
    render(<Harness />)
    expect(screen.queryByText(PASSWORD_RULE)).not.toBeInTheDocument()
  })
})
