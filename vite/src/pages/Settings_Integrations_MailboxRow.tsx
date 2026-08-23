import { useState } from 'react'
import {
  Check,
  CircleAlert,
  FlaskConical,
  Loader2,
  RefreshCw,
  Settings,
  TriangleAlert,
  Unplug,
} from 'lucide-react'
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
import { recoveryFor, useTestIntegration } from '@/hooks/integrations'
import type { TestConnectionResult } from '@/hooks/integrations'
import { useDisconnectMailbox, useSetPrimaryMailbox } from '@/hooks/mailboxes'
import { ApiError } from '@/lib/api'
import type { ConnectionStatus } from '@/lib/integrationTypes'
import type { Mailbox } from '@/lib/mailboxTypes'
import { cn } from '@/lib/utils'

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
  onOpenSettings: (mailboxId: string) => void
  onReconnect: (mailbox: Mailbox) => void
}

/** One mailbox owns its status, primary choice, verification, test, settings, and disconnect. */
export function Settings_Integrations_MailboxRow({
  mailbox,
  orgId,
  onOpenSettings,
  onReconnect,
}: RowProps) {
  const setPrimary = useSetPrimaryMailbox()
  const test = useTestIntegration()
  const status = STATUS_STYLE[mailbox.status]
  const StatusIcon = status.Icon
  const testResult = test.data?.result ?? null
  const lastValidatedAt = testResult?.connection?.lastValidatedAt ?? mailbox.lastValidatedAt

  function promote(): void {
    setPrimary.mutate(
      { orgId, mailboxId: mailbox.id },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not set the primary mailbox. Check your connection and try again.',
          ),
      },
    )
  }

  function runTest(): void {
    test.mutate(
      { orgId, connectionId: mailbox.connectionId },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not test the mailbox. Check your connection and try again.',
          ),
      },
    )
  }

  const repairTooltip =
    mailbox.status === 'limited'
      ? `Fix permissions for ${mailbox.emailAddress}`
      : `Reconnect ${mailbox.emailAddress}`

  return (
    <article
      aria-label={`Mailbox ${mailbox.emailAddress}`}
      className="rounded-md border border-border bg-card px-3 py-2"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
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

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:flex-nowrap">
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <span className={cn('flex items-center gap-1 text-xs font-medium', status.className)}>
              <StatusIcon size={14} aria-hidden />
              {status.label}
            </span>
            {lastValidatedAt && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {verifiedAgo(lastValidatedAt)}
              </span>
            )}
          </div>

          {mailbox.isPrimary ? (
            <Badge variant="secondary">Primary</Badge>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={setPrimary.isPending}
              onClick={promote}
            >
              {setPrimary.isPending ? 'Setting…' : 'Make primary'}
            </Button>
          )}

          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              tooltip={`Open settings for ${mailbox.emailAddress}`}
              onClick={() => onOpenSettings(mailbox.id)}
            >
              <Settings size={16} aria-hidden />
            </IconButton>
            <IconButton
              tooltip={`Test ${mailbox.emailAddress}`}
              disabled={test.isPending}
              onClick={runTest}
            >
              {test.isPending ? (
                <Loader2
                  size={16}
                  aria-label={`Testing ${mailbox.emailAddress}`}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <FlaskConical size={16} aria-hidden />
              )}
            </IconButton>
            {mailbox.status !== 'connected' && (
              <IconButton tooltip={repairTooltip} onClick={() => onReconnect(mailbox)}>
                <RefreshCw size={16} aria-hidden />
              </IconButton>
            )}
            <DisconnectButton mailbox={mailbox} orgId={orgId} />
          </div>
        </div>
      </div>

      {mailbox.status !== 'connected' && mailbox.statusDetail && (
        <p className="mt-2 text-sm text-muted-foreground">{mailbox.statusDetail}</p>
      )}
      {mailbox.status !== 'connected' && <RecoveryBlock mailbox={mailbox} />}
      {testResult && <MailboxTestResult result={testResult} />}
      {mailbox.backfill && <MailboxBackfillProgress backfill={mailbox.backfill} />}
    </article>
  )
}

function MailboxBackfillProgress({ backfill }: { backfill: NonNullable<Mailbox['backfill']> }) {
  const activityCount = backfill.matchedCount + backfill.meetingsMatchedCount
  if (backfill.status === 'complete' && activityCount === 0) {
    return (
      <div className="mt-2 rounded-md border border-border bg-muted/60 p-3" role="status">
        <p className="text-sm text-foreground">No matches yet. As you add contacts, we’ll attach their past email automatically.</p>
      </div>
    )
  }

  if (backfill.status === 'complete') {
    return (
      <div className="mt-2 rounded-md border border-border bg-muted/60 p-3" role="status">
        <p className="text-sm text-foreground">Import complete. {activityCount} activities added.</p>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/60 p-3" role="status">
      <p className="text-sm font-medium text-foreground">Importing your email and calendar…</p>
      <div
        aria-label="Import progress"
        aria-valuetext={`Checked ${backfill.scannedCount} messages and ${backfill.eventsScannedCount} events. Matched ${backfill.matchedCount} emails and ${backfill.meetingsMatchedCount} meetings so far`}
        className="mt-2 h-2 overflow-hidden rounded-md bg-surface"
        role="progressbar"
      >
        <div className="h-full w-1/2 bg-primary" />
      </div>
      <p className="mt-2 text-xs tabular-nums text-muted-foreground">
        Matched {backfill.matchedCount} emails and {backfill.meetingsMatchedCount} meetings so far.
      </p>
    </div>
  )
}

function RecoveryBlock({ mailbox }: { mailbox: Mailbox }) {
  const recovery = recoveryFor(mailbox.errorCode)
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/60 p-3">
      <p className="text-sm font-medium text-foreground">{recovery.title}</p>
      <ul className="mt-1 space-y-1">
        {recovery.fixes.map((fix) => (
          <li key={fix} className="text-sm text-muted-foreground">
            {fix}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A per-capability verdict rendered inside only the mailbox that was tested. */
function MailboxTestResult({ result }: { result: TestConnectionResult }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/60 p-3" role="status">
      <p className="text-sm font-medium text-foreground">Test result</p>
      <ul className="mt-1 space-y-1">
        {result.capabilities.map((capability) => (
          <li
            key={capability.capability}
            className="flex items-start gap-1.5 text-sm text-muted-foreground"
          >
            {capability.ok ? (
              <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-status-success" />
            ) : (
              <TriangleAlert
                size={16}
                aria-hidden
                className="mt-0.5 shrink-0 text-status-attention"
              />
            )}
            <span>
              {capability.label}
              {!capability.ok && capability.reason ? ` — ${capability.reason}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DisconnectButton({ mailbox, orgId }: { mailbox: Mailbox; orgId: string }) {
  const disconnect = useDisconnectMailbox()
  const [open, setOpen] = useState(false)

  function confirm(): void {
    disconnect.mutate(
      { orgId, mailboxId: mailbox.id },
      {
        onSuccess: () => {
          setOpen(false)
          toast.success(`Disconnected ${mailbox.emailAddress}.`)
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
        tooltip={`Disconnect ${mailbox.emailAddress}`}
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
              Maincar can no longer read or send from this address.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={(event) => {
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

/** Relative verification age. This is not a clock time and needs no timezone label. */
function verifiedAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'Verified just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Verified ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Verified ${hours}h ago`
  return `Verified ${Math.round(hours / 24)}d ago`
}
