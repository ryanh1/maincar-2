import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

import { RecordCount } from './RecordCount'

describe('RecordCount', () => {
  it('shows the total when the view is unfiltered', () => {
    renderWithProviders(<RecordCount filteredCount={42} isFiltered={false} totalCount={42} />)

    expect(screen.getByText('42 records')).toBeInTheDocument()
  })

  it('shows the filtered and total counts when a filter is active', () => {
    renderWithProviders(<RecordCount filteredCount={12} isFiltered totalCount={42} />)

    expect(screen.getByText('12 of 42')).toBeInTheDocument()
  })
})
