import { useCallback, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RecordingConsent } from '@/lib/callTypes'
import { useAuth } from '@/providers/useAuth'
import { useCreateCall } from '@/hooks/dialer'
import { useDialer } from '@/components/dialer/dialerContext'

/**
 * The DTMF seam.
 *
 * Pressing a key while a call is live is meant to play that tone INTO the call —
 * "press 1 for sales". Real DTMF over Twilio needs the browser Voice SDK
 * (`@twilio/voice-sdk` → `Twilio.Device.activeConnection().sendDigits()`), and
 * that device is NOT in the app yet (nothing imports the SDK). So the default is
 * an honest no-op, not a fake "tone sent".
 *
 * This is deliberately not a dead control: the key press still appends to the
 * visible number above, so the rep sees the press land. Once a Device is wired,
 * pass a real `sendDigit` that forwards to `sendDigits(digit)` and the tones go
 * out for free — the keypad already calls this on every in-call press.
 *
 * TODO(MAI): replace the default with the Twilio.js Device once the browser Voice
 * SDK is added under `vite/src/dependencies/`.
 */
export type SendDigit = (digit: string) => void

// A stable identity so the default prop does not change between renders.
const noopSendDigit: SendDigit = () => {}

/** The phone layout, row by row: 1-9, then * 0 #. Twelve keys, no more. */
const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const

export interface NumericKeypadProps {
  /**
   * DTMF seam. Called with each key pressed while a call is live. Defaults to a
   * documented no-op because the browser Voice SDK is not wired yet — see
   * {@link SendDigit}.
   */
  sendDigit?: SendDigit
  /**
   * Consent to place the call with. This keypad captures no consent of its own,
   * so the safe default is `declined`: never record without an explicit yes.
   */
  recordingConsent?: RecordingConsent
  className?: string
}

/**
 * The dialer's numeric keypad: an editable number field above a twelve-key grid.
 *
 * Two jobs, chosen by whether a call is live (read from `useDialer().dialing`):
 *  - No call: the keys build up a number, and Enter places the call through
 *    `useCreateCall`. The keys are a convenience over typing into the field.
 *  - Call live: each key sends a DTMF tone through the `sendDigit` seam AND
 *    appends to the field, so the press is visible even before real tones ship.
 *
 * Enter dials only when idle; Backspace/Delete drops the last character. Both are
 * handled on the field, which is where a rep's focus sits while entering a
 * number.
 */
export function NumericKeypad({
  sendDigit = noopSendDigit,
  recordingConsent = 'declined',
  className,
}: NumericKeypadProps) {
  const [value, setValue] = useState('')
  const { org } = useAuth()
  const { dialing } = useDialer()
  const createCall = useCreateCall()

  // A key landed — from a grid button or the keyboard. Always show it; send it as
  // a tone only when a call is live.
  const press = useCallback(
    (key: string) => {
      setValue((current) => current + key)
      if (dialing) sendDigit(key)
    },
    [dialing, sendDigit],
  )

  const removeLast = useCallback(() => setValue((current) => current.slice(0, -1)), [])

  // Place the call. Guarded so a blank number or an in-flight call is a no-op
  // rather than a bad request, and so a member with no active org gets told what
  // is missing instead of a silent nothing.
  const dial = useCallback(() => {
    if (dialing || createCall.isPending) return
    const toE164 = value.trim()
    if (!toE164) return
    if (!org) {
      toast.error('Select an organization to call from.')
      return
    }
    createCall.mutate(
      { orgId: org.id, toE164, recordingConsent },
      {
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : 'Could not place the call. Try again.'),
      },
    )
  }, [dialing, createCall, value, org, recordingConsent])

  // The field owns the keyboard: Enter dials when idle, Backspace/Delete trims the
  // last character. Digits still type normally through `onChange`, so the field
  // stays editable; only these two behaviors are intercepted.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        dial()
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        removeLast()
      }
    },
    [dial, removeLast],
  )

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Input
        aria-label="Phone number"
        inputMode="tel"
        placeholder="Enter a number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="text-center tabular-nums"
      />
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
        {KEYPAD_KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            aria-label={key}
            onClick={() => press(key)}
            className="tabular-nums"
          >
            {key}
          </Button>
        ))}
      </div>
    </div>
  )
}
