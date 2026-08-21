import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Trash2, X } from 'lucide-react'

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
import { Textarea } from '@/components/ui/textarea'
import type { EmailDraft, EmailDraftPatch } from '@/lib/emailTypes'
import { useComposer } from './composerContext'
import { draftTitle } from './draftTitle'

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

interface ComposerCardProps {
  /**
   * The draft as the dock holds it. Read for the id, the recipients, and the
   * text this card OPENED with — never for the text while it is open. See the
   * note on `subject` below.
   */
  draft: EmailDraft
}

/**
 * One Gmail-shaped composer card: header, subject, body, footer.
 *
 * **The card owns its own text while it is open and never re-reads its own saved
 * value.** That is the rule this whole module lives or dies by
 * (SPEC-composer-dock.md → Code style, rule 1). A save response merged back into
 * the editor would re-render it mid-sentence and drop the caret to the end, so
 * the text below is local state seeded once and reported upward on a debounce.
 * No unit test catches a moving caret — type for 30 seconds in a browser.
 *
 * The body is a plain `textarea` for all of Phase 1 and becomes the rich editor
 * in `composer-body`. It is an honest interim: it works, it just does not do
 * bold.
 */
export function ComposerCard({ draft }: ComposerCardProps) {
  const { saveDraft, closeCard, setMinimized, discardDraft } = useComposer()
  const draftId = draft.id

  // Seeded ONCE. `useState` reads its initial value on the first render only, so
  // a later `draft` prop carrying the server's copy of this same text cannot
  // reach the input the rep is typing in.
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.bodyHtml ?? '')
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // What has already been reported upward. Comparing against this is what makes
  // the first render silent — opening a card is not editing it, and a PATCH that
  // writes back exactly what was just loaded is a wasted round trip that also
  // bumps `updatedAt` on a draft nobody touched.
  const savedRef = useRef({ subject: draft.subject ?? '', body: draft.bodyHtml ?? '' })

  const flush = useCallback(async () => {
    const patch: EmailDraftPatch = {}
    if (subject !== savedRef.current.subject) patch.subject = subject
    if (body !== savedRef.current.body) patch.bodyHtml = body
    // Nothing changed. The route rejects a patch with no keys, and the `−`, the
    // `✕`, and the unmount below all flush unconditionally.
    if (Object.keys(patch).length === 0) return

    // Marked saved BEFORE the await, so a `−` pressed while this request is in
    // flight does not send the same keys a second time.
    savedRef.current = { subject, body }
    await saveDraft(draftId, patch)
  }, [subject, body, draftId, saveDraft])

  // The debounce. `flush` changes identity exactly when the text does, so this
  // effect is the "1200 ms after the last keystroke" rule written out.
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

  // Built from the LOCAL subject, so the header renames itself as the rep types
  // rather than a save later.
  const title = draftTitle({ subject, toAddrs: draft.toAddrs })
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

      <Textarea
        aria-label="Message"
        placeholder="Write a message"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        // `field-sizing-fixed` overrides the primitive's grow-with-content
        // behaviour: the card is a fixed 26rem, so the body scrolls inside it
        // instead of pushing the footer off the bottom.
        className="field-sizing-fixed min-h-0 flex-1 rounded-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />

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
