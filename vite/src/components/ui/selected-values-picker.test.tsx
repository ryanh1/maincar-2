import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SelectedValuesPicker } from '@/components/ui/selected-values-picker'
import { renderWithProviders } from '@/test/utils'

const OPTIONS = [
  { value: 'CA', label: 'California' },
  { value: 'NY', label: 'New York' },
  { value: 'TX', label: 'Texas' },
]

describe('SelectedValuesPicker', () => {
  it('keeps selected values in the menu, selected first, without external remove controls', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SelectedValuesPicker label="Select states" options={OPTIONS} value={['NY']} onValueChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /select states/i }))

    const items = screen.getAllByRole('menuitemcheckbox')
    expect(items.map((item) => item.textContent)).toEqual(['New York', 'California', 'Texas'])
    expect(within(items[0]).getByText('New York')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove new york/i })).not.toBeInTheDocument()
  })

  it('filters choices and applies select all and clear all', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderWithProviders(<SelectedValuesPicker label="Select states" options={OPTIONS} value={['NY']} onValueChange={onValueChange} />)

    await user.click(screen.getByRole('button', { name: /select states/i }))
    await user.type(screen.getByRole('searchbox', { name: 'Search states' }), 'tex')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Texas' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'California' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Search states' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'California' }))
    expect(onValueChange).toHaveBeenLastCalledWith(['CA', 'NY'])

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onValueChange).toHaveBeenLastCalledWith(['CA', 'NY', 'TX'])

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onValueChange).toHaveBeenLastCalledWith([])
  })
})
