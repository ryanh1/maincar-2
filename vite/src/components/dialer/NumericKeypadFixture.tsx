import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'

import { NumericKeypad } from '@/components/dialer/NumericKeypad'
import { DialerContext, type DialerContextValue } from '@/components/dialer/dialerContext'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuthStore } from '@/store/authStore'

const queryClient = new QueryClient()

const fixtureDialer: DialerContextValue = {
  view: 'expanded',
  phase: 'idle',
  mode: 'keypad',
  dialing: false,
  elapsedSeconds: 0,
  activeCall: null,
  canControlAudio: false,
  expandDialer: () => undefined,
  collapseDialer: () => undefined,
  toggleView: () => undefined,
  startCall: () => undefined,
  adoptCall: () => undefined,
  connectCall: () => undefined,
  endCall: () => undefined,
  cancelCall: () => undefined,
  reset: () => undefined,
  placeDeviceCall: async () => undefined,
  muteCall: () => undefined,
  sendDigits: () => undefined,
}

/** Development-only fixture for the one-call outbound-number browser journey. */
export function NumericKeypadFixture() {
  // The fixture intentionally bypasses Firebase. Its browser test intercepts
  // the two API requests so it can prove the picker sends and then clears a
  // one-call selection without a live account, Voice Device, or Twilio request.
  // This must be an effect, not a module-level mutation: main.tsx imports all
  // fixtures in production even though it only renders them in development.
  useEffect(() => {
    useAuthStore.setState({
      org: {
        id: 'org-fixture',
        name: 'Dialer fixture',
        logo: null,
        avatarUrl: null,
        enabled: true,
        createdAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
      authLoading: false,
    })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DialerContext.Provider value={fixtureDialer}>
          <main className="flex min-h-dvh items-center justify-center bg-bg p-6">
            <section aria-labelledby="numeric-keypad-fixture-title" className="w-full max-w-md border border-border bg-surface p-4">
              <h1 id="numeric-keypad-fixture-title" className="text-base font-semibold">Dialer number picker fixture</h1>
              <div className="mt-4">
                <NumericKeypad />
              </div>
            </section>
          </main>
          <Toaster />
        </DialerContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
