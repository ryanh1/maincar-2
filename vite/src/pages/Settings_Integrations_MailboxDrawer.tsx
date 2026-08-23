import { useCallback, useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useWorkspaceUrlState } from '@/hooks/workspaceUrlState'
import {
  useDisconnectMailbox,
  useGetMailboxes,
  useSetPrimaryMailbox,
  useUpdateMailbox,
} from '@/hooks/mailboxes'
import type { Mailbox } from '@/lib/mailboxTypes'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/datetime'

// Per-mailbox settings are deep-linkable through the safe workspace URL codec (SPEC-int-mailboxes.md AC 7,
// IH-30). Open state lives in the URL through `useWorkspaceUrlState`, never `useState`, so a
// shared link opens straight on that mailbox. No sync toggle, import-past-messages
// control, or automation switch lives here: maincar-2 has no pipeline behind any of the
// three, and a live-looking control with nothing behind it is what CLAUDE.md forbids.
// They arrive with the sync initiative.

interface DrawerProps {
  orgId: string
  timeZone: string | null | undefined
}

/** Reads the selected opaque record id and renders that mailbox's settings, or nothing if it names none. */
export function Settings_Integrations_MailboxDrawer({ orgId, timeZone }: DrawerProps) {
  const [workspaceUrlState, updateWorkspaceUrlState] = useWorkspaceUrlState()
  const mailboxId = workspaceUrlState.selectedRecordId ?? ''
  const setMailboxId = useCallback((nextMailboxId: string) => {
    updateWorkspaceUrlState((current) => ({
      ...current,
      ...(nextMailboxId ? { selectedRecordId: nextMailboxId } : { selectedRecordId: undefined }),
    }))
  }, [updateWorkspaceUrlState])
  const mailboxes = useGetMailboxes(orgId)

  const mailbox = mailboxId
    ? mailboxes.data?.mailboxes.find((candidate) => candidate.id === mailboxId)
    : undefined

  // A selected record id that no longer exists (disconnected elsewhere, or simply wrong)
  // closes the drawer instead of rendering an empty one — only once the list has
  // actually loaded, so a fresh deep link isn't closed before its data arrives.
  useEffect(() => {
    if (!mailboxId) return
    if (!mailboxes.isSuccess) return
    if (mailbox) return
    setMailboxId('')
  }, [mailboxId, mailboxes.isSuccess, mailbox, setMailboxId])

  function close(): void {
    setMailboxId('')
  }

  return (
    <Sheet open={Boolean(mailbox)} onOpenChange={(next) => { if (!next) close() }}>
      <SheetContent>
        {mailbox && (
          <Settings_Integrations_MailboxDrawerBody
            key={mailbox.id}
            mailbox={mailbox}
            orgId={orgId}
            timeZone={timeZone}
            onClose={close}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

interface BodyProps {
  mailbox: Mailbox
  orgId: string
  timeZone: string | null | undefined
  onClose: () => void
}

function Settings_Integrations_MailboxDrawerBody({ mailbox, orgId, timeZone, onClose }: BodyProps) {
  const [displayName, setDisplayName] = useState(mailbox.displayName ?? '')
  const updateMailbox = useUpdateMailbox()
  const setPrimary = useSetPrimaryMailbox()

  const trimmed = displayName.trim()
  const nameChanged = trimmed !== (mailbox.displayName ?? '')

  function saveName(): void {
    updateMailbox.mutate(
      { orgId, mailboxId: mailbox.id, displayName: trimmed || null },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not save the name. Check your connection and try again.',
          ),
      },
    )
  }

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
    <>
      <SheetHeader>
        <SheetTitle>{mailbox.emailAddress}</SheetTitle>
        <SheetDescription>
          Connected {formatDateTime(mailbox.connectedAt, timeZone)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mailbox-display-name">Name this mailbox</Label>
          <Input
            id="mailbox-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Only you see this name.</p>
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!nameChanged || updateMailbox.isPending}
              onClick={saveName}
            >
              {updateMailbox.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Sending</Label>
          {mailbox.isPrimary ? (
            <div>
              <Badge variant="secondary">Primary</Badge>
            </div>
          ) : (
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={setPrimary.isPending}
                onClick={promote}
              >
                {setPrimary.isPending ? 'Setting…' : 'Make primary'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
        <DrawerDisconnect mailbox={mailbox} orgId={orgId} onDisconnected={onClose} />
      </div>
    </>
  )
}

/** Disconnect from the drawer: a labeled, destructive-on-confirm action behind an `AlertDialog`. */
function DrawerDisconnect({
  mailbox,
  orgId,
  onDisconnected,
}: {
  mailbox: Mailbox
  orgId: string
  onDisconnected: () => void
}) {
  const disconnect = useDisconnectMailbox()
  const [open, setOpen] = useState(false)

  function confirm(): void {
    disconnect.mutate(
      { orgId, mailboxId: mailbox.id },
      {
        onSuccess: () => {
          setOpen(false)
          toast.success(`Disconnected ${mailbox.emailAddress}.`)
          onDisconnected()
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
      <Button variant="outline" onClick={() => setOpen(true)}>
        Disconnect
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {mailbox.emailAddress}?</AlertDialogTitle>
            <AlertDialogDescription>
              Maincar can no longer read or send from this address.
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
