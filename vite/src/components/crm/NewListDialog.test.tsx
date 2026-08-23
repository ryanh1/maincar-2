import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { NewListDialog } from './NewListDialog'

const createList = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/crm', () => ({
  useCreateList: () => ({ mutateAsync: createList, isPending: false }),
}))

describe('NewListDialog', () => {
  beforeEach(() => {
    createList.mockReset()
    createList.mockResolvedValue({ list: { id: 'list-1', name: 'Priority people', objectSlug: 'person' } })
  })

  it('creates a list for the fixed object and reports the new list', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()

    renderWithProviders(
      <NewListDialog
        open
        onOpenChange={onOpenChange}
        orgId="org-1"
        object={{ id: 'person', slug: 'person', name: 'Person', namePlural: 'People' }}
        onCreated={onCreated}
      />,
    )

    await user.type(screen.getByLabelText('List name'), 'Priority people')
    await user.click(screen.getByRole('button', { name: 'Create list' }))

    await waitFor(() => expect(createList).toHaveBeenCalledWith({ orgId: 'org-1', name: 'Priority people', objectSlug: 'person' }))
    expect(onCreated).toHaveBeenCalledWith({ id: 'list-1', name: 'Priority people', objectSlug: 'person' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
