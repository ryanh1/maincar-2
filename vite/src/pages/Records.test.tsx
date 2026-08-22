import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

const { useGetObjectMock, useGetObjectsMock } = vi.hoisted(() => ({
  useGetObjectMock: vi.fn(),
  useGetObjectsMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({
  useAuth: () => ({ org: { id: 'org-1' } }),
}))

vi.mock('@/hooks/crm', () => ({
  useGetObject: useGetObjectMock,
  useGetObjects: useGetObjectsMock,
}))

vi.mock('@/components/crm/RecordGrid', () => ({
  RecordGrid: () => <div role="grid" aria-label="People grid" />,
}))

import { Records } from '@/pages/Records'

function object(overrides: Record<string, unknown> = {}) {
  return {
    id: 'person',
    slug: 'person',
    namePlural: 'People',
    isHidden: false,
    isArchived: false,
    capabilities: { list: true },
    attributes: [],
    ...overrides,
  }
}

function renderRecords(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/records/:slug" element={<Records />} />
    </Routes>,
    { initialEntries: [path] },
  )
}

describe('Records', () => {
  it('loads the supported object grid', () => {
    const person = object()
    useGetObjectsMock.mockReturnValue({ data: { objects: [person] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: { object: person }, isPending: false, isError: false, refetch: vi.fn() })

    renderRecords('/records/person')

    expect(screen.getByRole('grid', { name: 'People grid' })).toBeInTheDocument()
  })

  it.each([
    ['deferred', object({ id: 'email', slug: 'email', namePlural: 'Emails', capabilities: { list: false } })],
    ['hidden', object({ isHidden: true })],
    ['archived', object({ isArchived: true })],
  ])('shows %s objects as unavailable instead of rendering a grid', (_case, unavailable) => {
    useGetObjectsMock.mockReturnValue({ data: { objects: [unavailable] }, isPending: false, isError: false, refetch: vi.fn() })
    useGetObjectMock.mockReturnValue({ data: undefined, isPending: false, isError: false, refetch: vi.fn() })

    renderRecords(`/records/${unavailable.slug}`)

    expect(screen.getByText('This object is unavailable. Choose another object.')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(useGetObjectMock).toHaveBeenCalledWith('org-1', null)
  })
})
