import { GridCellKind } from '@glideapps/glide-data-grid'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import { ChipCellEditor } from './ChipCellEditor'
import type { ChipCell } from './chipCell'

function chipCell(overrides: Partial<ChipCell['data']> = {}): ChipCell {
  return {
    kind: GridCellKind.Custom,
    data: {
      kind: 'chip-cell',
      options: [
        { value: 'open', label: 'Open', color: 'option-1' },
        { value: 'closed', label: 'Closed', color: 'option-2', isArchived: true },
      ],
      selectedValues: [],
      isMulti: false,
      cellReadonly: false,
      ...overrides,
    },
    allowOverlay: true,
    readonly: false,
  }
}

describe('ChipCellEditor', () => {
  it('hides archived options from the picker (archive keeps historic rendering)', () => {
    render(<ChipCellEditor value={chipCell()} onChange={vi.fn()} onFinishedEditing={vi.fn()} />)

    expect(screen.getByRole('option', { name: /Open/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Closed/ })).not.toBeInTheDocument()
  })

  it('resolves a muted token to a CSS var for the swatch', () => {
    render(<ChipCellEditor value={chipCell()} onChange={vi.fn()} onFinishedEditing={vi.fn()} />)

    const swatch = screen.getByRole('option', { name: /Open/ }).querySelector('span')
    expect(swatch).toHaveStyle({ backgroundColor: 'var(--option-1)' })
  })
})
