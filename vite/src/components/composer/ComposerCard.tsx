import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Trash2, X } from 'lucide-react'

import { RichTextEditor, type LinkRequest } from '@/components/editor/RichTextEditor'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { EmailDraft, EmailDraftPatch, RecipientChip } from '@/lib/emailTypes'
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
 * disabled control would never fire. Sending arrives with `composer-send`; until
 * then this is a visibly disabled control with an honest label, which is the
 * only allowed shape for an unfinished one (CLAUDE.md → Verification).
 */
const SEND_DISABLED_REASON = 'Connect a mailbox in Settings → Integrations to send.'

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
 */
export function ComposerCard({ draft }: ComposerCardProps) {
  const { saveDraft, closeCard, setMinimized, discardDraft } = useComposer()
  const draftId = draft.id

  // Seeded ONCE. `useState` reads its initial value on the first render only, so
  // a later `draft` prop carrying the server's copy of this same text cannot
  // reach the input the rep is typing in.
  const [subject, setSubject] = useState(draft.subject ?? '')
  // Two pieces of state for the body, and they are not the same thing.
  // `bodySeed` is what the editor OPENED with and never changes again — it is
  // handed to `initialHtml`, which the editor reads once (RichTextEditor → the
  // caret rule). `body` is what the rep has typed since, reported up through
  // `onChange`. Feeding `body` back in as `initialHtml` would be the controlled
  // rich-text editor the whole module exists to avoid.
  const [bodySeed] = useState(() => draft.bodyHtml ?? '')
  const [body, setBody] = useState(bodySeed)
  // The open link request, or null. The editor raises it; the dialog collects a
  // URL and calls back into the selection the rep actually had.
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null)
  const [toChips, setToChips] = useState(() => chipsFrom(draft.toAddrs))
  const [ccChips, setCcChips] = useState(() => chipsFrom(draft.ccAddrs))
  const [bccChips, setBccChips] = useState(() => chipsFrom(draft.bccAddrs))
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Cc and Bcc hide behind a link, and are open from the start when the draft
  // already carries either — a rep who added a Cc and refreshed finds the row
  // still there with its chip, not a link they have to press again.
  const [showCcBcc, setShowCcBcc] = useState(
    () => draft.ccAddrs.length > 0 || draft.bccAddrs.length > 0,
  )

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
      className="flex h-[26rem] w-96 flex-col overflow-hidden rounded-t-md border border-border bg-background shadow-md"
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
        {showCcBcc ? null : (
          <button
            type="button"
            onClick={() => setShowCcBcc(true)}
            // `flex items-start` rather than the button's own centering: the row
            // grows as chips wrap, and a link that drifts to the middle of it
            // stops lining up with the `To` label beside it.
            className="flex shrink-0 cursor-pointer items-start border-b border-border px-3 py-1 text-xs leading-6 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            Cc/Bcc
          </button>
        )}
      </div>

      {showCcBcc ? (
        <>
          <RecipientField label="Cc" chips={ccChips} onChange={setCcChips} />
          <RecipientField label="Bcc" chips={bccChips} onChange={setBccChips} />
        </>
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
        The body. `initialHtml` is the seed captured on mount and never the live
        `body`, so nothing here can re-render the editor from a save response.
        The card is a fixed 26rem, so this is the one part of it that gives up
        height — the rows above are all `shrink-0` — and a long email scrolls
        inside the editor rather than pushing the footer off the bottom.
      */}
      <RichTextEditor
        label="Message"
        placeholder="Write a message"
        initialHtml={bodySeed}
        onChange={setBody}
        onRequestLink={setLinkRequest}
        className="min-h-0 flex-1"
      />

      <RichTextEditorUrlDialog request={linkRequest} onClose={() => setLinkRequest(null)} />

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <Button type="button" size="sm" disabled>
          Send
        </Button>
        <p className="min-w-0 flex-1 text-xs leading-tight text-muted-foreground">
          {SEND_DISABLED_REASON}
        </p>
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
