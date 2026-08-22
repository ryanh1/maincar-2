import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiError } from '@/lib/api'
import type { EmailDraft, EmailSignature, EmailTemplate } from '@/lib/emailTypes'
import type { Mailbox } from '@/lib/mailboxTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'

/**
 * The card reads several things beyond its own props: which org the rep is in,
 * that org's templates, that org's mailboxes (whether Send can fire at all),
 * and the send mutation itself. All are stubbed. What this file has to prove
 * is what the card DOES with them — which field a template lands in, when Send
 * is enabled, which call fires on a click — not that a query or a mutation
 * works, and a real one would make every test in here wait on a request it
 * does not care about.
 */
const {
  useAuthMock,
  useGetEmailTemplatesMock,
  useGetEmailSignaturesMock,
  useGetMailboxesMock,
  useSendEmailDraftMock,
  sendEmailDraftMock,
  toastSuccessMock,
  toastErrorMock,
  refetchMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetEmailTemplatesMock: vi.fn(),
  useGetEmailSignaturesMock: vi.fn(),
  useGetMailboxesMock: vi.fn(),
  useSendEmailDraftMock: vi.fn(),
  sendEmailDraftMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  refetchMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/email', () => ({
  useGetEmailTemplates: useGetEmailTemplatesMock,
  useGetEmailSignatures: useGetEmailSignaturesMock,
  useSendEmailDraft: useSendEmailDraftMock,
}))
vi.mock('@/hooks/mailboxes', () => ({ useGetMailboxes: useGetMailboxesMock }))
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }))

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

function makeTemplate(overrides: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    id: 'tpl-1',
    name: 'Discovery follow-up',
    subject: 'Great speaking with you',
    bodyHtml: '<p>Thanks for your time.</p>',
    createdById: 'user-a',
    fieldsJson: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

/** `useGetEmailTemplates`, in whichever state a test needs it. */
function templatesQuery(
  state: { templates?: EmailTemplate[]; isPending?: boolean; isError?: boolean } = {},
) {
  const { templates = [], isPending = false, isError = false } = state
  const settled = !isPending && !isError
  return {
    data: settled ? { templates, total: templates.length } : undefined,
    isPending,
    isError,
    isSuccess: settled,
    refetch: refetchMock,
  }
}

function signature(id: string, name: string, bodyHtml: string, isDefault = false): EmailSignature {
  return { id, name, bodyHtml, isDefault, createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z' }
}

function signaturesQuery(signatures: EmailSignature[] = []) {
  return { data: { signatures, total: signatures.length }, isPending: false, isError: false, isSuccess: true, refetch: refetchMock }
}

/** A connected send-from mailbox, the shape `useGetMailboxes` returns. */
function makeMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'box-1',
    provider: 'google',
    providerLabel: 'Google',
    emailAddress: 'rep@acme.test',
    displayName: null,
    isPrimary: true,
    status: 'connected',
    statusDetail: '',
    connectionId: 'conn-1',
    connectedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

/** `useGetMailboxes`, with no mailbox connected unless a test says otherwise. */
function mailboxesQuery(mailboxes: Mailbox[] = []) {
  return { data: { mailboxes }, isPending: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({
    org: { id: 'org-a', name: 'Acme Freight Co' },
    user: { id: 'user-a' },
  })
  useGetEmailTemplatesMock.mockReturnValue(templatesQuery())
  useGetEmailSignaturesMock.mockReturnValue(signaturesQuery())
  useGetMailboxesMock.mockReturnValue(mailboxesQuery())
  useSendEmailDraftMock.mockReturnValue({ mutateAsync: sendEmailDraftMock, isPending: false })
  sendEmailDraftMock.mockResolvedValue({
    message: { id: 'email-1', providerMsgId: 'p-1', threadId: null, sentAt: '2026-08-21T09:00:00.000Z' },
  })
})

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

  // One client, shared with `rerenderWith`, so a re-render stays a re-render and
  // does not rebuild the provider tree under the card. The providers themselves
  // are the ones `App.tsx` mounts: the footer's template button is an
  // `IconButton`, and Radix throws when a tooltip has no provider above it.
  const client = makeTestQueryClient()
  const card = (next: EmailDraft) => (
    <ComposerContext.Provider value={value}>
      <ComposerCard draft={next} />
    </ComposerContext.Provider>
  )

  const view = render(withProviders(card(draft), { client }))

  return {
    ...stubs,
    unmount: view.unmount,
    /** Push a newer draft row at the card, the way a save response would. */
    rerenderWith: (next: EmailDraft) => view.rerender(withProviders(card(next), { client })),
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
      'w-80',
      'h-96',
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

function addCcLink() {
  return screen.queryByRole('button', { name: 'Add Cc' })
}

function addBccLink() {
  return screen.queryByRole('button', { name: 'Add Bcc' })
}

describe('ComposerCard recipients', () => {
  it('opens with To on screen and the caret already in it', () => {
    renderCard()

    expect(recipientBox('To')).toHaveFocus()
  })

  it('hides Cc and Bcc behind two links, and picking one leaves only that row', () => {
    renderCard()

    expect(screen.queryByLabelText('Cc')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bcc')).not.toBeInTheDocument()

    fireEvent.click(addCcLink()!)

    expect(screen.getByLabelText('Cc')).toBeInTheDocument()
    expect(screen.queryByLabelText('Bcc')).not.toBeInTheDocument()
    // Mutually exclusive: neither link is left to reveal the other.
    expect(addCcLink()).not.toBeInTheDocument()
    expect(addBccLink()).not.toBeInTheDocument()
  })

  it('picking Add Bcc shows only the Bcc row', () => {
    renderCard()

    fireEvent.click(addBccLink()!)

    expect(screen.getByLabelText('Bcc')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cc')).not.toBeInTheDocument()
    expect(addCcLink()).not.toBeInTheDocument()
    expect(addBccLink()).not.toBeInTheDocument()
  })

  it('shows the Cc row from the start when the draft already carries a Cc', () => {
    renderCard(makeDraft({ ccAddrs: ['bob@acme.test'] }))

    expect(screen.getByLabelText('Cc')).toBeInTheDocument()
    expect(screen.queryByLabelText('Bcc')).not.toBeInTheDocument()
    expect(addCcLink()).not.toBeInTheDocument()
    expect(chipAddresses()).toEqual(['bob@acme.test'])
  })

  it('shows the Bcc row from the start for a Bcc-only draft', () => {
    renderCard(makeDraft({ bccAddrs: ['legal@acme.test'] }))

    expect(screen.getByLabelText('Bcc')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cc')).not.toBeInTheDocument()
    expect(addBccLink()).not.toBeInTheDocument()
  })

  it('seeds every visible row from the draft it opened with', () => {
    // Cc and Bcc are mutually exclusive on screen, so a draft carrying both
    // (from before this field became exclusive) shows only Cc — the field it
    // picks first. The Bcc chip stays in the draft's own data untouched; see
    // "shows the Cc row from the start" above for the exclusivity itself.
    renderCard(
      makeDraft({
        toAddrs: ['ann@acme.test'],
        ccAddrs: ['bob@acme.test'],
      }),
    )

    expect(chipAddresses()).toEqual(['ann@acme.test', 'bob@acme.test'])
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

  it('sends To, Cc, subject, and body in one save', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    addRecipient('To', 'ann@acme.test')
    fireEvent.click(addCcLink()!)
    addRecipient('Cc', 'bob@acme.test')
    type(subjectField(), 'Quote')
    await typeBody('Numbers attached.')

    await advance(AUTOSAVE_DELAY_MS)

    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(saveDraft).toHaveBeenCalledWith('draft-1', {
      subject: 'Quote',
      bodyHtml: '<p>Numbers attached.</p>',
      toAddrs: ['ann@acme.test'],
      ccAddrs: ['bob@acme.test'],
    })
  })

  it('sends Bcc instead of Cc when the rep picks Add Bcc', async () => {
    vi.useFakeTimers()
    const { saveDraft } = renderCard()

    fireEvent.click(addBccLink()!)
    addRecipient('Bcc', 'legal@acme.test')

    await advance(AUTOSAVE_DELAY_MS)

    expect(saveDraft).toHaveBeenCalledWith('draft-1', { bccAddrs: ['legal@acme.test'] })
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

  it('keeps the recipient rows out of the body height, so the card stays a fixed height', () => {
    renderCard(makeDraft({ ccAddrs: ['bob@acme.test'] }))

    // The card is a fixed height, so every row above the body has to refuse to
    // shrink and the body has to be the one that gives up the space.
    for (const label of ['To', 'Cc']) {
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
    expect(screen.getByRole('article', { name: 'New message' })).toHaveClass('h-96')
  })
})

/**
 * The footer's template menu.
 *
 * What these protect:
 *   - the menu lists this org's templates, and says where to write one when
 *     there are none
 *   - picking one replaces the subject and the body and KEEPS the recipients,
 *     which is the whole reason a rep reaches for it at this point
 *   - a card with text in it asks before it throws that text away
 *   - the insertion rides the ordinary autosave, with no special path
 *   - and the caret rule still holds afterwards: a save response cannot reach
 *     the newly mounted editor either
 */
const TEMPLATE_BUTTON = 'Insert a saved template into this email'

function openTemplateMenu(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: TEMPLATE_BUTTON }))
}

describe('ComposerCard templates', () => {
  it('lists the org templates in the order the route sorted them', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(
      templatesQuery({
        templates: [
          makeTemplate({ id: 'tpl-a', name: 'Aged quote' }),
          makeTemplate({ id: 'tpl-b', name: 'Discovery follow-up' }),
          makeTemplate({ id: 'tpl-c', name: 'Rate confirmation' }),
        ],
      }),
    )
    renderCard()

    await openTemplateMenu(user)

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Aged quote',
      'Discovery follow-up',
      'Rate confirmation',
    ])
  })

  it('replaces the subject and the body and leaves every recipient alone', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    // Only Cc is on screen — Cc and Bcc are mutually exclusive (MAI-209) and a
    // draft carrying both picks Cc — but the point of this test is the same
    // either way: a template must not touch a row the rep already addressed.
    renderCard(
      makeDraft({
        toAddrs: ['ann@acme.test'],
        ccAddrs: ['bob@acme.test'],
      }),
    )

    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    expect(subjectField()).toHaveValue('Great speaking with you')
    expect(bodyField()).toHaveTextContent('Thanks for your time.')
    // The rep addressed the email first. A template that emptied the rows would
    // undo the work they did before reaching for it.
    expect(chipAddresses()).toEqual(['ann@acme.test', 'bob@acme.test'])
  })

  it('asks nothing when only the recipients are filled in', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    // Addressing an email and then picking a template is the ordinary order. A
    // dialog here would appear on nearly every insertion.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(subjectField()).toHaveValue('Great speaking with you')
  })

  it('asks before it replaces a subject the rep wrote, and Cancel changes nothing', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    renderCard(makeDraft({ subject: 'Half a quote' }))

    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Replace what you have written?')
    // The question names the template, and what survives it.
    expect(dialog).toHaveTextContent('Discovery follow-up')
    expect(dialog).toHaveTextContent('The recipients stay.')
    expect(subjectField()).toHaveValue('Half a quote')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(subjectField()).toHaveValue('Half a quote')
  })

  it('asks before it replaces a message the rep wrote, and replaces on confirmation', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    renderCard()

    await typeBody('<p>Half a sentence</p>')
    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Replace' }))

    expect(bodyField()).toHaveTextContent('Thanks for your time.')
    expect(bodyField()).not.toHaveTextContent('Half a sentence')
  })

  it('treats an untouched editor as empty, so an empty card inserts without a question', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    renderCard()

    // The editor reports `<p></p>` for a document nobody has typed in. That is
    // markup, not writing, and a question about it would be noise.
    await typeBody('<p></p>')
    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(bodyField()).toHaveTextContent('Thanks for your time.')
  })

  it('saves the inserted template through the ordinary autosave', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    const { saveDraft } = renderCard()

    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    // No special path: the same 1200 ms debounce every keystroke rides, sending
    // the two keys that changed and nothing else. Real timers, because the menu
    // above needs them.
    await waitFor(
      () =>
        expect(saveDraft).toHaveBeenCalledWith('draft-1', {
          subject: 'Great speaking with you',
          bodyHtml: '<p>Thanks for your time.</p>',
        }),
      { timeout: AUTOSAVE_DELAY_MS * 3 },
    )
  })

  it('still ignores a save response after a template landed', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ templates: [makeTemplate()] }))
    const { rerenderWith } = renderCard()

    await openTemplateMenu(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Discovery follow-up' }))

    // The remount that showed the template is the ONLY one. The dock's copy of
    // the draft coming back must still not reach the editor, or the caret bug is
    // back the moment a rep uses a template.
    rerenderWith(makeDraft({ subject: 'The server copy', bodyHtml: '<p>An older body</p>' }))

    expect(subjectField()).toHaveValue('Great speaking with you')
    expect(bodyField()).toHaveTextContent('Thanks for your time.')
    expect(bodyField()).not.toHaveTextContent('An older body')
  })

  it('points at Settings when there are no templates yet, never an empty menu', async () => {
    const user = userEvent.setup()
    renderCard()

    await openTemplateMenu(user)

    const row = await screen.findByRole('menuitem', {
      name: 'Write your first template in Settings → Email templates.',
    })
    expect(row).toHaveAttribute('data-disabled')
  })

  it('says the list is still loading rather than claiming there is nothing', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ isPending: true }))
    renderCard()

    await openTemplateMenu(user)

    expect(await screen.findByRole('menuitem', { name: 'Loading templates…' })).toHaveAttribute(
      'data-disabled',
    )
  })

  it('offers the retry when the list could not be loaded', async () => {
    const user = userEvent.setup()
    useGetEmailTemplatesMock.mockReturnValue(templatesQuery({ isError: true }))
    renderCard()

    await openTemplateMenu(user)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Could not load your templates. Try again.' }),
    )

    expect(refetchMock).toHaveBeenCalled()
  })
})

const SIGNATURE_BUTTON = 'Choose a signature for this email'

describe('ComposerCard signatures', () => {
  it('inserts the default signature into a newly created blank draft', async () => {
    useGetEmailSignaturesMock.mockReturnValue(
      signaturesQuery([signature('sig-work', 'Work', '<p>Ari Rep</p>', true)]),
    )

    renderCard()

    await waitFor(() => expect(bodyField()).toHaveTextContent('Ari Rep'))
  })

  it('swaps the signature without replacing the message the rep wrote', async () => {
    const user = userEvent.setup()
    useGetEmailSignaturesMock.mockReturnValue(
      signaturesQuery([
        signature('sig-work', 'Work', '<p>Ari Rep</p>', true),
        signature('sig-personal', 'Personal', '<p>Ari</p>'),
      ]),
    )
    renderCard()

    await waitFor(() => expect(bodyField()).toHaveTextContent('Ari Rep'))
    await typeBody('<p>Hello Casey</p><p>Ari Rep</p>')
    await user.click(screen.getByRole('button', { name: SIGNATURE_BUTTON }))
    await user.click(await screen.findByRole('menuitem', { name: 'Personal' }))

    expect(bodyField()).toHaveTextContent('Hello Casey')
    expect(bodyField()).toHaveTextContent('Ari')
    expect(bodyField()).not.toHaveTextContent('Ari Rep')
  })
})

/**
 * The footer's Send button.
 *
 * What these protect:
 *   - disabled says which of "a connected mailbox" or "a recipient" is missing,
 *     never both at once and never a bare "Send"
 *   - enabled only with BOTH (SPEC-composer-send.md → Acceptance criteria, 1)
 *   - a click flushes first, so the last keystrokes are what gets sent
 *   - success closes the card through `discardDraft`, never a second delete of
 *     a live row — the server already removed it
 *   - failure leaves the card open with its text, and the server's own message
 *     reaches the toast
 */
describe('ComposerCard send', () => {
  it('disables Send and names the missing mailbox when none is connected', () => {
    renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(
      screen.getByText('Connect a mailbox in Settings → Integrations to send.'),
    ).toBeInTheDocument()
  })

  it('disables Send and asks for a recipient once a mailbox is connected', () => {
    useGetMailboxesMock.mockReturnValue(mailboxesQuery([makeMailbox()]))
    renderCard()

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByText('Add a recipient to send.')).toBeInTheDocument()
  })

  it('enables Send once a mailbox is connected and a recipient is set', () => {
    useGetMailboxesMock.mockReturnValue(mailboxesQuery([makeMailbox()]))
    renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('stays disabled with a mailbox that is connected but not primary', () => {
    // Exactly one mailbox is ever primary, and Send uses that one — a second,
    // non-primary connected mailbox is not what a rep sends from without a
    // picker to choose it.
    useGetMailboxesMock.mockReturnValue(
      mailboxesQuery([makeMailbox({ id: 'box-2', isPrimary: false })]),
    )
    renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('stays disabled when the primary mailbox is limited, not connected', () => {
    useGetMailboxesMock.mockReturnValue(mailboxesQuery([makeMailbox({ status: 'limited' })]))
    renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('flushes the last keystroke, then sends, then closes the card as sent', async () => {
    const user = userEvent.setup()
    useGetMailboxesMock.mockReturnValue(mailboxesQuery([makeMailbox()]))
    const { saveDraft, discardDraft } = renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    await typeBody('Last line before sending')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(sendEmailDraftMock).toHaveBeenCalledWith({
      orgId: 'org-a',
      draftId: 'draft-1',
    }))
    // The flush landed before the send call, so the provider gets the sentence
    // the rep just finished, not a stale autosave.
    expect(saveDraft).toHaveBeenCalledWith('draft-1', {
      bodyHtml: '<p>Last line before sending</p>',
    })
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      sendEmailDraftMock.mock.invocationCallOrder[0],
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Email sent.')
    // The server already deleted the row; this drops the card from the dock
    // rather than issuing a second, meaningful delete.
    await waitFor(() => expect(discardDraft).toHaveBeenCalledWith('draft-1'))
  })

  it('leaves the card open and toasts the server message on a failed send', async () => {
    const user = userEvent.setup()
    useGetMailboxesMock.mockReturnValue(mailboxesQuery([makeMailbox()]))
    sendEmailDraftMock.mockRejectedValue(
      new ApiError('Gmail would not accept the message. Nothing was sent.', 502, 'provider_error'),
    )
    const { discardDraft } = renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Gmail would not accept the message. Nothing was sent.',
      ),
    )
    expect(discardDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('article', { name: /ann@acme.test/ })).toBeInTheDocument()
  })

  it('shows "Sending…" and disables the button while the request is in flight', () => {
    useGetMailboxesMock.mockReturnValue(mailboxesQuery([makeMailbox()]))
    useSendEmailDraftMock.mockReturnValue({ mutateAsync: sendEmailDraftMock, isPending: true })
    renderCard(makeDraft({ toAddrs: ['ann@acme.test'] }))

    const button = screen.getByRole('button', { name: 'Sending…' })
    expect(button).toBeDisabled()
  })
})
