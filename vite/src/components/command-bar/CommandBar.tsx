import { useMemo, useState } from 'react'
import { File, Mail, Phone, Trash2 } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
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
import { ComposerCard } from '@/components/composer/ComposerCard'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useComposer } from '@/components/composer/composerContext'
import { useDialer } from '@/components/dialer/dialerContext'
import type { EmailDraft } from '@/lib/emailTypes'
import { LG_BREAKPOINT_PX, useWindowWidth } from '@/components/composer/desktopOnly'
import { useOutreachLayout } from '@/components/outreachLayout'

interface CommandBarProps {
  /** Open drafts currently hidden only because the desktop dock cannot fit them. */
  hiddenDraftIds?: string[]
  /** Lets the dock promote a restored width-hidden card into a visible slot. */
  onSelectDraft?: (draftId: string) => void
}

function draftLabel(draft: EmailDraft): string {
  return draft.toAddrs.find((address) => address.trim())?.trim() ?? draft.recordId ?? 'No recipient'
}

function draftSubject(draft: EmailDraft): string {
  return draft.subject?.trim() || 'New message'
}

/**
 * The persistent place to begin outreach. Workflows that do not exist yet are
 * intentionally absent: a visible action must always have a working outcome.
 */
export function CommandBar({ hiddenDraftIds = [], onSelectDraft }: CommandBarProps) {
  const { drafts, discardDraft, openComposer, reopenCard } = useComposer()
  const { expandDialer } = useDialer()
  const width = useWindowWidth()
  const outreachLayout = useOutreachLayout()
  const [query, setQuery] = useState('')
  const [mobileDraftId, setMobileDraftId] = useState<string | null>(null)
  const [mobileDraftsOpen, setMobileDraftsOpen] = useState(false)
  const [draftToDelete, setDraftToDelete] = useState<EmailDraft | null>(null)
  const narrow = !outreachLayout.usesRail
  // Below the desktop dock threshold, a card has no safe corner to occupy.
  // Tablet and phone therefore share the full-screen composer and sheet list.
  const compact = width < LG_BREAKPOINT_PX

  const recoverableDrafts = useMemo(() => {
    const hidden = new Set(hiddenDraftIds)
    const needle = query.trim().toLowerCase()
    return drafts
      .filter((draft) => compact || !draft.isOpen || hidden.has(draft.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((draft) => {
        if (!needle) return true
        return `${draftLabel(draft)} ${draftSubject(draft)}`.toLowerCase().includes(needle)
      })
  }, [compact, drafts, hiddenDraftIds, query])
  const totalRecoverable = useMemo(
    () => drafts.filter((draft) => compact || !draft.isOpen || hiddenDraftIds.includes(draft.id)).length,
    [compact, drafts, hiddenDraftIds],
  )
  const mobileDraft = compact ? drafts.find((draft) => draft.id === mobileDraftId && draft.isOpen) : null

  async function composeEmail() {
    const draft = await openComposer()
    if (draft) {
      onSelectDraft?.(draft.id)
      if (compact) {
        setMobileDraftId(draft.id)
        setMobileDraftsOpen(false)
      }
    }
  }

  async function restoreDraft(draft: EmailDraft) {
    onSelectDraft?.(draft.id)
    if (!draft.isOpen) await reopenCard(draft.id)
    if (compact) {
      setMobileDraftId(draft.id)
      setMobileDraftsOpen(false)
    }
  }

  function deleteDraft(): void {
    if (!draftToDelete) return
    void discardDraft(draftToDelete.id)
    if (mobileDraftId === draftToDelete.id) setMobileDraftId(null)
    setDraftToDelete(null)
  }

  const draftsLabel = `Open ${totalRecoverable} email draft${totalRecoverable === 1 ? '' : 's'}`

  return (
    <div
      role="toolbar"
      aria-label="Outreach actions"
      className={narrow
        ? 'fixed bottom-0 left-0 right-0 z-[120] flex h-12 flex-row items-center justify-around border-t border-border bg-surface px-3'
        : 'fixed inset-y-0 right-0 z-[120] flex w-16 flex-col items-center justify-end gap-2 border-l border-border bg-surface pb-6'}
    >
      {totalRecoverable > 0 && compact ? (
        <Sheet open={mobileDraftsOpen} onOpenChange={(open) => {
          setMobileDraftsOpen(open)
          if (!open) setQuery('')
        }}>
          <SheetTrigger asChild>
            <IconButton tooltip={draftsLabel} className="relative">
              <File size={16} aria-hidden />
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground" aria-hidden>
                {totalRecoverable}
              </span>
            </IconButton>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[75dvh] gap-0 overflow-y-auto p-4 pb-6">
            <SheetHeader className="p-0 pr-8"><SheetTitle>Drafts</SheetTitle></SheetHeader>
            <Button variant="ghost" className="mt-2 justify-start" onClick={() => void composeEmail()}>Write an email</Button>
            {totalRecoverable > 6 ? <Input aria-label="Search drafts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search drafts" className="my-2" /> : null}
            <div className="mt-2 flex flex-col gap-1">
              {recoverableDrafts.map((draft) => (
                <div key={draft.id} className="flex items-center gap-1">
                  <Button variant="ghost" className="h-auto flex-1 justify-start py-2 text-left" onClick={() => void restoreDraft(draft)}>
                    <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{draftLabel(draft)}</span><span className="truncate text-xs text-muted-foreground">{draftSubject(draft)}</span></span>
                  </Button>
                  <IconButton tooltip={`Delete draft for ${draftLabel(draft)}`} onClick={() => setDraftToDelete(draft)}>
                    <Trash2 size={16} aria-hidden />
                  </IconButton>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : totalRecoverable > 0 ? (
        <DropdownMenu onOpenChange={(open) => { if (!open) setQuery('') }}>
          <DropdownMenuTrigger asChild>
            <IconButton tooltip={draftsLabel} className="relative">
              <File size={16} aria-hidden />
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground" aria-hidden>
                {totalRecoverable}
              </span>
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={narrow ? 'top' : 'left'} align={narrow ? 'center' : 'end'} className="w-80 p-2">
            <DropdownMenuLabel><h2>Drafts</h2></DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void composeEmail()}>Write an email</DropdownMenuItem>
            <DropdownMenuSeparator />
            {totalRecoverable > 6 ? (
              <Input
                aria-label="Search drafts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search drafts"
                className="mb-2"
              />
            ) : null}
            {recoverableDrafts.map((draft) => (
              <div key={draft.id} className="flex items-center gap-1">
                <DropdownMenuItem onSelect={() => void restoreDraft(draft)} className="h-auto flex-1 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{draftLabel(draft)}</span>
                    <span className="truncate text-xs text-muted-foreground">{draftSubject(draft)}</span>
                  </span>
                </DropdownMenuItem>
                <IconButton tooltip={`Delete draft for ${draftLabel(draft)}`} onClick={() => setDraftToDelete(draft)}>
                  <Trash2 size={16} aria-hidden />
                </IconButton>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <IconButton tooltip="Write an email" onClick={() => void composeEmail()}>
        <Mail size={16} aria-hidden />
      </IconButton>
      <IconButton tooltip="Open the dialer" onClick={() => expandDialer()}>
        <Phone size={16} aria-hidden />
      </IconButton>
      {mobileDraft ? <ComposerCard draft={mobileDraft} fullScreen onDismiss={() => setMobileDraftId(null)} /> : null}
      <AlertDialog open={draftToDelete !== null} onOpenChange={(open) => !open && setDraftToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteDraft}>Delete draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
