import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/utils'

import { IconPicker } from './IconPicker'

describe('IconPicker', () => {
  it('searches Lucide icons, previews matches, and selects one', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderWithProviders(<IconPicker value="user" onValueChange={onValueChange} />)

    await user.click(screen.getByRole('combobox', { name: 'Icon' }))
    await user.type(screen.getByRole('combobox', { name: 'Search icons' }), 'building 2')

    const option = await screen.findByRole('option', { name: 'Building 2' })
    expect(option.querySelector('svg')).not.toBeNull()
    await user.click(option)

    expect(onValueChange).toHaveBeenCalledWith('building-2')
  })

  it('marks the current icon and icons assigned to other objects', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <IconPicker
        value="user"
        onValueChange={vi.fn()}
        assignments={[{ icon: 'building-2', objectName: 'Companies' }]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Icon' }))
    expect(screen.getByRole('option', { name: /User, selected/i })).toHaveAttribute('aria-selected', 'true')

    await user.type(screen.getByRole('combobox', { name: 'Search icons' }), 'building 2')
    expect(await screen.findByRole('option', { name: /Building 2, used by Companies/i })).toBeInTheDocument()
  })
})
