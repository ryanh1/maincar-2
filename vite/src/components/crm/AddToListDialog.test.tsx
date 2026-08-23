import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { AddToListDialog } from './AddToListDialog'

const bulkRecords = vi.hoisted(() => vi.fn())
const createList = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/crm', () => ({
  useBulkRecords: () => ({ mutateAsync: bulkRecords, isPending: false }),
  useCreateList: () => ({ mutateAsync: createList, isPending: false }),
  useGetLists: () => ({
    data: { lists: [{ id: 'list-1', name: 'Priority people', objectSlug: 'person', isArchived: false }] },
    isPending: false,
  }),
}))

describe('AddToListDialog', () => {
  beforeEach(() => {
    bulkRecords.mockReset()
    bulkRecords.mockResolvedValue({ affectedCount: 2 })
    createList.mockReset()
    createList.mockResolvedValue({ list: { id: 'list-2', name: 'New prospects', objectSlug: 'person' } })
  })

  it('adds the selected records to a compatible existing list', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithProviders(
      <AddToListDialog
        open
        onOpenChange={onOpenChange}
        orgId="org-1"
        object={{ id: 'person', slug: 'person', name: 'Person', namePlural: 'People' }}
        selection={{ mode: 'ids', ids: ['person-1', 'person-2'] }}
        selectedCount={2}
        onAdded={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'List' }))
    await user.click(screen.getByRole('option', { name: 'Priority people' }))
    await user.click(screen.getByRole('button', { name: 'Add to list' }))

    await waitFor(() => expect(bulkRecords).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      selection: { mode: 'ids', ids: ['person-1', 'person-2'] },
      action: { type: 'addToList', listId: 'list-1' },
    })))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates a list and adds an all-filtered selection to it', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <AddToListDialog
        open
        onOpenChange={vi.fn()}
        orgId="org-1"
        object={{ id: 'person', slug: 'person', name: 'Person', namePlural: 'People' }}
        selection={{ mode: 'filter', filter: { type: 'condition', field: 'city', operator: 'eq', value: 'Boston' } }}
        selectedCount={42}
        onAdded={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'New list' }))
    await user.type(screen.getByLabelText('List name'), 'New prospects')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    await waitFor(() => expect(createList).toHaveBeenCalledWith({ orgId: 'org-1', name: 'New prospects', objectSlug: 'person' }))
    await waitFor(() => expect(bulkRecords).toHaveBeenCalledWith(expect.objectContaining({
      selection: { mode: 'filter', filter: { type: 'condition', field: 'city', operator: 'eq', value: 'Boston' } },
      action: { type: 'addToList', listId: 'list-2' },
    })))
  })
})
