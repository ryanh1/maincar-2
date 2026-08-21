import { useState } from 'react'
import { Check, CircleAlert, RefreshCw, Settings, TriangleAlert, Unplug } from 'lucide-react'
import { toast } from 'sonner'

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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useDisconnectMailbox, useSetPrimaryMailbox } from '@/hooks/mailboxes'
import type { Mailbox } from '@/lib/mailboxTypes'
import type { ConnectionStatus } from '@/lib/integrationTypes'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

// One mailbox is one send-from address. The rows sit UNDER the provider card header, so
// the provider logo is never repeated per row — it is already above (SPEC-int-mailboxes.md
// AC 8, IH-29). "Exactly one is primary" is a property of the SET: the badge sits on the
// one primary row, and every other row instead offers "Send from this" to move it. The
// promote and disconnect mutations return the WHOLE list and write it straight to the
// cache, so the badge never shows two primaries or none between responses.

/**
 * A mailbox row mirrors its parent connection's status, so it can show its own trouble
 * without a second fetch. Status carries a WORD and an ICON, never a colour alone, so the
 * row works for a rep who cannot tell amber from green (rules/design-system.md → Color).
 * The icon is decorative (`aria-hidden`); the word is the accessible signal. Colours read
 * the status tokens, never a Tailwind palette colour.
 */
const STATUS_STYLE: Record<
  ConnectionStatus,
  { label: string; className: string; Icon: typeof Check }
> = {
  connected: { label: 'Connected', className: 'text-status-success', Icon: Check },
  limited: { label: 'Limited', className: 'text-status-attention', Icon: TriangleAlert },
  error: { label: 'Reconnect needed', className: 'text-status-failed', Icon: CircleAlert },
}

interface RowProps {
  mailbox: Mailbox
  orgId: string
  /**
   * The intent to open this mailbox's settings. The DRAWER that opens from it is IH-30;
   * this row only hands the intent up, so the toolbar's Settings button is wired to a
   * real deep-link state (`?mailbox=<id>`) rather than a dead control.
   */
  onOpenSettings: (mailboxId: string) => void
  /**
   * Re-run consent for this mailbox's provider. The row hands the intent up because a
   * consent popup MUST open synchronously inside the click, before any await — logic the
   * provider card and tab already own (IH-24). Reconnect is shown only when the row needs
   * it, so its very presence is the signal.
   */
  onReconnect: (mailbox: Mailbox) => void
}

/** One send-from address: its name and address, its status, the primary marker, and the toolbar. */
export function Settings_Integrations_MailboxRow({
  mailbox,
  orgId,
  onOpenSettings,
  onReconnect,
}: RowProps) {
  const setPrimary = useSetPrimaryMailbox()
  const status = STATUS_STYLE[mailbox.status]
  const StatusIcon = status.Icon

  function promote(): void {
    setPrimary.mutate(
      { orgId, mailboxId: mailbox.id },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not set the sending mailbox. Check your connection and try again.',
          ),
      },
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      {/* Name and address. When the rep has named the mailbox, the name leads and the
          address is the muted second line; otherwise the address stands alone. */}
      <div className="min-w-0 flex-1">
        {mailbox.displayName ? (
          <>
            <div className="truncate text-sm font-medium text-foreground">
              {mailbox.displayName}
            </div>
            <div className="truncate text-xs text-muted-foreground">{mailbox.emailAddress}</div>
          </>
        ) : (
          <div className="truncate text-sm text-foreground">{mailbox.emailAddress}</div>
        )}
      </div>

      {/* Status word + icon, coloured from the status token. */}
      <span
        className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', status.className)}
      >
        <StatusIcon size={14} aria-hidden />
        {status.label}
      </span>

      {/* The primary marker is a property of the SET: the one primary row shows the badge,
          every other row offers to move it here. */}
      {mailbox.isPrimary ? (
        <Badge variant="secondary" className="shrink-0">
          Primary
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={setPrimary.isPending}
          onClick={promote}
          className="shrink-0"
        >
          {setPrimary.isPending ? 'Setting…' : 'Send from this'}
        </Button>
      )}

      {/* The management toolbar: icon buttons with tooltips, right-aligned. Reconnect is
          present ONLY when this mailbox needs it, so its presence is itself the signal. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton tooltip="Mailbox settings" onClick={() => onOpenSettings(mailbox.id)}>
          <Settings size={16} aria-hidden />
        </IconButton>
        {mailbox.status === 'error' && (
          <IconButton tooltip="Reconnect" onClick={() => onReconnect(mailbox)}>
            <RefreshCw size={16} aria-hidden />
          </IconButton>
        )}
        <DisconnectButton mailbox={mailbox} orgId={orgId} />
      </div>
    </div>
  )
}

/**
 * Disconnect: a NEUTRAL icon that takes a destructive tint on hover only — never a filled
 * destructive button. The `AlertDialog` is the real guard, and it names the address and the
 * loss, because the glyph gives no warning (SPEC-int-mailboxes.md AC 9).
 */
function DisconnectButton({ mailbox, orgId }: { mailbox: Mailbox; orgId: string }) {
  const disconnect = useDisconnectMailbox()
  const [open, setOpen] = useState(false)

  function confirm(): void {
    disconnect.mutate(
      { orgId, mailboxId: mailbox.id },
      {
        onSuccess: () => {
          setOpen(false)
          toast.success(`Maincar can no longer send from ${mailbox.emailAddress}.`)
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not disconnect. Check your connection and try again.',
          ),
      },
    )
  }

  return (
    <>
      <IconButton
        tooltip="Disconnect"
        className="hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Unplug size={16} aria-hidden />
      </IconButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {mailbox.emailAddress}?</AlertDialogTitle>
            <AlertDialogDescription>
              Maincar can no longer send from this address.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={(event) => {
                // Hold the dialog open until the server answers, so a refused disconnect
                // reports its reason instead of vanishing.
                event.preventDefault()
                confirm()
              }}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface ListProps {
  mailboxes: Mailbox[]
  orgId: string
  onOpenSettings: (mailboxId: string) => void
  onReconnect: (mailbox: Mailbox) => void
}

/**
 * The mailbox list under a provider card header. An empty list renders an INVITATION to
 * act, not an explanation of emptiness (rules/copy.md) — never a bare empty list.
 */
export function Settings_Integrations_MailboxList({
  mailboxes,
  orgId,
  onOpenSettings,
  onReconnect,
}: ListProps) {
  if (mailboxes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect an account to send email from Maincar.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {mailboxes.map((mailbox) => (
        <Settings_Integrations_MailboxRow
          key={mailbox.id}
          mailbox={mailbox}
          orgId={orgId}
          onOpenSettings={onOpenSettings}
          onReconnect={onReconnect}
        />
      ))}
    </div>
  )
}
