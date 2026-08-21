import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { jsonFetch } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { CreateCallInput, CreateCallResponse } from '@/lib/callTypes'
import { useDialer } from '@/components/dialer/dialerContext'

/**
 * What placing a call sends. `orgId` travels in the variables rather than as a
 * hook argument, the way every other mutation in the app does it, so the hook
 * never has to hold a possibly-null org between render and click.
 */
export interface CreateCallVariables extends CreateCallInput {
  orgId: string
}

/**
 * Place an outbound call: POST the number, move the shared dialer into its
 * ringing state, then connect the browser Voice SDK Device — the POST only
 * queues a Call row; the Device is what actually reaches Twilio (MAI-189).
 *
 * The context transition happens on SUCCESS, not on submit: a call that the
 * server refused — no active number (400), a duplicate already in flight (409),
 * a bad number (400) — must never leave the dialer showing "ringing" for a call
 * that never started. The button's own pending state covers the round trip.
 *
 * The 409 carries the call already in flight, and adopting it into the dialer is
 * a later concern (the UI that shows an existing call owns that); here the
 * rejection simply surfaces through `ApiError` with the server's own sentence, so
 * the caller can toast exactly what the server said.
 *
 * The history list is invalidated on success so a placed call shows up in the
 * history table without a manual refetch.
 */
export function useCreateCall() {
  const queryClient = useQueryClient()
  const { startCall, placeDeviceCall, reset } = useDialer()

  return useMutation({
    mutationFn: ({ orgId, ...body }: CreateCallVariables) =>
      jsonFetch<CreateCallResponse>(`/api/orgs/${orgId}/calls`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data, variables) => {
      // Hand the queued call's identity to the dialer so the in-call controls can
      // hang it up. Recording is on only when the caller granted consent — the
      // POST echo carries the consent, not a separate recording flag.
      startCall({
        orgId: variables.orgId,
        callId: data.call.id,
        recording: data.call.recordingConsent === 'granted',
      })
      // Connect the Device with the row's id, so the voice webhook
      // (routes/twilioVoice.ts) can find it. A failure here — the Device is not
      // ready, the mic is blocked — means the call never reaches Twilio at all:
      // reset the dialer and say why, rather than leaving it stuck on "ringing"
      // for a call nobody is dialing. The queued row itself is left for the
      // stale-call backstop (MAI-202) to settle; it carries no cost until Twilio
      // actually answers, and this hook has no clean way to cancel it mid-flight.
      void placeDeviceCall({ callId: data.call.id }).catch((err: unknown) => {
        toast.error(
          err instanceof Error
            ? err.message
            : 'Could not connect the call. Check your microphone and try again.',
        )
        reset()
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.calls.list(variables.orgId) })
    },
  })
}
