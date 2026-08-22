import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileSignature, FileText, Minus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { RichTextEditor, type LinkRequest, type RichTextEditorActions } from '@/components/editor/RichTextEditor'
import { RichTextEditorUrlDialog } from '@/components/editor/RichTextEditor_UrlDialog'
import { sanitizeStoredHtml } from '@/components/editor/sanitizeStoredHtml'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGetEmailSignatures, useGetEmailTemplates, useSendEmailDraft } from '@/hooks/email'
import type { EmailSignature, EmailTemplate } from '@/hooks/email'
import { useGetMailboxes } from '@/hooks/mailboxes'
import { ApiError } from '@/lib/api'
import type { EmailDraft, EmailDraftPatch, RecipientChip } from '@/lib/emailTypes'
import { useAuth } from '@/providers/useAuth'
import { useComposer } from './composerContext'
import { draftTitle } from './draftTitle'
import { RecipientField } from './ComposerCard_Recipients'

/**
 * How long after the last keystroke the card reports its text upward.
 *
 * Long enough that a normal typing burst is one PATCH and not thirty, short
 * enough that a rep who closes the laptop mid-sentence loses nothing worth
 * noticing (SPEC-composer-dock.md → Acceptance criteria, 8).
 */
const AUTOSAVE_DELAY_MS = 1200

/**
 * Why Send cannot be pressed, said next to it rather than hidden in a tooltip a
 * disabled control would never fire (design-system.md → Icon-only buttons — the
 * same rule applies to any disabled control whose reason matters). Send is
 * enabled only with a connected mailbox AND at least one To address
 * (SPEC-composer-send.md → Acceptance criteria, 1); disabled, it names whichever
 * of the two is missing.
 */
const SEND_DISABLED_NO_MAILBOX_REASON = 'Connect a mailbox in Settings → Integrations to send.'
const SEND_DISABLED_NO_RECIPIENT_REASON = 'Add a recipient to send.'

/**
 * The draft stores plain strings; the field wants chips.
 *
 * `displayName` and `recordId` are null on the way in because nothing fills them
 * in yet — there is no CRM to match an address against — so a round trip through
 * storage loses nothing today (SPEC-composer-recipients.md → RecipientChip).
 */
function chipsFrom(addresses: string[]): RecipientChip[] {
  return addresses.map((address) => ({ address, displayName: null, recordId: null }))
}

function addressesOf(chips: RecipientChip[]): string[] {
  return chips.map((chip) => chip.address)
}

/**
 * The same addresses in the same order.
 *
 * Order counts and case counts: the route writes the array it is handed, and a
 * rep who retypes `Ann@` over `ann@` changed the draft.
 */
function sameAddresses(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((address, index) => address === b[index])
}

/**
 * Has the rep written anything a template would destroy?
 *
 * Only the subject and the message count. The recipients deliberately do not:
 * addressing an email and THEN reaching for a template is the ordinary order a
 * rep works in (SPEC-composer-templates.md → Acceptance criteria, 6), so asking
 * there would put a dialog in front of nearly every insertion and train the rep
 * to dismiss it without reading it.
 *
 * The body arrives as HTML, and an untouched editor still reports `<p></p>` — so
 * the tags come off before the check. `&nbsp;` is the one entity a rep produces
 * without typing a word, and it is whitespace; every other entity stands for a
 * character they did type.
 */
function hasWrittenText(subject: string, bodyHtml: string): boolean {
  if (subject.trim() !== '') return true
  const text = bodyHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z0-9#]+;/gi, 'x')
  return text.trim() !== ''
}

interface ComposerCardProps {
  /**
   * The draft as the dock holds it. Read for the id and the values this card
   * OPENED with — never for a value while it is open. See the note on the local
   * state below.
   */
  draft: EmailDraft
}

/**
 * One Gmail-shaped composer card: header, recipients, subject, body, footer.
 *
 * **The card owns its own text while it is open and never re-reads its own saved
 * value.** That is the rule this whole module lives or dies by
 * (SPEC-composer-dock.md → Code style, rule 1). A save response merged back into
 * the editor would re-render it mid-sentence and drop the caret to the end, so
 * the state below is seeded once and reported upward on a debounce. The
 * recipients keep the same discipline: a chip list rebuilt from a save response
 * would blow away the chip a rep added while the request was in flight.
 * No unit test catches a moving caret — type for 30 seconds in a browser.
 *
 * The body is `RichTextEditor` — bold, italic, two list types, and links. It is
 * seeded from `bodySeed`, captured on mount, and reports back through
 * `onChange`; there is no `value` prop to wire the other way, which is how the
 * caret rule is enforced rather than merely written down.
 *
 * The one thing that legitimately shows a DIFFERENT document is the template
 * menu in the footer: picking a template replaces the subject and the body and
 * leaves the recipients alone (SPEC-composer-templates.md → Acceptance criteria,
 * 6). That is a remount with a new `key`, not a re-seed — see `applyTemplate`,
 * which is the only writer of `bodySeed` and is reachable from nowhere else.
 */
export function ComposerCard({ draft }: ComposerCardProps) {
  const { saveDraft, closeCard, setMinimized, discardDraft } = useComposer()
  const { org } = useAuth()
  const draftId = draft.id

  // Every template in the org, in the order the route sorted them. One cache
  // entry serves both this menu and Settings → Email templates, so opening a
  // card costs nothing once the list is warm.
  const templatesQuery = useGetEmailTemplates(org?.id ?? null)
  const templates = templatesQuery.data?.templates ?? []
  const signaturesQuery = useGetEmailSignatures(org?.id ?? null)
  const signatures = useMemo(
    () => signaturesQuery.data?.signatures ?? [],
    [signaturesQuery.data?.signatures],
  )

  // The same list Settings → Integrations reads. Exactly one is ever primary
  // (schema.prisma → MailAccount), and that is the mailbox Send uses: there is
  // no picker in the composer yet, so a rep sends from their own default
  // address, the way SPEC-composer-send.md's Objective describes it.
  const mailboxesQuery = useGetMailboxes(org?.id ?? null)
  const primaryMailbox = mailboxesQuery.data?.mailboxes?.find((mailbox) => mailbox.isPrimary) ?? null
  const hasConnectedMailbox = primaryMailbox?.status === 'connected'

  // Seeded ONCE. `useState` reads its initial value on the first render only, so
  // a later `draft` prop carrying the server's copy of this same text cannot
  // reach the input the rep is typing in.
  const [subject, setSubject] = useState(draft.subject ?? '')
  // Two pieces of state for the body, and they are not the same thing.
  // `bodySeed` is what the editor MOUNTED with — it is handed to `initialHtml`,
  // which the editor reads once (RichTextEditor → the caret rule). `body` is
  // what the rep has typed since, reported up through `onChange`. Feeding
  // `body` back in as `initialHtml` would be the controlled rich-text editor
  // the whole module exists to avoid.
  //
  // `mount` is the editor's React `key`, and `applyTemplate` below is the ONLY
  // thing that ever changes either field. Picking a template is the one case
  // where the rep asked for a different document, and the editor's own API says
  // how to show one: remount it. Nothing else can reach this setter — not
  // `onChange`, not `flush`, not the `draft` prop — so neither a keystroke nor
  // a save response can rebuild the editor.
  const [bodySeed, setBodySeed] = useState(() => ({ html: draft.bodyHtml ?? '', mount: 0 }))
  const [body, setBody] = useState(bodySeed.html)
  const [editorActions, setEditorActions] = useState<RichTextEditorActions | null>(null)
  const [insertedSignature, setInsertedSignature] = useState<EmailSignature | null>(null)
  const defaultSignatureInserted = useRef(false)
  // The open link request, or null. The editor raises it; the dialog collects a
  // URL and calls back into the selection the rep actually had.
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null)
  const [toChips, setToChips] = useState(() => chipsFrom(draft.toAddrs))
  const [ccChips, setCcChips] = useState(() => chipsFrom(draft.ccAddrs))
  const [bccChips, setBccChips] = useState(() => chipsFrom(draft.bccAddrs))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // The template the rep picked into a card that already has text, held while
  // they answer. Null the rest of the time, including for a template going into
  // an empty card, which needs no question.
  const [confirmTemplate, setConfirmTemplate] = useState<EmailTemplate | null>(null)

  // A default belongs in a genuinely new, blank draft. The effect waits for the
  // editor action surface rather than re-seeding it, so a late query response
  // appends one deliberate block and never replaces a live document or moves a
  // rep's caret. A draft that already has a body is an existing draft, even if
  // the body is currently empty after editing, and is left alone.
  useEffect(() => {
    const defaultSignature = signatures.find((signature) => signature.isDefault)
    if (
      defaultSignatureInserted.current ||
      !defaultSignature ||
      !editorActions ||
      draft.bodyHtml !== null ||
      body !== ''
    ) return

    defaultSignatureInserted.current = true
    setInsertedSignature(defaultSignature)
    editorActions.insertHtmlAtEnd(defaultSignature.bodyHtml)
  }, [body, draft.bodyHtml, editorActions, signatures])

  // Cc and Bcc hide behind two links, "Add Cc" and "Add Bcc", and only one of
  // the two fields can be open at a time — picking one commits to it and the
  // other link never appears. Open from the start when the draft already
  // carries one of them, so a rep who added a Cc and refreshed finds the row
  // still there with its chip, not a link they have to press again. A draft
  // carrying both (from before this field became exclusive) keeps Cc, since
  // that is the field a rep reaches for first.
  const [ccBcc, setCcBcc] = useState<'none' | 'cc' | 'bcc'>(() => {
    if (draft.ccAddrs.length > 0) return 'cc'
    if (draft.bccAddrs.length > 0) return 'bcc'
    return 'none'
  })

  // What has already been reported upward. Comparing against this is what makes
  // the first render silent — opening a card is not editing it, and a PATCH that
  // writes back exactly what was just loaded is a wasted round trip that also
  // bumps `updatedAt` on a draft nobody touched.
  const savedRef = useRef({
    subject: draft.subject ?? '',
    body: draft.bodyHtml ?? '',
    toAddrs: draft.toAddrs,
    ccAddrs: draft.ccAddrs,
    bccAddrs: draft.bccAddrs,
  })

  const flush = useCallback(async () => {
    const patch: EmailDraftPatch = {}
    if (subject !== savedRef.current.subject) patch.subject = subject

    // Sanitised on the way out, against the same allow-list the server enforces
    // (SPEC-composer-body.md → Acceptance criteria, 7). The editor's schema
    // already refuses everything off that list, so this normally changes
    // nothing — it is here because the client's copy is never the one that is
    // trusted, and because sending what the server would rewrite is how the
    // card and the database end up disagreeing (MAI-78).
    const bodyHtml = sanitizeStoredHtml(body)
    if (bodyHtml !== savedRef.current.body) patch.bodyHtml = bodyHtml

    const toAddrs = addressesOf(toChips)
    const ccAddrs = addressesOf(ccChips)
    const bccAddrs = addressesOf(bccChips)
    if (!sameAddresses(toAddrs, savedRef.current.toAddrs)) patch.toAddrs = toAddrs
    if (!sameAddresses(ccAddrs, savedRef.current.ccAddrs)) patch.ccAddrs = ccAddrs
    if (!sameAddresses(bccAddrs, savedRef.current.bccAddrs)) patch.bccAddrs = bccAddrs

    // Nothing changed. The route rejects a patch with no keys, and the `−`, the
    // `✕`, and the unmount below all flush unconditionally.
    if (Object.keys(patch).length === 0) return

    // Marked saved BEFORE the await, so a `−` pressed while this request is in
    // flight does not send the same keys a second time.
    savedRef.current = { subject, body: bodyHtml, toAddrs, ccAddrs, bccAddrs }
    await saveDraft(draftId, patch)
  }, [subject, body, toChips, ccChips, bccChips, draftId, saveDraft])

  // The debounce. `flush` changes identity exactly when the draft's own values
  // do, so this effect is the "1200 ms after the last keystroke" rule written
  // out. A chip is a change like any other: it rides the same debounce.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const timer = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [flush])

  // A card that no longer fits beside the dialer is swapped for a chip, which
  // UNMOUNTS this component and takes the local text with it. So the last
  // keystrokes are flushed on the way out: `saveDraft` merges them into the
  // dock's own copy, and the card comes back holding them when it expands again.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => () => void flushRef.current(), [])

  // Every way the card can leave the screen flushes first. The rep's last
  // sentence is still inside the debounce at the moment they press these.
  async function minimize() {
    await flush()
    await setMinimized(draftId, true)
  }

  async function close() {
    await flush()
    // A save with `isOpen: false`. Closing an email has never meant throwing it
    // away, and the dock's "3 drafts" button is the way back to this one.
    await closeCard(draftId)
  }

  async function discard() {
    setConfirmDiscard(false)
    // Flushed even here: a DELETE that fails resyncs the dock from the server,
    // and the row that comes back should hold what the rep actually typed.
    await flush()
    await discardDraft(draftId)
  }

  const { mutateAsync: sendEmailDraft, isPending: isSending } = useSendEmailDraft()
  const toAddrs = addressesOf(toChips)
  const sendDisabledReason = !hasConnectedMailbox
    ? SEND_DISABLED_NO_MAILBOX_REASON
    : toAddrs.length === 0
      ? SEND_DISABLED_NO_RECIPIENT_REASON
      : null

  /**
   * Send this draft. `flush()` first, because the route sends exactly what was
   * last autosaved (SPEC-composer-send.md → API) — a rep who just typed the
   * last line of the email must not have it sent without.
   *
   * On success the server has already deleted the draft row, so `discardDraft`
   * here is not a second delete of a live row: it drops the card from the dock
   * and issues a DELETE that 404s on the row that is already gone, which
   * `useDeleteEmailDraft` treats as the success it is (MAI-88) — no toast, no
   * resync. On failure the card stays open with everything intact
   * (SPEC-composer-send.md → Acceptance criteria, 6): nothing here removes it.
   */
  async function send() {
    if (!org?.id || sendDisabledReason) return

    await flush()
    try {
      await sendEmailDraft({ orgId: org.id, draftId })
      toast.success('Email sent.')
      await discardDraft(draftId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not send the email. Try again.')
    }
  }

  /**
   * Put a template's subject and body into this card. Keeps the recipients.
   *
   * The subject is a plain input, so assigning it is enough. The body is not:
   * the editor reads `initialHtml` once and has no `value` prop, by design, so
   * the only honest way to show a different document is to mount a different
   * editor. Bumping `mount` does exactly that — the `key` changes, React
   * unmounts the old editor and builds a new one around the new seed.
   *
   * **Why this cannot move a caret.** The remount is driven by `bodySeed.mount`,
   * and this function is its only writer. It runs from one place: the rep
   * choosing a row in the template menu, through the confirm when the card has
   * text. A keystroke calls `setBody`, which the editor never reads back. A save
   * response is merged into the dock's `draft` prop, which this card has not
   * read since it mounted. Neither path touches `bodySeed`.
   *
   * `body` is set here as well, because `onChange` is deliberately not fired for
   * `initialHtml` — without this the autosave would still be holding the old
   * text and would write it back over the template a second later.
   */
  function applyTemplate(template: EmailTemplate) {
    setConfirmTemplate(null)
    setSubject(template.subject)
    setBody(template.bodyHtml)
    setBodySeed((current) => ({ html: template.bodyHtml, mount: current.mount + 1 }))
    // Saved by the ordinary debounce, with no special path: `subject` and `body`
    // changed, so `flush` sends them 1200 ms from now like any other edit.
  }

  /** Picked from the menu. Asks first when there is written text to lose. */
  function pickTemplate(template: EmailTemplate) {
    if (hasWrittenText(subject, body)) {
      setConfirmTemplate(template)
      return
    }
    applyTemplate(template)
  }

  /** Replaces only the signature block this card inserted, never the rep's message. */
  function pickSignature(nextSignature: EmailSignature | null) {
    const currentSignatureHtml = insertedSignature ? sanitizeStoredHtml(insertedSignature.bodyHtml) : ''
    const index = currentSignatureHtml ? body.lastIndexOf(currentSignatureHtml) : -1
    const withoutCurrent = index === -1
      ? body
      : `${body.slice(0, index)}${body.slice(index + currentSignatureHtml.length)}`
    const nextBody = nextSignature ? `${withoutCurrent}${nextSignature.bodyHtml}` : withoutCurrent

    setInsertedSignature(nextSignature)
    setBody(nextBody)
    // Choosing a signature is an explicit request for a different block. Like
    // choosing a template, remounting is the editor's safe way to show it.
    setBodySeed((current) => ({ html: nextBody, mount: current.mount + 1 }))
  }

  // Built from the LOCAL subject and the LOCAL chips, so the header renames
  // itself as the rep types and as the first recipient changes, rather than a
  // save later.
  const title = draftTitle({ subject, toAddrs: addressesOf(toChips) })
  const subjectId = `composer-subject-${draftId}`

  return (
    <article
      aria-label={title}
      // Flush to the bottom edge: a top radius, no bottom radius, and no gap
      // beneath it, so the card grows out of the edge the way Gmail's does.
      // `w-80` matches the dialer's own expanded card (`DialerDock.tsx`) — the
      // two are the only cards that float above the dock, and MAI-209 asks
      // that they read as the same size.
      className="flex h-96 w-80 flex-col overflow-hidden rounded-t-md border border-border bg-background shadow-md"
    >
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-muted px-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Minimize"
          onClick={() => void minimize()}
        >
          <Minus size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => void close()}
        >
          <X size={16} />
        </Button>
      </header>

      {/*
        The Cc/Bcc link sits at the right end of the To row, the way Gmail's
        does, and leaves once it has been pressed — a link that reveals a row
        already on screen has nothing left to do. `has-[input:focus]` carries the
        row's focus color across to the link's own bottom border, so the line
        under the row is one color and not two.
      */}
      <div className="flex shrink-0 items-stretch has-[input:focus]:*:border-primary">
        <div className="min-w-0 flex-1">
          <RecipientField label="To" chips={toChips} onChange={setToChips} autoFocus />
        </div>
        {ccBcc === 'none' ? (
          <div className="flex shrink-0 items-start border-b border-border px-3 py-1">
            {/* `flex items-start` on the wrapper rather than the buttons' own
                centering: the row grows as chips wrap, and a link that drifts
                to the middle of it stops lining up with the `To` label beside
                it. */}
            <button
              type="button"
              onClick={() => setCcBcc('cc')}
              className="cursor-pointer text-xs leading-6 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              Add Cc
            </button>
            <span className="px-1 text-xs leading-6 text-muted-foreground" aria-hidden>
              /
            </span>
            <button
              type="button"
              onClick={() => setCcBcc('bcc')}
              className="cursor-pointer text-xs leading-6 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              Add Bcc
            </button>
          </div>
        ) : null}
      </div>

      {ccBcc === 'cc' ? <RecipientField label="Cc" chips={ccChips} onChange={setCcChips} /> : null}
      {ccBcc === 'bcc' ? (
        <RecipientField label="Bcc" chips={bccChips} onChange={setBccChips} />
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
        <Label htmlFor={subjectId} className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
          Re
        </Label>
        <Input
          id={subjectId}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          // The route's own cap, so an over-long subject is refused at the
          // keystroke rather than as a 400 a second later.
          maxLength={998}
          placeholder="Subject"
          // No border and no ring of its own: the row's bottom border is the
          // field's edge. A bordered control inside a bordered row would draw
          // two lines where the spec asks for one.
          className="h-8 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
      </div>

      {/*
        The body. `initialHtml` is the seed this editor MOUNTED with and never
        the live `body`, so nothing here can re-render the editor from a save
        response. The `key` moves only when the rep picks a template, which is
        the one time they asked for a different document — see `applyTemplate`.
        The card is a fixed 26rem, so this is the one part of it that gives up
        height — the rows above are all `shrink-0` — and a long email scrolls
        inside the editor rather than pushing the footer off the bottom.
      */}
      <RichTextEditor
        key={`body-${bodySeed.mount}`}
        label="Message"
        placeholder="Write a message"
        initialHtml={bodySeed.html}
        onChange={setBody}
        onRequestLink={setLinkRequest}
        onReady={setEditorActions}
        className="min-h-0 flex-1"
      />

      <RichTextEditorUrlDialog request={linkRequest} onClose={() => setLinkRequest(null)} />

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <Button
          type="button"
          size="sm"
          disabled={sendDisabledReason !== null || isSending}
          onClick={() => void send()}
        >
          {isSending ? 'Sending…' : 'Send'}
        </Button>
        <p className="min-w-0 flex-1 text-xs leading-tight text-muted-foreground">
          {sendDisabledReason ?? ''}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton tooltip="Insert a saved template into this email">
              <FileText size={16} aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          {/* Opens upward and right-aligned: the footer sits on the bottom edge
              of the screen, and a menu that dropped down would land off it. */}
          <DropdownMenuContent align="end" side="top">
            {templatesQuery.isPending && (
              <DropdownMenuItem disabled>Loading templates…</DropdownMenuItem>
            )}

            {templatesQuery.isError && (
              <DropdownMenuItem
                // Kept open, so the retry lands in front of the rep rather than
                // closing the menu and leaving them to open it again.
                onSelect={(event) => {
                  event.preventDefault()
                  void templatesQuery.refetch()
                }}
              >
                Could not load your templates. Try again.
              </DropdownMenuItem>
            )}

            {/* Nothing to insert yet. A disabled row naming where templates are
                written, never an empty menu (SPEC-composer-templates.md →
                Acceptance criteria, 8). */}
            {templatesQuery.isSuccess && templates.length === 0 && (
              <DropdownMenuItem disabled>
                Write your first template in Settings → Email templates.
              </DropdownMenuItem>
            )}

            {templates.map((template) => (
              <DropdownMenuItem key={template.id} onSelect={() => pickTemplate(template)}>
                {template.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton tooltip="Choose a signature for this email">
              <FileSignature size={16} aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {signaturesQuery.isPending && <DropdownMenuItem disabled>Loading signatures…</DropdownMenuItem>}
            {signaturesQuery.isError && (
              <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void signaturesQuery.refetch() }}>
                Could not load your signatures. Try again.
              </DropdownMenuItem>
            )}
            {signaturesQuery.isSuccess && signatures.length === 0 && (
              <DropdownMenuItem disabled>Write a signature in Settings → Signatures.</DropdownMenuItem>
            )}
            {insertedSignature && <DropdownMenuItem onSelect={() => pickSignature(null)}>No signature</DropdownMenuItem>}
            {signatures.map((signature) => (
              <DropdownMenuItem key={signature.id} onSelect={() => pickSignature(signature)}>{signature.name}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Discard draft"
          onClick={() => setConfirmDiscard(true)}
        >
          <Trash2 size={16} />
        </Button>
      </footer>

      {/* Picking a template over a half-written email destroys it, so the rep is
          asked first (SPEC-composer-templates.md → Acceptance criteria, 7). The
          question names the template and says what survives — the recipients are
          the reason a rep reaches for a template at this point at all. */}
      <AlertDialog
        open={confirmTemplate !== null}
        onOpenChange={(open) => !open && setConfirmTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace what you have written?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTemplate?.name} replaces the subject and the message. The recipients stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmTemplate && applyTemplate(confirmTemplate)}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void discard()}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
