import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'

import { renderWithProviders } from '@/test/utils'
import { RecordNoteComposer } from './RecordNoteComposer'

const mutateAsync = vi.hoisted(() => vi.fn())
const useCreateNote = vi.hoisted(() => vi.fn())
const useMentionSuggestions = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/crm', () => ({ useCreateNote }))
vi.mock('@/components/editor/useMentionSuggestions', () => ({ useMentionSuggestions }))
vi.mock('@/components/editor/RichTextEditor', () => ({
  RichTextEditor: ({ onReady }: { onReady: (actions: { getJSON: () => Record<string, unknown> }) => void }) => {
    useEffect(() => {
      onReady({ getJSON: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }) })
    }, [onReady])
    return <div aria-label="Note">Editor</div>
  },
}))

const object = {
  id: 'obj-company', slug: 'company', name: 'Company', namePlural: 'Companies', icon: null, iconColor: null,
  storage: 'table' as const, isStandard: true, isFirstClass: true, isGridCreateSupported: true,
  capabilities: { list: true }, isHidden: false, isArchived: false,
  createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
}
const record = { id: 'company-1', name: 'Acme', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' }

beforeEach(() => {
  mutateAsync.mockReset()
  mutateAsync.mockResolvedValue({ note: { id: 'note-1' } })
  useCreateNote.mockReturnValue({ mutateAsync, isPending: false, isError: false, error: null })
  useMentionSuggestions.mockReturnValue({ items: [] })
})

describe('RecordNoteComposer', () => {
  it('saves TipTap JSON and automatically links the note to its owning record', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RecordNoteComposer orgId="org-1" object={object} record={record} />)

    await user.click(screen.getByRole('button', { name: 'Save note' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      orgId: 'org-1',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      links: [{ object: 'company', id: 'company-1' }],
    })
  })
})
