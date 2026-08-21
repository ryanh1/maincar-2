import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  isOAuthPopupMessage,
  useConnectIntegration,
  useGetIntegrations,
} from '@/hooks/integrations'
import type { ConnectMode, IntegrationCard, Provider } from '@/hooks/integrations'
import { useUrlString } from '@/hooks/urlState'
import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuth } from '@/providers/useAuth'

import { Settings_Integrations_MailboxDrawer } from './Settings_Integrations_MailboxDrawer'
import { Settings_Integrations_ProviderCard } from './Settings_Integrations_ProviderCard'

// A small, centred window is enough for a consent screen and keeps the rep's page in
// view behind it (SPEC-int-hub-ui.md § Consent). Named so a second click reuses the
// same window instead of stacking a new one.
const POPUP_NAME = 'maincar-oauth'
const POPUP_WIDTH = 520
const POPUP_HEIGHT = 680

/** The popup features string, centred over the current window. */
function popupFeatures(): string {
  const left = window.screenX + Math.max(0, (window.outerWidth - POPUP_WIDTH) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - POPUP_HEIGHT) / 2)
  return `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${Math.round(left)},top=${Math.round(top)}`
}

/**
 * Settings → Integrations: one card per provider, and the popup consent flow.
 *
 * The rep keeps the page they were on while they consent, so the grant is collected in
 * a POPUP rather than a full-page redirect. Two things end that popup, and both are
 * handled here so a card can never spin forever:
 *  - the callback page posts its result back and we act on it (trusting only our own
 *    origin), and
 *  - a 500 ms poll catches the rep closing the window by hand, where no message is ever
 *    coming.
 *
 * The tab owns the popup because a popup MUST be opened synchronously inside the click,
 * before any `await` — which is a thing the card, one per provider, should not each try
 * to do. The card only hands the intent up through `onConnect`.
 */
export function Settings_IntegrationsTab() {
  const { org, user } = useAuth()
  const orgId = org?.id ?? null

  const integrations = useGetIntegrations(orgId)
  const connect = useConnectIntegration()
  const queryClient = useQueryClient()
  const [, setMailboxId] = useUrlString('mailbox')

  // Which provider's popup is open, so exactly that provider's card reads busy. `null`
  // when no consent is in flight.
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null)
  const popupRef = useRef<Window | null>(null)
  const pollRef = useRef<number | null>(null)

  function invalidate(): void {
    if (!orgId) return
    // `all(orgId)` is a prefix of both the card list and the health badge, so one call
    // refreshes both after consent lands.
    void queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all(orgId) })
  }

  // Stop watching a popup: clear the poll and drop the handle. Idempotent, so the
  // message listener and the poll can both call it without racing.
  function stopWatching(): void {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    popupRef.current = null
  }

  // The listener trusts a `message` ONLY from the app's own origin, and only when the
  // payload is our shape — the second gate against a foreign frame posting garbage from
  // the right origin. Keyed on `orgId` so `invalidate` refetches the right org's cards.
  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return
      if (!isOAuthPopupMessage(event.data)) return

      const message = event.data
      stopWatching()
      setBusyProvider(null)
      invalidate()

      if (message.ok) {
        toast.success(
          message.emailAddress ? `Connected ${message.emailAddress}.` : 'Connected.',
        )
      } else {
        // The failure toast carries the server's own words, so the rep reads what the
        // provider actually refused, not a generic line.
        toast.error(message.statusDetail || 'Could not finish connecting. Try again.')
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // The listener is torn down above; the interval is imperative (started in a click, not
  // an effect), so it needs its own unmount cleanup or it would outlive the tab.
  useEffect(() => () => stopWatching(), [])

  async function handleConnect(card: IntegrationCard, mode: ConnectMode): Promise<void> {
    if (!orgId) return

    // The popup is opened SYNCHRONOUSLY inside the click, before any await. Opening it
    // after the server answers is exactly what a pop-up blocker stops, and the rep just
    // sees nothing happen.
    const popup = window.open('', POPUP_NAME, popupFeatures())
    if (!popup) {
      toast.error('Allow pop-ups for this site, then click Connect again.')
      return
    }
    popupRef.current = popup
    setBusyProvider(card.provider)

    // The rep can close the popup instead of finishing. Without this poll the card spins
    // forever waiting for a message that is never coming.
    pollRef.current = window.setInterval(() => {
      if (popupRef.current?.closed) {
        stopWatching()
        setBusyProvider(null)
        invalidate()
      }
    }, 500)

    try {
      const { url } = await connect.mutateAsync({
        orgId,
        provider: card.provider,
        mode,
        connectionId: card.connection?.id,
      })
      popup.location.href = url
    } catch (error) {
      // The authorize call failed, so there is nothing for the popup to show. Close it
      // and clear the busy state rather than leave an empty window and a spinning card.
      popup.close()
      stopWatching()
      setBusyProvider(null)
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Could not start connecting. Check your connection and try again.',
      )
    }
  }

  if (!org || !orgId) return null

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">Connect the account you send email from.</p>
      </div>

      {integrations.isPending && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {integrations.isError && (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <p className="text-sm text-destructive">
            {integrations.error instanceof ApiError
              ? integrations.error.message
              : 'Could not load your integrations.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void integrations.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {integrations.data && (
        <div className="flex flex-col gap-3">
          {integrations.data.integrations.map((card) => (
            <Settings_Integrations_ProviderCard
              key={card.provider}
              card={card}
              orgId={orgId}
              onConnect={(mode) => void handleConnect(card, mode)}
              connectBusy={busyProvider === card.provider}
              onMailboxOpenSettings={setMailboxId}
            />
          ))}
        </div>
      )}

      <Settings_Integrations_MailboxDrawer orgId={orgId} timeZone={user?.timeZone} />
    </section>
  )
}
