import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EmailDraft } from '@/lib/emailTypes'
import { ComposerCard } from './ComposerCard'
import { ComposerContext, type ComposerContextValue } from './composerContext'

/** Matches the constant in ComposerCard.tsx, which is deliberately not exported. */
const AUTOSAVE_DELAY_MS = 1200

function makeDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    mailAccountId: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: null,
    bodyHtml: null,
    isOpen: true,
    isMinimized: false,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

interface Stubs {
  saveDraft: ReturnType<typeof vi.fn>
  closeCard: ReturnType<typeof vi.fn>
  setMinimized: ReturnType<typeof vi.fn>
  discardDraft: ReturnType<typeof vi.fn>
}

/**
 * The card reads the composer state and never fetches, so a stubbed context is
 * the whole world it needs. Stubs rather than the real provider on purpose: what
 * these tests have to prove is WHICH call the card makes — `closeCard` is a save
 * and `discardDraft` is the only delete — and a stub says that in one assertion.
 */
function renderCard(draft: EmailDraft = makeDraft()) {
  const stubs: Stubs = {
    saveDraft: vi.fn().mockResolvedValue(undefined),
    closeCard: vi.fn().mockResolvedValue(undefined),
    setMinimized: vi.fn().mockResolvedValue(undefined),
    discardDraft: vi.fn().mockResolvedValue(undefined),
  }

  const value: ComposerContextValue = {
    drafts: [draft],
    openDrafts: [draft],
    keptDrafts: [],
    openComposer: vi.fn().mockResolvedValue(null),
    reopenCard: vi.fn().mockResolvedValue(undefined),
    ...stubs,
  }

  const view = render(
    <ComposerContext.Provider value={value}>
      <ComposerCard draft={draft} />
    </ComposerContext.Provider>,
  )

  return {
    ...stubs,
    unmount: view.unmount,
    /** Push a newer draft row at the card, the way a save response would. */
    rerenderWith: (next: EmailDraft) =>
      view.rerender(
        <ComposerContext.Provider value={value}>
          <ComposerCard draft={next} />
        </ComposerContext.Provider>,
      ),
  }
}

function subjectField() {
  return screen.getByLabelText('Re')
}

function bodyField() {
  return screen.getByLabelText('Message')
}

/**
 * `fireEvent`, not `userEvent`: userEvent's own timer plumbing deadlocks against
 * vitest's fake clock, and a change event is exactly what a keystroke produces.
 */
function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ComposerCard', () => {
  it('renders the Gmail card shape, flush to the bottom edge', () => {
    renderCard()

    const card = screen.getByRole('article', { name: 'New message' })
    expect(card).toHaveClass(
      'w-96',
      'h-[26rem]',
      'rounded-t-md',
      'border',
      'border-border',
      'bg-background',
      'shadow-md',
    )
    // A bottom radius or a bottom gap would stop it growing out of the edge.
    expect(card.className).not.toMatch(/rounded-b/)

    const header = screen.getByRole('heading', { level: 2 }).closest('header')
    expect(header).toHaveClass('h-8', 'bg-muted', 'border-b', 'border-border', 'px-2')
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('titles the card with the subject and the first recipient, and renames as the rep types', () => {
    renderCard(makeDraft({ subject: 'Quote', toAddrs: ['ann@acme.test'] }))

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quote — ann@acme.test')

    // The title reads the card's OWN subject, so it renames on the keystroke and
    // not a second later when the save comes back.
    type(subjectField(), 'Revised quote')

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Revised quote — ann@acme.test',
    )
  })

  it('renders Send disabled, saying what it is waiting on', () => {
    renderCard()

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(
      screen.getByText('Connect a mailbox in Settings → Integrations to send.'),
    ).toBeInTheDocument()
  })

  it('saves nothing on the first render, because opening a card is not editing it', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard(makeDraft({ subject: 'Quote', bodyHtml: 'Hello Ann' }))

    await advance(AUTOSAVE_DELAY_MS * 3)

    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('fires one save after the debounce, not one per keystroke', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    type(bodyField(), 'H')
    type(bodyField(), 'He')
    type(bodyField(), 'Hel')
    type(bodyField(), 'Hello')

    await advance(AUTOSAVE_DELAY_MS - 1)
    expect(saveDraft).not.toHaveBeenCalled()

    await advance(1)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    // Only the key that changed. The route writes exactly what it is given, so
    // sending the subject too would overwrite one the rep never touched.
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: 'Hello' })

    // And nothing more once it has settled.
    await advance(AUTOSAVE_DELAY_MS * 2)
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  it('sends the subject and the body together when both changed', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    type(subjectField(), 'Quote')
    type(bodyField(), 'Numbers attached.')
    await advance(AUTOSAVE_DELAY_MS)

    expect(saveDraft).toHaveBeenCalledWith('draft-1', {
      subject: 'Quote',
      bodyHtml: 'Numbers attached.',
    })
  })

  it('flushes the pending save before it collapses to a chip', async () => {
    const { saveDraft, setMinimized } = renderCard()

    type(bodyField(), 'Half a sentence')
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))

    await waitFor(() => expect(setMinimized).toHaveBeenCalledWith('draft-1', true))
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: 'Half a sentence' })
    // Order matters: collapsing first would unmount the card and take the text
    // with it.
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      setMinimized.mock.invocationCallOrder[0],
    )
  })

  it('closes with a save and never a delete', async () => {
    const { saveDraft, closeCard, discardDraft } = renderCard()

    type(bodyField(), 'Keep this')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(closeCard).toHaveBeenCalledWith('draft-1'))
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: 'Keep this' })
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      closeCard.mock.invocationCallOrder[0],
    )
    // The X keeps the draft. Only the trash can throws one away.
    expect(discardDraft).not.toHaveBeenCalled()
  })

  it('deletes nothing until the discard dialog is confirmed', async () => {
    const user = userEvent.setup()
    const { discardDraft } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Discard draft' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Discard this draft?')
    expect(discardDraft).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(discardDraft).not.toHaveBeenCalled()
  })

  it('discards on confirmation, flushing what was typed first', async () => {
    const user = userEvent.setup()
    const { saveDraft, discardDraft } = renderCard()

    type(bodyField(), 'Never mind')
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(discardDraft).toHaveBeenCalledWith('draft-1'))
    // A failed DELETE resyncs the dock from the server, so the row that comes
    // back has to hold what the rep actually typed.
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: 'Never mind' })
  })

  it('never re-reads its own saved value, so the caret cannot be moved by a save', () => {
    const { rerenderWith } = renderCard()

    type(subjectField(), 'What the rep typed')
    type(bodyField(), 'A sentence still being written')

    // The save comes back and the dock's copy of the draft updates. The card
    // must ignore it completely: re-rendering the body here is what drops the
    // caret to the end mid-sentence.
    rerenderWith(
      makeDraft({ subject: 'The server copy', bodyHtml: 'An older, shorter sentence' }),
    )

    expect(subjectField()).toHaveValue('What the rep typed')
    expect(bodyField()).toHaveValue('A sentence still being written')
  })

  it('flushes on the way out when the dock squeezes the card into a chip', async () => {
    const { saveDraft, unmount } = renderCard()

    type(bodyField(), 'Squeezed mid-sentence')
    unmount()

    await waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: 'Squeezed mid-sentence' }),
    )
  })

  it('flushes nothing on the way out when nothing was typed', async () => {
    const { saveDraft, unmount } = renderCard(makeDraft({ subject: 'Quote' }))

    unmount()
    await waitFor(() => expect(saveDraft).not.toHaveBeenCalled())
  })
})
