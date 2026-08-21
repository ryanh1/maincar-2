import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CARD_SUBTITLE, preConnectNotesFor } from '@/hooks/integrations'
import type { ConnectMode, IntegrationCard } from '@/hooks/integrations'
import { useGetMailboxes } from '@/hooks/mailboxes'
import type { Mailbox } from '@/lib/mailboxTypes'
import { cn } from '@/lib/utils'

import { Settings_Integrations_MailboxList } from './Settings_Integrations_MailboxRow'
import { Settings_Integrations_ProviderMark } from './Settings_Integrations_ProviderMark'

interface Props {
  card: IntegrationCard
  orgId: string
  onConnect: (mode: ConnectMode) => void
  connectBusy?: boolean
  onMailboxOpenSettings?: (mailboxId: string) => void
  onMailboxReconnect?: (mailbox: Mailbox) => void
}

/**
 * One provider surface. Provider identity and connection creation live here; every
 * account-specific status and action lives in that mailbox's sub-card below it.
 */
export function Settings_Integrations_ProviderCard({
  card,
  orgId,
  onConnect,
  connectBusy = false,
  onMailboxOpenSettings,
  onMailboxReconnect,
}: Props) {
  const mailboxes = useGetMailboxes(orgId)
  const providerMailboxes =
    mailboxes.data?.mailboxes.filter((mailbox) => mailbox.provider === card.provider) ?? []
  // The singular connection remains during the additive API migration. New clients
  // use connections; the fallback keeps an older server response honest.
  const providerConnections = card.connections ?? (card.connection ? [card.connection] : [])
  const hasConnection = providerConnections.length > 0 || providerMailboxes.length > 0

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Settings_Integrations_ProviderMark provider={card.provider} label={card.providerLabel} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{card.providerLabel}</span>
            {!hasConnection && (
              <span className="text-sm text-muted-foreground">Not connected</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{CARD_SUBTITLE[card.provider]}</p>

          <div className="mt-3 flex flex-col gap-3">
            {providerMailboxes.length > 0 && (
              <Settings_Integrations_MailboxList
                mailboxes={providerMailboxes}
                orgId={orgId}
                onOpenSettings={onMailboxOpenSettings ?? (() => {})}
                onReconnect={onMailboxReconnect ?? (() => {})}
              />
            )}

            {!hasConnection && <BeforeYouConnect notes={preConnectNotesFor(card.provider)} />}

            <div>
              <Button size="sm" disabled={connectBusy} onClick={() => onConnect('connect')}>
                {connectBusy ? 'Connecting…' : hasConnection ? 'Connect another' : 'Connect'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Warn about provider consent screens before the first account is connected. */
function BeforeYouConnect({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false)
  if (notes.length === 0) return null

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
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
