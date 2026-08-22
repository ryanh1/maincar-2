import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { EmailDraft } from '@/lib/emailTypes'
import { ComposerContext, type ComposerContextValue } from './composerContext'
import { ComposerDock } from './ComposerDock'

function draft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1', mailAccountId: null, recordObject: null, recordId: null, toAddrs: [], ccAddrs: [], bccAddrs: [], subject: null,
    bodyHtml: null, isOpen: true, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z', ...overrides,
  }
}

function renderDock(drafts: EmailDraft[], width = 1440, selectedDraftId: string | null = null) {
  window.innerWidth = width
  const value: ComposerContextValue = {
    drafts, openDrafts: drafts.filter((item) => item.isOpen), keptDrafts: drafts.filter((item) => !item.isOpen),
    openComposer: vi.fn(), saveDraft: vi.fn(), closeCard: vi.fn(), reopenCard: vi.fn(), discardDraft: vi.fn(),
  }
  const onHiddenDraftIdsChange = vi.fn()
  render(<ComposerContext.Provider value={value}><ComposerDock selectedDraftId={selectedDraftId} onHiddenDraftIdsChange={onHiddenDraftIdsChange} renderCard={(item) => <article>{item.subject}</article>} /></ComposerContext.Provider>)
  return { onHiddenDraftIdsChange }
}

describe('ComposerDock', () => {
  it('is absent when there are no visible active cards', () => {
    renderDock([])
    expect(screen.queryByRole('region', { name: 'Active email cards' })).not.toBeInTheDocument()
  })

  it('renders only open cards, from oldest at left to newest at right', () => {
    renderDock([draft({ id: 'saved', subject: 'Saved', isOpen: false }), draft({ id: 'old', subject: 'Old' }), draft({ id: 'new', subject: 'New' })], 2000)
    expect(screen.getAllByRole('article').map((item) => item.textContent)).toEqual(['Old', 'New'])
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('reports width-hidden drafts to the command bar and keeps the selected card visible', () => {
    const { onHiddenDraftIdsChange } = renderDock([draft({ id: 'old', subject: 'Old' }), draft({ id: 'selected', subject: 'Selected' })], 1204, 'old')
    expect(screen.getByRole('article')).toHaveTextContent('Old')
    expect(onHiddenDraftIdsChange).toHaveBeenLastCalledWith(['selected'])
  })

  it('does not render desktop cards on small screens', () => {
    const { onHiddenDraftIdsChange } = renderDock([draft()], 375)
    expect(screen.queryByRole('region', { name: 'Active email cards' })).not.toBeInTheDocument()
    expect(onHiddenDraftIdsChange).toHaveBeenLastCalledWith([])
  })
})
