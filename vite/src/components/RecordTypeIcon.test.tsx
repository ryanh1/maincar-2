import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/utils'

import { RecordTypeIcon } from './RecordTypeIcon'

describe('RecordTypeIcon', () => {
  it('renders a configured Lucide icon after normalizing its name', async () => {
    renderWithProviders(<RecordTypeIcon icon="Building2" data-testid="object-icon" />)

    await waitFor(() => expect(screen.getByTestId('object-icon')).toHaveAttribute('data-icon-name', 'building-2'))
  })

  it('falls back safely when the configured icon is missing or invalid', () => {
    const { rerender } = renderWithProviders(<RecordTypeIcon icon="not-a-real-lucide-icon" data-testid="object-icon" />)
    expect(screen.getByTestId('object-icon')).toHaveAttribute('data-icon-name', 'database')

    rerender(<RecordTypeIcon icon={null} data-testid="object-icon" />)
    expect(screen.getByTestId('object-icon')).toHaveAttribute('data-icon-name', 'database')
  })

  it('uses the configured object color', () => {
    renderWithProviders(<RecordTypeIcon icon="user" color="option-3" data-testid="object-icon" />)

    expect(screen.getByTestId('object-icon')).toHaveStyle({ color: 'var(--option-3)' })
  })

  it.each([
    'building-2',
    'user',
    'circle-dollar-sign',
    'phone',
    'mail',
    'message-square',
    'calendar-clock',
    'square-check',
    'sticky-note',
  ])('supports the seeded %s record type icon', async (icon) => {
    renderWithProviders(<RecordTypeIcon icon={icon} data-testid="object-icon" />)

    await waitFor(() => expect(screen.getByTestId('object-icon')).toHaveAttribute('data-icon-name', icon))
  })
})
