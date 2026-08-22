import { render, screen } from '@testing-library/react'

import { OptionChip } from './OptionChip'

describe('OptionChip', () => {
  it('shows the option label and its configured color indicator', () => {
    render(<OptionChip label="Qualified" color="#0E7490" />)

    expect(screen.getByText('Qualified')).toBeVisible()
    expect(screen.getByTestId('option-chip-color')).toHaveStyle({ backgroundColor: 'rgb(14, 116, 144)' })
  })
})
