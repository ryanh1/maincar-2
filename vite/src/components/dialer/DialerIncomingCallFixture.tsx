import { useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DialerDock } from '@/components/dialer/DialerDock'
import { DialerContext, type DialerContextValue } from '@/components/dialer/dialerContext'
import type { CallDetail } from '@/lib/callTypes'
import { queryKeys } from '@/lib/queryKeys'
import { TooltipProvider } from '@/components/ui/tooltip'

const call: CallDetail = {
  id: 'call-incoming-fixture',
  direction: 'inbound',
  status: 'in-progress',
  fromE164: '+12025550123',
  toE164: '+14155550100',
  recordingPlanned: false,
  recordingReason: 'recording-disabled',
  twilioCallSid: 'CA-incoming-fixture',
  durationS: null,
  startedAt: '2026-08-23T00:00:00.000Z',
  endedAt: null,
  createdAt: '2026-08-23T00:00:00.000Z',
  recordingEnabled: false,
  recordingUrl: null,
  transcriptStatus: 'skipped-not-recorded',
  transcript: null,
  destinationState: null,
  noteText: null,
  review: {
    crm: { person: null, company: null, deal: null },
    recording: { state: 'unavailable', source: null },
    transcript: { state: 'unavailable', pass: null },
    speakers: [],
  },
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
queryClient.setQueryData(queryKeys.calls.detail('org-fixture', call.id), { call })
queryClient.setQueryData(queryKeys.dispositions('org-fixture'), { dispositions: [] })

/** Development-only browser fixture for accepting a pending incoming Voice SDK call. */
export function DialerIncomingCallFixture() {
  const [phase, setPhase] = useState<DialerContextValue['phase']>('ringing')
  const value = useMemo<DialerContextValue>(() => {
    const activeCall = phase === 'idle' ? null : {
      orgId: 'org-fixture', callId: call.id, toE164: call.fromE164, direction: 'inbound' as const, recording: false,
    }
    return {
      view: 'expanded',
      phase,
      mode: phase === 'idle' ? 'keypad' : 'call',
      dialing: phase !== 'idle',
      elapsedSeconds: 0,
      activeCall,
      canControlAudio: phase === 'in-progress',
      expandDialer: () => undefined,
      collapseDialer: () => undefined,
      toggleView: () => undefined,
      startCall: () => undefined,
      adoptCall: () => undefined,
      connectCall: () => setPhase('in-progress'),
      endCall: () => setPhase('idle'),
      cancelCall: () => undefined,
      acceptIncomingCall: () => setPhase('in-progress'),
      rejectIncomingCall: () => setPhase('idle'),
      reset: () => setPhase('idle'),
      placeDeviceCall: async () => undefined,
      muteCall: () => undefined,
      sendDigits: () => undefined,
    }
  }, [phase])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <main className="min-h-dvh bg-background p-6">
          <h1 className="text-base font-semibold">Incoming call fixture</h1>
          <DialerContext.Provider value={value}>
            <DialerDock />
          </DialerContext.Provider>
        </main>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
