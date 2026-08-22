import { useMemo, useState } from 'react'
import { FileText, Mail, Phone } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
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
import { useWindowWidth } from '@/components/composer/desktopOnly'

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
  const { drafts, openComposer, reopenCard } = useComposer()
  const { expandDialer } = useDialer()
  const width = useWindowWidth()
  const [query, setQuery] = useState('')

  const recoverableDrafts = useMemo(() => {
    const hidden = new Set(hiddenDraftIds)
    const needle = query.trim().toLowerCase()
    return drafts
      .filter((draft) => !draft.isOpen || hidden.has(draft.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((draft) => {
        if (!needle) return true
        return `${draftLabel(draft)} ${draftSubject(draft)}`.toLowerCase().includes(needle)
      })
  }, [drafts, hiddenDraftIds, query])
  const totalRecoverable = useMemo(
    () => drafts.filter((draft) => !draft.isOpen || hiddenDraftIds.includes(draft.id)).length,
    [drafts, hiddenDraftIds],
  )
  const narrow = width < 768

  async function restoreDraft(draft: EmailDraft) {
    onSelectDraft?.(draft.id)
    if (!draft.isOpen) await reopenCard(draft.id)
  }

  const draftsLabel = `Open ${totalRecoverable} email draft${totalRecoverable === 1 ? '' : 's'}`

  return (
    <div
      role="toolbar"
      aria-label="Outreach actions"
      className={narrow
        ? 'fixed bottom-0 left-0 right-0 z-[120] flex h-12 flex-row items-center justify-around border-t border-border bg-surface px-3'
        : 'fixed bottom-6 right-6 z-[120] flex w-8 flex-col items-center gap-2'}
    >
      {totalRecoverable > 0 ? (
        <DropdownMenu onOpenChange={(open) => { if (!open) setQuery('') }}>
          <DropdownMenuTrigger asChild>
            <IconButton tooltip={draftsLabel} className="relative">
              <FileText size={16} aria-hidden />
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground" aria-hidden>
                {totalRecoverable}
              </span>
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={narrow ? 'top' : 'left'} align={narrow ? 'center' : 'end'} className="w-80 p-2">
            <DropdownMenuLabel><h2>Drafts</h2></DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void openComposer()}>Write an email</DropdownMenuItem>
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
              <DropdownMenuItem key={draft.id} onSelect={() => void restoreDraft(draft)} className="h-auto py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{draftLabel(draft)}</span>
                  <span className="truncate text-xs text-muted-foreground">{draftSubject(draft)}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <IconButton tooltip="Write an email" onClick={() => void openComposer()}>
        <Mail size={16} aria-hidden />
      </IconButton>
      <IconButton tooltip="Open the dialer" onClick={expandDialer}>
        <Phone size={16} aria-hidden />
      </IconButton>
    </div>
  )
}
