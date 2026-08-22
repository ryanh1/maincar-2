import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { InCallControls } from '@/components/dialer/InCallControls'
import { DialerContext, type DialerContextValue } from '@/components/dialer/dialerContext'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'

const queryClient = new QueryClient()

const fixtureDialer: DialerContextValue = {
  view: 'expanded',
  phase: 'in-progress',
  mode: 'call',
  dialing: true,
  elapsedSeconds: 75,
  activeCall: { orgId: 'org-fixture', callId: 'call-fixture', recording: true },
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

/** Development-only fixture for the in-call recording-status browser journey. */
export function InCallControlsFixture() {
  const [recording, setRecording] = useState(true)

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DialerContext.Provider value={fixtureDialer}>
          <main className="flex min-h-dvh items-center justify-center bg-background p-6">
            <section aria-labelledby="in-call-controls-fixture-title" className="w-full max-w-md border border-border bg-card p-4">
              <h1 id="in-call-controls-fixture-title" className="text-base font-semibold">In-call controls fixture</h1>
              <div className="mt-4 flex flex-col gap-3">
                <Button variant="secondary" size="sm" onClick={() => setRecording((current) => !current)}>
                  {recording ? 'Stop recording' : 'Start recording'}
                </Button>
                <InCallControls orgId="org-fixture" callId="call-fixture" recording={recording} />
              </div>
            </section>
          </main>
        </DialerContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
