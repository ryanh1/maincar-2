import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { CrmListEntry } from '@/lib/crmTypes'

import { ListEntryReorderDialog } from './ListEntryReorderDialog'

const entries: CrmListEntry[] = [
  { id: 'entry-1', listId: 'list-1', objectSlug: 'person', targetId: 'person-1', values: {}, position: 0, addedByUserId: 'user-1', createdAt: '', updatedAt: '', target: { id: 'person-1', name: 'Ada' } },
  { id: 'entry-2', listId: 'list-1', objectSlug: 'person', targetId: 'person-2', values: {}, position: 1, addedByUserId: 'user-1', createdAt: '', updatedAt: '', target: { id: 'person-2', name: 'Grace' } },
]

describe('ListEntryReorderDialog', () => {
  it('saves the full membership order rather than writing record positions', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithProviders(<ListEntryReorderDialog open onOpenChange={vi.fn()} entries={entries} onSave={onSave} />)

    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Grace')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save order' }))

    expect(onSave).toHaveBeenCalledWith(['entry-1', 'entry-2'])
  })
})
