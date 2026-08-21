import { useState } from 'react'
import { Check, ChevronDown, CircleAlert, Minus, TriangleAlert } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import {
  recoveryFor,
  preConnectNotesFor,
  useDisconnectIntegration,
  useTestIntegration,
} from '@/hooks/integrations'
import type {
  ConnectionStatus,
  IntegrationCard,
  IntegrationConnection,
  TestConnectionResult,
} from '@/hooks/integrations'
import type { ConnectMode } from '@/hooks/integrations'
import { useGetMailboxes } from '@/hooks/mailboxes'
import type { Mailbox } from '@/lib/mailboxTypes'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

import { Settings_Integrations_ProviderMark } from './Settings_Integrations_ProviderMark'
import { Settings_Integrations_MailboxList } from './Settings_Integrations_MailboxRow'

// The governing rule of the whole Integration Hub, and the one this card exists to
// keep: GREEN MEANS EVERY REQUESTED PERMISSION IS PRESENT AND WORKING, AND NOTHING
// ELSE. A connection that granted reading but refused sending is `limited`, not
// `connected` — amber, never green, and never a red error either, because
// reading-without-sending is a legitimate choice the rep made on purpose. The server
// decides the status (server/src/lib/oauthScopes.ts → evaluateGrant); the card only
// ever colours what it is told, and never upgrades a partial grant to green.

/**
 * Status carries a WORD and an ICON, never a colour alone, so the card works for a rep
 * who cannot tell amber from green (rules/design-system.md → Color). The icon is
 * decorative (`aria-hidden`); the word is the accessible name. Colours read the status
 * tokens, never a Tailwind palette colour.
 */
const STATUS_STYLE: Record<
  ConnectionStatus,
  { label: string; className: string; Icon: typeof Check }
> = {
  connected: { label: 'Connected', className: 'text-status-success', Icon: Check },
  limited: {
    label: 'Limited — missing permission',
    className: 'text-status-attention',
    Icon: TriangleAlert,
  },
  error: { label: 'Reconnect needed', className: 'text-status-failed', Icon: CircleAlert },
}

/** The one primary action a card offers, by status. Everything else on the card is secondary. */
const PRIMARY_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Test',
  limited: 'Fix permissions',
  error: 'Reconnect',
}

interface Props {
  card: IntegrationCard
  orgId: string
  /**
   * Starting consent opens a popup, and a popup MUST open synchronously inside the
   * click before any `await` or a blocker stops it — so that logic lives in the tab
   * (IH-24), and the card only hands the intent up. `mode: 'connect'` asks for every
   * permission; `mode: 'fix'` re-asks for only the missing ones.
   */
  onConnect: (mode: ConnectMode) => void
  /** True while the tab's popup is open, so the connect-family button reads busy. */
  connectBusy?: boolean
  /** Mailbox-level callbacks for opening settings and reconnecting. */
  onMailboxOpenSettings?: (mailboxId: string) => void
  onMailboxReconnect?: (mailbox: Mailbox) => void
}

/** One card per provider, showing its honest state and the one action that moves it forward. */
export function Settings_Integrations_ProviderCard({
  card,
  orgId,
  onConnect,
  connectBusy = false,
  onMailboxOpenSettings,
  onMailboxReconnect,
}: Props) {
  const { connection } = card

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Settings_Integrations_ProviderMark provider={card.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{card.providerLabel}</span>
            <StatusLine connection={connection} />
          </div>
          {connection ? (
            <ConnectedBody
              card={card}
              connection={connection}
              orgId={orgId}
              onConnect={onConnect}
              connectBusy={connectBusy}
              onMailboxOpenSettings={onMailboxOpenSettings}
              onMailboxReconnect={onMailboxReconnect}
            />
          ) : (
            <NotConnectedBody card={card} onConnect={onConnect} connectBusy={connectBusy} />
          )}
        </div>
      </div>
    </div>
  )
}

/** The status word and icon, or "Not connected" when there is no connection yet. */
function StatusLine({ connection }: { connection: IntegrationConnection | null }) {
  if (!connection) {
    return <span className="text-sm text-muted-foreground">Not connected</span>
  }
  const style = STATUS_STYLE[connection.status]
  const Icon = style.Icon
  return (
    <span className={cn('flex items-center gap-1.5 text-sm font-medium', style.className)}>
      <Icon size={16} aria-hidden />
      {style.label}
    </span>
  )
}

// --- Not connected -----------------------------------------------------------

function NotConnectedBody({
  card,
  onConnect,
  connectBusy,
}: {
  card: IntegrationCard
  onConnect: (mode: ConnectMode) => void
  connectBusy: boolean
}) {
  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect to send email as you and to see meetings on your records.
      </p>
      <PermissionList permissions={card.requiredPermissions} state={() => 'unknown'} />
      <BeforeYouConnect notes={preConnectNotesFor(card.provider)} />
      <div>
        <Button size="sm" disabled={connectBusy} onClick={() => onConnect('connect')}>
          {connectBusy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </div>
  )
}

/** The collapsed "Before you connect" disclosure, naming failures that look like bugs cold. */
function BeforeYouConnect({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false)
  if (notes.length === 0) return null
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary"
      >
        <ChevronDown
          size={16}
          aria-hidden
          className={cn('transition-transform', open && 'rotate-180')}
        />
        Before you connect
      </button>
      {open && (
        <ul className="mt-2 space-y-1 pl-6">
          {notes.map((note) => (
            <li key={note} className="text-sm text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- Connected / limited / error ---------------------------------------------

function ConnectedBody({
  card,
  connection,
  orgId,
  onConnect,
  connectBusy,
  onMailboxOpenSettings,
  onMailboxReconnect,
}: {
  card: IntegrationCard
  connection: IntegrationConnection
  orgId: string
  onConnect: (mode: ConnectMode) => void
  connectBusy: boolean
  onMailboxOpenSettings?: (mailboxId: string) => void
  onMailboxReconnect?: (mailbox: Mailbox) => void
}) {
  const test = useTestIntegration()
  const testResult = test.data?.result ?? null
  const mailboxes = useGetMailboxes(orgId)

  function runTest(): void {
    test.mutate(
      { orgId, connectionId: connection.id },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not test the connection. Check your connection and try again.',
          ),
      },
    )
  }

  const healthy = connection.status === 'connected'
  const primaryLabel = PRIMARY_LABEL[connection.status]

  // Test is the primary action on a healthy card; on limited/error the primary re-runs
  // consent (Fix permissions / Reconnect) and Test drops to a secondary probe.
  function onPrimary(): void {
    if (connection.status === 'connected') runTest()
    else if (connection.status === 'limited') onConnect('fix')
    else onConnect('connect')
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm text-foreground">{connection.emailAddress}</span>
        {connection.lastValidatedAt && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {verifiedAgo(connection.lastValidatedAt)}
          </span>
        )}
      </div>

      <PermissionList
        permissions={card.requiredPermissions}
        state={(label) => permissionState(label, connection, testResult)}
      />

      {/* The mailboxes this connection provides. Only render when we have data, and pass
          the callbacks for mailbox-level actions (settings drawer and reconnect). */}
      {mailboxes.data && (
        <div className="border-t border-border pt-3">
          <Settings_Integrations_MailboxList
            mailboxes={mailboxes.data.mailboxes}
            orgId={orgId}
            onOpenSettings={onMailboxOpenSettings ?? (() => {})}
            onReconnect={onMailboxReconnect ?? (() => {})}
          />
        </div>
      )}

      {/* Names what broke, in the server's plain words. The status word says a permission
          is missing; this line says which capability it costs. */}
      {!healthy && connection.statusDetail && (
        <p className="text-sm text-muted-foreground">{connection.statusDetail}</p>
      )}

      {!healthy && <RecoveryBlock errorCode={connection.errorCode} />}

      {testResult && <TestResult result={testResult} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={test.isPending || connectBusy}
          onClick={onPrimary}
        >
          {primaryLabel === 'Test' && test.isPending
            ? 'Testing…'
            : connectBusy && primaryLabel !== 'Test'
              ? 'Connecting…'
              : primaryLabel}
        </Button>

        {/* On limited/error, Test is a secondary probe so the rep can pin which
            capability failed, and see it named in the result below. */}
        {!healthy && (
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={runTest}>
            {test.isPending ? 'Testing…' : 'Test'}
          </Button>
        )}

        <DisconnectButton
          orgId={orgId}
          connection={connection}
          providerLabel={card.providerLabel}
        />
      </div>
    </div>
  )
}

/** The recovery block: a title and concrete steps, keyed from the connection's error code. */
function RecoveryBlock({ errorCode }: { errorCode: IntegrationConnection['errorCode'] }) {
  const recovery = recoveryFor(errorCode)
  return (
    <div className="rounded-md border border-border bg-muted/60 p-3">
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

/** A Test's verdict PER capability, so the rep sees which permission failed and why. */
function TestResult({ result }: { result: TestConnectionResult }) {
  return (
    <div className="rounded-md border border-border bg-muted/60 p-3">
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

/** Disconnect, `destructive` and behind an `AlertDialog` naming the address and the loss. */
function DisconnectButton({
  orgId,
  connection,
  providerLabel,
}: {
  orgId: string
  connection: IntegrationConnection
  providerLabel: string
}) {
  const disconnect = useDisconnectIntegration()
  const [open, setOpen] = useState(false)

  function confirm(): void {
    disconnect.mutate(
      { orgId, connectionId: connection.id },
      {
        onSuccess: () => {
          setOpen(false)
          toast.success(`Maincar no longer reads ${connection.emailAddress}.`)
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Disconnect
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {providerLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Maincar stops reading {connection.emailAddress}. Connect it again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnect.isPending}
              onClick={(event) => {
                // Hold the dialog open until the server answers, so a refused
                // disconnect reports its reason instead of vanishing.
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

// --- The permission list -----------------------------------------------------

type PermissionRenderState = 'granted' | 'missing' | 'unknown'

/**
 * Whether a required permission is granted, missing, or not yet known — honestly, from
 * only what the client is told. A withheld scope must NEVER render as granted (green):
 *
 *  - A Test names each capability, so its verdict wins when present (matched by label,
 *    the SAME plain-words string the card shows).
 *  - Absent a test, a `connected` connection has every permission by definition, so all
 *    are granted; anything else is `unknown` rather than a guess, because the client
 *    holds the raw granted scopes but not the label→scope map that would pin which one
 *    is missing. The `statusDetail` line names that in words instead.
 */
function permissionState(
  label: string,
  connection: IntegrationConnection,
  testResult: TestConnectionResult | null,
): PermissionRenderState {
  const capability = testResult?.capabilities.find((c) => c.label === label)
  if (capability) return capability.ok ? 'granted' : 'missing'
  if (connection.status === 'connected') return 'granted'
  return 'unknown'
}

/** The required permissions, each marked granted (check), missing (triangle), or unknown. */
function PermissionList({
  permissions,
  state,
}: {
  permissions: string[]
  state: (label: string) => PermissionRenderState
}) {
  return (
    <ul className="space-y-1">
      {permissions.map((permission) => {
        const value = state(permission)
        return (
          <li key={permission} className="flex items-start gap-1.5 text-sm">
            {value === 'granted' ? (
              <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-status-success" />
            ) : value === 'missing' ? (
              <TriangleAlert
                size={16}
                aria-hidden
                className="mt-0.5 shrink-0 text-status-attention"
              />
            ) : (
              <Minus size={16} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <span className={value === 'granted' ? 'text-foreground' : 'text-muted-foreground'}>
              {permission}
              {value === 'missing' ? ' — not allowed' : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// --- Helpers -----------------------------------------------------------------

/**
 * "Verified 2m ago" from an ISO timestamp. This is a RELATIVE age, not a time of day,
 * so it carries no timezone — the zone-label rule (CLAUDE.md → Dates & Times) governs
 * clock times, and this is neither shown as one nor computed from the server's zone.
 */
function verifiedAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'Verified just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Verified ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Verified ${hours}h ago`
  const days = Math.round(hours / 24)
  return `Verified ${days}d ago`
}
