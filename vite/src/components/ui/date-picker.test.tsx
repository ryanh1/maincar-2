import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DatePicker } from './date-picker'

describe('DatePicker', () => {
  it.each(['', 'dark'])('opens the tokenized popover in the %s theme', (theme) => {
    render(
      <div className={theme}>
        <DatePicker value={new Date(2026, 7, 24)} ariaLabel="Renewal date" />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Renewal date' }))

    expect(screen.getByRole('button', { name: /August 24th, 2026/ })).toBeVisible()
  })

  it('returns a selected calendar date without converting it to a timestamp', () => {
    const onChange = vi.fn()
    render(<DatePicker value={new Date(2026, 7, 24)} onChange={onChange} ariaLabel="Renewal date" />)

    fireEvent.click(screen.getByRole('button', { name: 'Renewal date' }))
    fireEvent.click(screen.getByRole('button', { name: /August 25th, 2026/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const selected = onChange.mock.calls[0][0] as Date
    expect([selected.getFullYear(), selected.getMonth(), selected.getDate()]).toEqual([2026, 7, 25])
  })
})
