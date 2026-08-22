import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

vi.mock('@/providers/useAuth', () => ({
  useAuth: () => ({ org: { id: 'org-1' } }),
}))

vi.mock('@/hooks/crm', () => ({
  useGetObjects: () => ({
    data: { objects: [{ id: 'person', slug: 'person', namePlural: 'People' }] },
  }),
  useGetLists: () => ({
    data: { lists: [{ id: 'list-1', name: 'Q3 targets' }] },
  }),
}))

import { CrmGrid } from '@/pages/CrmGrid'

describe('CrmGrid', () => {
  it('renders the selected object as a grid', () => {
    renderWithProviders(
      <Routes>
        <Route path="/records/:objectSlug" element={<CrmGrid />} />
      </Routes>,
      { initialEntries: ['/records/person'] },
    )

    expect(screen.getByRole('grid', { name: 'People grid' })).toBeInTheDocument()
    expect(screen.getByText('0 records')).toBeInTheDocument()
  })

  it('renders the selected list as a grid', () => {
    renderWithProviders(
      <Routes>
        <Route path="/lists/:listId" element={<CrmGrid />} />
      </Routes>,
      { initialEntries: ['/lists/list-1'] },
    )

    expect(screen.getByRole('grid', { name: 'Q3 targets grid' })).toBeInTheDocument()
  })
})
