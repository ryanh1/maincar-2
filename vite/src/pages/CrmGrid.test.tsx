import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

const { getListEntriesMock, removeListEntryMock, updateListEntryMock, reorderListEntriesMock, createListAttributeMock } = vi.hoisted(() => ({
  getListEntriesMock: vi.fn(),
  removeListEntryMock: vi.fn(),
  updateListEntryMock: vi.fn(),
  reorderListEntriesMock: vi.fn(),
  createListAttributeMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({
  useAuth: () => ({ org: { id: 'org-1' } }),
}))

vi.mock('@/hooks/crm', () => ({
  useGetObjects: () => ({
    data: { objects: [{ id: 'person', slug: 'person', namePlural: 'People', icon: 'user', iconColor: 'option-1' }] },
  }),
  useGetLists: () => ({
    data: { lists: [{ id: 'list-1', name: 'Q3 targets' }] },
  }),
  useGetList: () => ({
    data: { list: { id: 'list-1', name: 'Q3 targets', objectSlug: 'person' } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetListEntries: () => getListEntriesMock(),
  useRemoveListEntry: () => ({ mutateAsync: removeListEntryMock, isPending: false }),
  useUpdateListEntry: () => ({ mutateAsync: updateListEntryMock, isPending: false }),
  useReorderListEntries: () => ({ mutateAsync: reorderListEntriesMock, isPending: false }),
  useCreateListAttribute: () => ({ mutateAsync: createListAttributeMock, isPending: false }),
  useGetObject: () => ({
    data: { object: { attributes: [] } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/components/crm/ListEntryGrid', () => ({
  ListEntryGrid: ({ entries, onRemoveEntry }: { entries: Array<{ id: string; target: Record<string, unknown> | null }>; onRemoveEntry: (entry: { id: string; target: Record<string, unknown> | null }) => void }) => (
    <button type="button" onClick={() => onRemoveEntry(entries[0]!)}>Remove Ada Lovelace from list</button>
  ),
}))

import { CrmGrid } from '@/pages/CrmGrid'

beforeEach(() => {
  getListEntriesMock.mockReturnValue({
    data: { pages: [{ entries: [], total: 0 }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  })
  removeListEntryMock.mockReset()
  updateListEntryMock.mockReset()
  reorderListEntriesMock.mockReset()
  createListAttributeMock.mockReset()
})

describe('CrmGrid', () => {
  it('renders the selected object as a grid', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/records/:objectSlug" element={<CrmGrid />} />
      </Routes>,
      { initialEntries: ['/records/person'] },
    )

    expect(screen.getByRole('grid', { name: 'People grid' })).toBeInTheDocument()
    expect(screen.getByText('0 records')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'People' }).parentElement?.querySelector('[data-icon-name="user"]')).not.toBeNull())
  })

  it('renders a truthful empty state for the selected list', () => {
    renderWithProviders(
      <Routes>
        <Route path="/lists/:listId" element={<CrmGrid />} />
      </Routes>,
      { initialEntries: ['/lists/list-1'] },
    )

    expect(screen.getByTestId('grid-workspace')).toHaveClass('flex-1', 'overflow-hidden')
    expect(screen.getByRole('region', { name: 'View bar' })).toHaveTextContent('0 records')
    expect(screen.getByRole('heading', { name: 'Q3 targets' })).toBeInTheDocument()
    expect(screen.getByText('No records are in this list.')).toBeInTheDocument()
  })

  it('confirms a member removal and leaves the target record intact', async () => {
    getListEntriesMock.mockReturnValue({
      data: { pages: [{ entries: [{ id: 'entry-1', target: { id: 'person-1', name: 'Ada Lovelace' } }], total: 1 }] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/lists/:listId" element={<CrmGrid />} />
      </Routes>,
      { initialEntries: ['/lists/list-1'] },
    )

    await user.click(await screen.findByRole('button', { name: 'Remove Ada Lovelace from list' }))

    expect(screen.getByRole('heading', { name: 'Remove Ada Lovelace from this list?' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace’s record will stay unchanged.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))

    expect(removeListEntryMock).toHaveBeenCalledWith({ orgId: 'org-1', listId: 'list-1', entryId: 'entry-1' })
  })
})
