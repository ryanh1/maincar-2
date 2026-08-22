import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'
import { TimelineFilters } from './TimelineFilters'

describe('TimelineFilters', () => {
  it('changes the controlled source type without replacing the contact or deal selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <TimelineFilters
        value={{ personId: 'person-1', dealId: 'deal-1' }}
        onChange={onChange}
        people={[{ id: 'person-1', label: 'Ada Lovelace' }]}
        deals={[{ id: 'deal-1', label: 'Enterprise renewal' }]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Activity type' }))
    await user.click(screen.getByRole('option', { name: 'Calls' }))
    expect(onChange).toHaveBeenCalledWith({ sourceType: 'call', personId: 'person-1', dealId: 'deal-1' })
  })
})
