import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import type { AttributeDef } from '@/lib/crmTypes'
import { GridAutocompleteOverlay } from './GridAutocompleteOverlay'
import { supportsGridAutocomplete } from './gridAutocomplete'

const useMentionSuggestions = vi.hoisted(() => vi.fn())
vi.mock('@/components/editor/useMentionSuggestions', () => ({ useMentionSuggestions }))

function attribute(overrides: Partial<AttributeDef> = {}): AttributeDef {
  return {
    id: 'note', objectId: 'object', slug: 'note', name: 'Note', description: null, icon: null,
    type: 'text', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null,
    isIdentity: false, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
    isReadOnly: false, isSystem: false, defaultJson: null, sortOrder: 0, isArchived: false,
    createdAt: '', updatedAt: '', ...overrides,
  }
}

describe('supportsGridAutocomplete', () => {
  beforeEach(() => {
    useMentionSuggestions.mockReset()
    useMentionSuggestions.mockReturnValue({
      isPending: false,
      items: [{ id: 'ada', label: 'Ada Lovelace', kind: 'teammate', detail: 'ada@example.com' }],
    })
  })

  it('enables the shared @ and slash picker only for rich-text-compatible fields', () => {
    expect(supportsGridAutocomplete('text', '@')).toBe(true)
    expect(supportsGridAutocomplete('note', '@')).toBe(true)
    expect(supportsGridAutocomplete('task', '/')).toBe(true)
    expect(supportsGridAutocomplete('text', '/')).toBe(true)
  })

  it('gates @date and option choices to their matching field types', () => {
    expect(supportsGridAutocomplete('date', '@')).toBe(true)
    expect(supportsGridAutocomplete('select', '@')).toBe(true)
    expect(supportsGridAutocomplete('status', '@')).toBe(true)
    expect(supportsGridAutocomplete('date', '/')).toBe(false)
    expect(supportsGridAutocomplete('select', '/')).toBe(false)
  })

  it('never opens over fields that cannot accept these interactions', () => {
    for (const type of ['number', 'checkbox', 'currency']) {
      expect(supportsGridAutocomplete(type, '@')).toBe(false)
      expect(supportsGridAutocomplete(type, '/')).toBe(false)
    }
  })

  it('filters and commits a mention from the shared resolver catalog', () => {
    const onCommit = vi.fn()
    render(
      <GridAutocompleteOverlay
        anchor={{ x: 12, y: 32, width: 160, height: 34 }}
        attribute={attribute()}
        orgId="org-1"
        trigger="@"
        onCommit={onCommit}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Search Note suggestions' }), { target: { value: 'lovelace' } })
    fireEvent.click(screen.getByRole('option', { name: /Ada Lovelace/ }))
    expect(onCommit).toHaveBeenCalledWith('@Ada Lovelace')
  })

  it('does not load the mention catalog for date or option-only overlays', () => {
    render(
      <GridAutocompleteOverlay
        anchor={{ x: 12, y: 32, width: 160, height: 34 }}
        attribute={attribute({ type: 'date', name: 'Due date' })}
        orgId="org-1"
        trigger="@"
        onCommit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(useMentionSuggestions).not.toHaveBeenCalled()
  })
})
