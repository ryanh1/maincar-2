import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import {
  useCreateEmailDraft,
  useDeleteEmailDraft,
  useGetEmailDrafts,
  useUpdateEmailDraft,
} from '@/hooks/email'
import type { EmailDraft, EmailDraftInput, EmailDraftPatch } from '@/lib/emailTypes'
import { useAuth } from '@/providers/useAuth'
import { ComposerContext, type ComposerContextValue } from './composerContext'

/**
 * The composer's state, mounted in `ProtectedLayout` OUTSIDE `<Outlet />`.
 *
 * That placement is the whole feature. A rep opens a card, keeps browsing, and
 * the half-written email is still there only because this component never
 * unmounts. Move it inside the Outlet and every card dies on the next click.
 */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const { org } = useAuth()
  const orgId = org?.id ?? null

  // The dock's own copy, and the source of truth for a card while it is open.
  // The drafts query only ever hydrates this — it never overwrites it.
  const [drafts, setDrafts] = useState<EmailDraft[]>([])

  const { data } = useGetEmailDrafts(orgId)
  // Destructured because TanStack Query hands back a stable `mutateAsync`, so
  // every callback below keeps its identity across renders and the `c` listener
  // is not torn down and re-added on each one.
  const { mutateAsync: createDraft } = useCreateEmailDraft()
  const { mutateAsync: updateDraft } = useUpdateEmailDraft()
  const { mutateAsync: deleteDraft } = useDeleteEmailDraft()

  // What `drafts` above was built from: the org it belongs to, and the list
  // response already folded into it.
  const [hydrated, setHydrated] = useState<HydratedFrom>({ orgId, drafts: undefined })

  // Both branches adjust state DURING render rather than in an effect. React
  // re-runs this component before committing, so nothing renders twice and the
  // dock is never briefly showing another org's drafts
  // (https://react.dev/reference/react/useState → adjusting state when props change).
  if (hydrated.orgId !== orgId) {
    // Switching orgs empties the dock. A draft belongs to one org, and the query
    // re-hydrates from the org just switched into.
    setHydrated({ orgId, drafts: undefined })
    setDrafts([])
  } else if (data && data.drafts !== hydrated.drafts) {
    // The first load MERGES rather than replaces. A rep can press `c` before the
    // list comes back, and a plain assignment would wipe the card they just
    // opened. The local row always wins on a collision: its text is still
    // sitting in a 1200 ms debounce and is newer than anything the server has
    // (SPEC-composer-dock.md → Code style, rule 2).
    setHydrated({ orgId, drafts: data.drafts })
    setDrafts((current) => {
      const mine = new Set(current.map((d) => d.id))
      const fresh = data.drafts.filter((d) => !mine.has(d.id))
      if (fresh.length === 0) return current
      // Server rows first: they are older, and the dock lays cards out oldest
      // on the left.
      return [...fresh, ...current]
    })
  }

  // Draft ids whose DELETE is in flight, so a second confirm of the same card is
  // ignored rather than sent. A ref rather than state: nothing renders from it,
  // and it has to be readable and writable inside one synchronous call.
  const discarding = useRef(new Set<string>())

  const openComposer = useCallback(
    async (seed?: EmailDraftInput): Promise<EmailDraft | null> => {
      if (!orgId) return null

      try {
        // `mutateAsync`, not `mutate`: two quick presses of `c` are two awaited
        // creates, so both cards land. `mutate` would let the second render
        // over the first's pending state and the rep would get one card.
        const { draft } = await createDraft({ orgId, ...seed })
        setDrafts((current) => [...current, draft])
        return draft
      } catch (err) {
        // The server names the 12-card limit in its own 409 sentence. Show that
        // sentence, never a rewrite of it.
        toast.error(err instanceof ApiError ? err.message : 'Could not open a composer. Try again.')
        return null
      }
    },
    [orgId, createDraft],
  )

  const saveDraft = useCallback(
    async (draftId: string, patch: EmailDraftPatch) => {
      // The patch is merged locally and the PATCH response is thrown away on
      // purpose. Writing the response back would push the server's copy of the
      // body at an editor the rep is still typing in, which resets the caret
      // mid-sentence (SPEC-composer-dock.md → Code style, rule 3).
      setDrafts((current) => current.map((d) => (d.id === draftId ? { ...d, ...patch } : d)))

      if (!orgId) return

      try {
        await updateDraft({ orgId, draftId, ...patch })
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not save the draft. Try again.')
      }
    },
    [orgId, updateDraft],
  )

  const closeCard = useCallback(
    async (draftId: string) => {
      // Moved to the end of the list as it closes, so `keptDrafts` ends with the
      // most recently closed draft — the one the dock's "3 drafts" button
      // reopens — and a reopened card comes back rightmost, like Gmail.
      setDrafts((current) => {
        const closing = current.find((d) => d.id === draftId)
        if (!closing) return current
        return [...current.filter((d) => d.id !== draftId), closing]
      })
      // Closing is a SAVE. The draft is kept; only discardDraft removes one.
      await saveDraft(draftId, { isOpen: false })
    },
    [saveDraft],
  )

  const reopenCard = useCallback(
    // Expanded, not as a chip: a card that came back collapsed would read as a
    // click that did nothing.
    (draftId: string) => saveDraft(draftId, { isOpen: true, isMinimized: false }),
    [saveDraft],
  )

  const setMinimized = useCallback(
    (draftId: string, isMinimized: boolean) => saveDraft(draftId, { isMinimized }),
    [saveDraft],
  )

  const discardDraft = useCallback(
    async (draftId: string) => {
      if (!orgId) return

      // ONE confirmed discard is ONE delete, however many times the confirm is
      // activated. The AlertDialog's `Discard` button is still mounted and
      // clickable between the click and the render that closes the dialog, and
      // the card behind it stays on screen for the whole of the flush this call
      // is awaited after — so a rep who double-clicks the confirm ran this twice.
      // The second DELETE 404s on a row that is already gone, and the rep read
      // that as "Draft not found" over a card the invalidate-on-error resync had
      // just put back (MAI-88).
      if (discarding.current.has(draftId)) return
      discarding.current.add(draftId)

      // Dropped from the dock first: the rep already confirmed the AlertDialog,
      // so the card leaves now rather than after a round trip. A failed delete
      // is resynced by the invalidation `useDeleteEmailDraft` fires on error,
      // which brings the row back through the merge above.
      setDrafts((current) => current.filter((d) => d.id !== draftId))

      try {
        await deleteDraft({ orgId, draftId })
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not discard the draft. Try again.')
      } finally {
        discarding.current.delete(draftId)
      }
    },
    [orgId, deleteDraft],
  )

  // The `c` hotkey. Bound to the document, because the rep can be anywhere.
  useEffect(() => {
    if (!orgId) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'c') return
      // A modifier means the rep meant a browser or OS shortcut. ⌘C is copy.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      // Inside a field, `c` is the letter c. Opening a card here would eat a
      // keystroke out of whatever they were writing.
      if (isTypingTarget(event.target)) return
      // Something nearer the keystroke already claimed it — a dialog, a menu.
      if (event.defaultPrevented) return

      event.preventDefault()
      void openComposer()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [orgId, openComposer])

  const openDrafts = useMemo(() => drafts.filter((d) => d.isOpen), [drafts])
  const keptDrafts = useMemo(() => drafts.filter((d) => !d.isOpen), [drafts])

  const value = useMemo<ComposerContextValue>(
    () => ({
      drafts,
      openDrafts,
      keptDrafts,
      openComposer,
      saveDraft,
      closeCard,
      reopenCard,
      setMinimized,
      discardDraft,
    }),
    [
      drafts,
      openDrafts,
      keptDrafts,
      openComposer,
      saveDraft,
      closeCard,
      reopenCard,
      setMinimized,
      discardDraft,
    ],
  )

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>
}

/** What the dock's local list was last built from. */
interface HydratedFrom {
  orgId: string | null
  drafts: EmailDraft[] | undefined
}

/** Is the keystroke going into something the rep is writing in? */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
