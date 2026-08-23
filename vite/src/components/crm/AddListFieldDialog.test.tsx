import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

const create = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/crm', () => ({ useCreateListAttribute: () => ({ mutateAsync: create, isPending: false }) }))

import { AddListFieldDialog } from './AddListFieldDialog'

describe('AddListFieldDialog', () => {
  it('creates a list-scoped text field from the current list object', async () => {
    create.mockResolvedValue({ attribute: { id: 'priority' } })
    const user = userEvent.setup()
    renderWithProviders(<AddListFieldDialog open onOpenChange={vi.fn()} orgId="org-1" objectId="person" />)

    await user.type(screen.getByRole('textbox', { name: 'Field name' }), 'Priority')
    await user.click(screen.getByRole('button', { name: 'Add field' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      orgId: 'org-1', objectId: 'person', name: 'Priority', slug: 'priority', type: 'text',
    }))
  })
})
