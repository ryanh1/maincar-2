import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EmailDraft } from '@/lib/emailTypes'
import { ComposerCard } from './ComposerCard'
import { ComposerContext, type ComposerContextValue } from './composerContext'

/**
 * The card renders the real `RichTextEditor`, and ProseMirror measures the
 * document with `Range.getClientRects` whenever it maps a selection back to the
 * DOM. jsdom implements neither, and without them the editor throws on the first
 * click instead of failing a real assertion. The same stubs, for the same
 * reason, as `RichTextEditor.test.tsx` — kept local to each file rather than in
 * `src/test/setup.ts`, because a global stub is a global lie about what jsdom
 * can do.
 *
 * The editor is deliberately NOT mocked here. What this file has to prove is
 * that the card wires the real one correctly — that a save response cannot reach
 * it, and that what leaves on a PATCH is what the rep actually sees — and a stub
 * that echoes whatever it is handed proves none of that.
 */
beforeAll(() => {
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  }
  if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  }
})

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

/** The editable region, as a screen reader finds it. */
function bodyField() {
  return screen.getByRole('textbox', { name: 'Message' })
}

/**
 * `fireEvent`, not `userEvent`: userEvent's own timer plumbing deadlocks against
 * vitest's fake clock, and a change event is exactly what a keystroke produces.
 */
function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } })
}

/**
 * Write into the body the way a rep does, without `userEvent`.
 *
 * ProseMirror owns its DOM, so there is no `value` to set — it watches for
 * mutations and reads the document back out of them. Mutating the editable
 * element and firing `input` is exactly the sequence a keystroke or a paste
 * produces, and it is the only one that survives the fake clock these autosave
 * tests run on: `userEvent` deadlocks against it, and reaching past the
 * component for the editor instance would test something no rep can do.
 *
 * `html`, not text, because a paste is the interesting case — see the tests that
 * hand it a heading and a `style` attribute.
 */
async function typeBody(html: string) {
  const body = bodyField()
  body.innerHTML = html
  fireEvent.input(body)
  // ProseMirror reads the mutation back and reports it upward a tick later, so
  // the awaited `act` is what lets the card's state — and with it the debounce
  // timer — exist before a test starts moving the clock.
  await act(async () => {})
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

    await typeBody('H')
    await typeBody('He')
    await typeBody('Hel')
    await typeBody('Hello')

    await advance(AUTOSAVE_DELAY_MS - 1)
    expect(saveDraft).not.toHaveBeenCalled()

    await advance(1)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    // Only the key that changed. The route writes exactly what it is given, so
    // sending the subject too would overwrite one the rep never touched.
    // HTML, not the raw keystrokes: the body is a rich-text document now, and
    // the editor's own paragraph is what is stored.
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: '<p>Hello</p>' })

    // And nothing more once it has settled.
    await advance(AUTOSAVE_DELAY_MS * 2)
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  it('sends the subject and the body together when both changed', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    type(subjectField(), 'Quote')
    await typeBody('Numbers attached.')
    await advance(AUTOSAVE_DELAY_MS)

    expect(saveDraft).toHaveBeenCalledWith('draft-1', {
      subject: 'Quote',
      bodyHtml: '<p>Numbers attached.</p>',
    })
  })

  it('flushes the pending save before it collapses to a chip', async () => {
    const { saveDraft, setMinimized } = renderCard()

    await typeBody('Half a sentence')
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))

    await waitFor(() => expect(setMinimized).toHaveBeenCalledWith('draft-1', true))
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: '<p>Half a sentence</p>' })
    // Order matters: collapsing first would unmount the card and take the text
    // with it.
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      setMinimized.mock.invocationCallOrder[0],
    )
  })

  it('closes with a save and never a delete', async () => {
    const { saveDraft, closeCard, discardDraft } = renderCard()

    await typeBody('Keep this')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(closeCard).toHaveBeenCalledWith('draft-1'))
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: '<p>Keep this</p>' })
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

    await typeBody('Never mind')
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(discardDraft).toHaveBeenCalledWith('draft-1'))
    // A failed DELETE resyncs the dock from the server, so the row that comes
    // back has to hold what the rep actually typed.
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bodyHtml: '<p>Never mind</p>' })
  })

  it('never re-reads its own saved value, so the caret cannot be moved by a save', async () => {
    const { rerenderWith } = renderCard()

    type(subjectField(), 'What the rep typed')
    await typeBody('A sentence still being written')

    // The save comes back and the dock's copy of the draft updates. The card
    // must ignore it completely: re-rendering the body here is what drops the
    // caret to the end mid-sentence.
    rerenderWith(
      makeDraft({ subject: 'The server copy', bodyHtml: 'An older, shorter sentence' }),
    )

    expect(subjectField()).toHaveValue('What the rep typed')
    // The editor has no `value` to read: what it holds is a document, so this
    // asserts on the text ProseMirror is actually showing.
    expect(bodyField()).toHaveTextContent('A sentence still being written')
    expect(bodyField()).not.toHaveTextContent('An older, shorter sentence')
  })

  it('opens a draft written as plain text before the editor landed', () => {
    // Every draft saved through EC-8's textarea is a bare string with no tags in
    // it. TipTap parses it as the text of one paragraph, so the rep sees their
    // sentence and not an empty card.
    renderCard(makeDraft({ bodyHtml: 'Numbers attached, call me back.' }))

    expect(bodyField()).toHaveTextContent('Numbers attached, call me back.')
  })

  it('saves the bold and the list the rep applied, not their plain text', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    await typeBody('<p>A <strong>bold</strong> word</p><ul><li>One</li><li>Two</li></ul>')
    await advance(AUTOSAVE_DELAY_MS)

    const [, patch] = saveDraft.mock.calls[0] as [string, { bodyHtml: string }]
    expect(patch.bodyHtml).toContain('<strong>bold</strong>')
    expect(patch.bodyHtml).toContain('<ul>')
    expect(patch.bodyHtml).toContain('<li>')
    expect(patch.bodyHtml).toContain('Two')
  })

  it('sends what the rep sees, with only the markup the server keeps', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    // What a paste out of a web page or a word processor arrives as. The rep
    // never sees the heading, the inline style, or the class — the editor's
    // schema drops all three as the paste lands — so the save must not carry
    // them either. That is the disagreement MAI-78 named: the server rewriting
    // a body the card would go on showing in its original form.
    await typeBody(
      '<h1 class="Title" style="color:red">Quote</h1>' +
        '<p style="margin:0">A <strong>bold</strong> word</p>' +
        '<script>alert(1)</script>',
    )
    await advance(AUTOSAVE_DELAY_MS)

    const [, patch] = saveDraft.mock.calls[0] as [string, { bodyHtml: string }]
    expect(patch.bodyHtml).not.toContain('<h1')
    expect(patch.bodyHtml).not.toContain('style=')
    expect(patch.bodyHtml).not.toContain('class=')
    expect(patch.bodyHtml).not.toContain('<script')
    // The rep's words survive. Losing a sentence because it was pasted out of a
    // heading would be its own bug.
    expect(patch.bodyHtml).toContain('Quote')
    expect(patch.bodyHtml).toContain('<strong>bold</strong>')
    // And the editor on screen agrees with the string that was sent, which is
    // the whole point: no reload needed to find out what was really stored.
    expect(bodyField()).toHaveTextContent('Quote')
    expect(bodyField().querySelector('h1')).toBeNull()
  })

  it('links the selection through the URL dialog and saves the anchor', async () => {
    const user = userEvent.setup()
    const { saveDraft } = renderCard(makeDraft({ bodyHtml: '<p>Acme</p>' }))

    bodyField().focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Add link' }))

    // No scheme typed, `https` stored — the rule lives in `linkUrl.ts`; what is
    // proven here is that the card wired the editor's request to the dialog at
    // all.
    await user.type(await screen.findByLabelText('Web address'), 'acme.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    // The X flushes on the way out, so no clock is needed to see the save.
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    const [, patch] = saveDraft.mock.calls[0] as [string, { bodyHtml: string }]
    expect(patch.bodyHtml).toContain('href="https://acme.com"')
    expect(patch.bodyHtml).toContain('rel="noopener noreferrer"')
    expect(patch.bodyHtml).toContain('Acme')
  })

  it('flushes on the way out when the dock squeezes the card into a chip', async () => {
    const { saveDraft, unmount } = renderCard()

    await typeBody('Squeezed mid-sentence')
    unmount()

    await waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith('draft-1', {
        bodyHtml: '<p>Squeezed mid-sentence</p>',
      }),
    )
  })

  it('flushes nothing on the way out when nothing was typed', async () => {
    const { saveDraft, unmount } = renderCard(makeDraft({ subject: 'Quote' }))

    unmount()
    await waitFor(() => expect(saveDraft).not.toHaveBeenCalled())
  })
})

/** The box you type the next address into, for whichever row. */
function recipientBox(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

/** Address someone the way a rep does: type it, press Enter. */
function addRecipient(label: string, address: string) {
  const box = recipientBox(label)
  fireEvent.change(box, { target: { value: address } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

/** Every chip on screen, in order, by the address its own `✕` names. */
function chipAddresses(): string[] {
  return screen
    .queryAllByRole('button', { name: /^Remove / })
    .map((button) => button.getAttribute('aria-label')!.replace(/^Remove /, ''))
}

function ccBccLink() {
  return screen.queryByRole('button', { name: 'Cc/Bcc' })
}

describe('ComposerCard recipients', () => {
  it('opens with To on screen and the caret already in it', () => {
    renderCard()

    expect(recipientBox('To')).toHaveFocus()
  })

  it('hides Cc and Bcc behind a link, and the link leaves once both rows are up', () => {
    renderCard()

    expect(screen.queryByLabelText('Cc')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bcc')).not.toBeInTheDocument()

    fireEvent.click(ccBccLink()!)

    expect(screen.getByLabelText('Cc')).toBeInTheDocument()
    expect(screen.getByLabelText('Bcc')).toBeInTheDocument()
    // Nothing left for it to reveal.
    expect(ccBccLink()).not.toBeInTheDocument()
  })

  it('shows both rows from the start when the draft already carries a Cc', () => {
    renderCard(makeDraft({ ccAddrs: ['bob@acme.test'] }))

    expect(screen.getByLabelText('Cc')).toBeInTheDocument()
    expect(screen.getByLabelText('Bcc')).toBeInTheDocument()
    expect(ccBccLink()).not.toBeInTheDocument()
    expect(chipAddresses()).toEqual(['bob@acme.test'])
  })

  it('shows both rows from the start for a Bcc-only draft', () => {
    renderCard(makeDraft({ bccAddrs: ['legal@acme.test'] }))

    expect(screen.getByLabelText('Cc')).toBeInTheDocument()
    expect(screen.getByLabelText('Bcc')).toBeInTheDocument()
    expect(ccBccLink()).not.toBeInTheDocument()
  })

  it('seeds every row from the draft it opened with', () => {
    renderCard(
      makeDraft({
        toAddrs: ['ann@acme.test'],
        ccAddrs: ['bob@acme.test'],
        bccAddrs: ['legal@acme.test'],
      }),
    )

    expect(chipAddresses()).toEqual(['ann@acme.test', 'bob@acme.test', 'legal@acme.test'])
  })

  it('rides the same debounce as the body, and sends only the field that changed', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    addRecipient('To', 'ann@acme.test')

    await advance(AUTOSAVE_DELAY_MS - 1)
    expect(saveDraft).not.toHaveBeenCalled()

    await advance(1)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { toAddrs: ['ann@acme.test'] })

    await advance(AUTOSAVE_DELAY_MS * 2)
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  it('sends To, Cc, Bcc, subject, and body in one save', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    addRecipient('To', 'ann@acme.test')
    fireEvent.click(ccBccLink()!)
    addRecipient('Cc', 'bob@acme.test')
    addRecipient('Bcc', 'legal@acme.test')
    type(subjectField(), 'Quote')
    await typeBody('Numbers attached.')

    await advance(AUTOSAVE_DELAY_MS)

    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(saveDraft).toHaveBeenCalledWith('draft-1', {
      subject: 'Quote',
      bodyHtml: '<p>Numbers attached.</p>',
      toAddrs: ['ann@acme.test'],
      ccAddrs: ['bob@acme.test'],
      bccAddrs: ['legal@acme.test'],
    })
  })

  it('saves the shorter list when Backspace removes a whole recipient', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard(
      makeDraft({ toAddrs: ['ann@acme.test', 'bob@acme.test'] }),
    )

    fireEvent.keyDown(recipientBox('To'), { key: 'Backspace' })
    await advance(AUTOSAVE_DELAY_MS)

    expect(chipAddresses()).toEqual(['ann@acme.test'])
    expect(saveDraft).toHaveBeenCalledWith('draft-1', { toAddrs: ['ann@acme.test'] })
  })

  it('saves nothing on the first render of a draft that already has recipients', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard(
      makeDraft({ toAddrs: ['ann@acme.test'], ccAddrs: ['bob@acme.test'] }),
    )

    await advance(AUTOSAVE_DELAY_MS * 3)

    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('renames the card as the first recipient changes', () => {
    renderCard(makeDraft({ subject: 'Quote' }))

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quote')

    addRecipient('To', 'ann@acme.test')

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quote — ann@acme.test')
  })

  it('never re-reads its own recipients, so a save response cannot drop a chip', () => {
    const { rerenderWith } = renderCard()

    addRecipient('To', 'ann@acme.test')

    // The save comes back and the dock's copy of the draft updates. The chips
    // must ignore it completely, for the same reason the body does: the rep may
    // have added another recipient while the request was in flight.
    rerenderWith(makeDraft({ toAddrs: ['stale@acme.test'] }))

    expect(chipAddresses()).toEqual(['ann@acme.test'])
  })

  it('flushes the recipients on the way out when the dock squeezes the card', async () => {
    const { saveDraft, unmount } = renderCard()

    addRecipient('To', 'ann@acme.test')
    unmount()

    await waitFor(() =>
      expect(saveDraft).toHaveBeenCalledWith('draft-1', { toAddrs: ['ann@acme.test'] }),
    )
  })

  it('keeps three recipient rows out of the body height, so the card stays 26rem', () => {
    renderCard(makeDraft({ ccAddrs: ['bob@acme.test'] }))

    // The card is a fixed height, so every row above the body has to refuse to
    // shrink and the body has to be the one that gives up the space.
    for (const label of ['To', 'Cc', 'Bcc']) {
      const row = recipientBox(label).closest('div.shrink-0')
      expect(row).not.toBeNull()
    }
    // The editor's own wrapper is what gives up the height, so the assertion
    // sits on it and not on the editable region inside it. The scroller is the
    // part that keeps a long email inside the card instead of pushing the
    // footer off the bottom.
    const scroller = bodyField().closest('.overflow-y-auto')
    expect(scroller).toHaveClass('min-h-0', 'flex-1')
    expect(scroller!.parentElement).toHaveClass('min-h-0', 'flex-1')
    expect(screen.getByRole('article', { name: 'New message' })).toHaveClass('h-[26rem]')
  })
})
