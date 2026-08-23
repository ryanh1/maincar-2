import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { InCallWorkspace } from '@/components/dialer/InCallWorkspace'
import { DialerContext, type DialerContextValue } from '@/components/dialer/dialerContext'
import { Button } from '@/components/ui/button'
import type { CallDetail } from '@/lib/callTypes'
import { queryKeys } from '@/lib/queryKeys'
import { TooltipProvider } from '@/components/ui/tooltip'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })

function fixtureCall(id: string, toE164: string, known: boolean): CallDetail {
  return {
    id,
    direction: 'outbound',
    status: 'in-progress',
    fromE164: '+14155550100',
    toE164,
    recordingPlanned: false,
    recordingReason: 'recording-disabled',
    twilioCallSid: 'CA-fixture',
    durationS: 75,
    startedAt: '2026-08-22T19:00:00.000Z',
    endedAt: null,
    createdAt: '2026-08-22T19:00:00.000Z',
    recordingEnabled: false,
    recordingUrl: null,
    transcriptStatus: 'skipped-not-recorded',
    transcript: null,
    destinationState: null,
    noteText: null,
    review: {
      crm: {
        person: known ? { id: 'person-fixture', firstName: 'Jordan', lastName: 'Lee', preferredFirstName: null } : null,
        company: known ? { id: 'company-fixture', name: 'Acme' } : null,
        deal: null,
      },
      recording: { state: 'unavailable', source: null },
      transcript: { state: 'unavailable', pass: null },
      speakers: [],
    },
  }
}

const knownCall = fixtureCall('call-known', '+12025550123', true)
const unknownCall = fixtureCall('call-unknown', '+12025550999', false)
queryClient.setQueryData(queryKeys.calls.detail('org-fixture', knownCall.id), { call: knownCall })
queryClient.setQueryData(queryKeys.calls.detail('org-fixture', unknownCall.id), { call: unknownCall })

const dialer: DialerContextValue = {
  view: 'expanded', phase: 'ringing', mode: 'call', dialing: true, elapsedSeconds: 75,
  activeCall: {
    orgId: 'org-fixture',
    callId: knownCall.id,
    toE164: knownCall.toE164,
    personId: 'person-fixture',
    companyId: 'company-fixture',
    recording: false,
  },
  canControlAudio: false,
  expandDialer: () => undefined, collapseDialer: () => undefined, toggleView: () => undefined,
  startCall: () => undefined, adoptCall: () => undefined, connectCall: () => undefined, endCall: () => undefined,
  cancelCall: () => undefined, acceptIncomingCall: () => undefined, rejectIncomingCall: () => undefined,
  reset: () => undefined, placeDeviceCall: async () => undefined,
  muteCall: () => undefined, sendDigits: () => undefined,
}

/** Development-only fixture for the in-call workspace browser journey. */
export function InCallWorkspaceFixture() {
  const [call, setCall] = useState(knownCall)
  const [phase, setPhase] = useState<DialerContextValue['phase']>('ringing')

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <main className="flex min-h-dvh items-center justify-center bg-background p-6">
          <section aria-labelledby="in-call-workspace-fixture-title" className="w-full max-w-md border border-border bg-card p-4">
            <h1 id="in-call-workspace-fixture-title" className="text-base font-semibold">In-call workspace fixture</h1>
            <div className="mt-4 flex flex-col gap-3">
              {phase === 'ringing' ? <Button type="button" variant="secondary" size="sm" onClick={() => setPhase('in-progress')}>Connect call</Button> : null}
              <Button type="button" variant="secondary" size="sm" onClick={() => setCall((current) => current.id === knownCall.id ? unknownCall : knownCall)}>
                {call.id === knownCall.id ? 'Show unknown caller' : 'Show known caller'}
              </Button>
              <DialerContext.Provider value={{ ...dialer, phase }}>
                <InCallWorkspace
                  key={call.id}
                  orgId="org-fixture"
                  callId={call.id}
                  toE164={call.toE164}
                  companyId={call.review?.crm.company?.id ?? null}
                  recording={false}
                />
              </DialerContext.Provider>
            </div>
          </section>
        </main>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
