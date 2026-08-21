import { useId, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeLinkUrl } from './linkUrl'
import type { LinkRequest } from './RichTextEditor'

export interface RichTextEditorUrlDialogProps {
  /**
   * The open request, or `null` for closed. The whole dialog is driven by this
   * one prop: `RichTextEditor` hands over a request that has already captured
   * the rep's selection, so the dialog may stay open as long as it likes.
   */
  request: LinkRequest | null
  /** Called on cancel, on Escape, and after a link is applied or removed. */
  onClose: () => void
}

interface LinkFormProps {
  request: LinkRequest
  onClose: () => void
}

/**
 * The fields, mounted fresh on every open.
 *
 * Radix unmounts a closed dialog's content, so this component's state is seeded
 * from the request on mount and never has to be reset — no effect syncing props
 * into state, and no chance of the previous link's URL surviving into the next
 * dialog.
 */
function LinkForm({ request, onClose }: LinkFormProps) {
  const editing = request.href !== null
  const ids = useId()
  const textId = `${ids}-text`
  const urlId = `${ids}-url`
  const errorId = `${ids}-error`

  const [text, setText] = useState(request.text)
  const [url, setUrl] = useState(request.href ?? '')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const result = normalizeLinkUrl(url)
    if (!result.ok) {
      // Refused, and it says so. The dialog stays open on the rep's own text so
      // they can fix it, rather than closing over a link that was never made.
      setError(result.message)
      return
    }
    request.apply(result.href, text)
    onClose()
  }

  function onRemove() {
    request.apply(null)
    onClose()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit link' : 'Add link'}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={textId}>Text</Label>
        <Input
          id={textId}
          value={text}
          placeholder="Acme pricing"
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={urlId}>Web address</Label>
        <Input
          id={urlId}
          value={url}
          autoFocus
          placeholder="acme.com"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setUrl(event.target.value)
            // Cleared on edit: leaving the old complaint under a URL the rep is
            // already fixing reads as a second, new problem.
            setError(null)
          }}
        />
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        {editing ? (
          <Button type="button" variant="secondary" onClick={onRemove}>
            Remove link
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{editing ? 'Save' : 'Add'}</Button>
      </DialogFooter>
    </form>
  )
}

/**
 * The URL dialog behind the toolbar's link button and `Cmd/Ctrl+K`.
 *
 * It is deliberately not wired inside `RichTextEditor`: the editor raises a
 * `LinkRequest` and the host decides what asks for the URL. Keeping the dialog
 * out here is what lets the editor stay a shared, generic component with no
 * dialog, no portal, and no opinion about how a URL is collected
 * (SPEC-composer-body.md → Project structure).
 *
 * Three behaviours worth naming, because they are the ones a rep notices:
 *
 * - **On a selection**, the selected words are the link's text and are marked in
 *   place, so a bold phrase stays bold.
 * - **On a collapsed caret**, there is nothing to mark, so the Text field is
 *   what gets inserted — and if the rep leaves it empty, the URL itself is.
 * - **On an existing link**, the URL and the text arrive filled in and a
 *   `Remove link` button appears. Removing is the only action here that needs
 *   no valid URL.
 */
export function RichTextEditorUrlDialog({ request, onClose }: RichTextEditorUrlDialogProps) {
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/*
        No `DialogDescription`: the title and two labelled fields already say
        everything a line under the heading could (.claude/rules/copy.md → one
        sentence, cut the second). Passing `aria-describedby={undefined}` is
        Radix's own way of saying that was deliberate rather than forgotten.
      */}
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        {request ? <LinkForm request={request} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}
