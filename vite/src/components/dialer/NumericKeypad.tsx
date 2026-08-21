import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import { Phone } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BuyNumberBanner } from '@/components/BuyNumberBanner'
import type { RecordingConsent } from '@/lib/callTypes'
import {
  ENTRY_KEYS,
  IN_CALL_KEYS,
  defaultCountryOf,
  entryMessage,
  formatEntry,
  readEntry,
  sanitizeEntry,
} from '@/lib/dialPad'
import { useAuth } from '@/providers/useAuth'
import { useCreateCall } from '@/hooks/dialer'
import { useGetNumbers } from '@/hooks/phoneNumbers'
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
 *    `useCreateCall`. The keys are a convenience over typing into the field. The
 *    entry is normalised to E.164 before it is sent — see `@/lib/dialPad`.
 *  - Call live: each key sends a DTMF tone through the `sendDigit` seam AND
 *    appends to the field, so the press is visible even before real tones ship.
 *
 * The keys differ by mode for the same reason. `*` and `#` are real tones on a
 * connected call, but inside a number they make the entry unparseable, so entry
 * mode offers `+` instead (`ENTRY_KEYS` vs `IN_CALL_KEYS`).
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
  // The entry as digits plus an optional leading `+` — never the formatted text.
  // Formatting is derived on every render, so one keystroke is always one
  // character here and Backspace never has to step over a bracket or a dash.
  const [entry, setEntry] = useState('')
  const { org } = useAuth()
  const { dialing } = useDialer()
  const createCall = useCreateCall()

  // The org's numbers, so the rep sees which line the call goes out on and cannot
  // reach a Call button when there is no line to call from. The active number's
  // e164 is the caller ID; `activeCount === 0` means the rep has none yet.
  const { data: numbers } = useGetNumbers(org?.id)
  const activeNumber = numbers?.numbers.find((n) => n.isActiveForOutbound)
  const hasNoActiveNumber = !!numbers && numbers.activeCount === 0

  // The line the call goes out on is also the country bare digits are read in: a
  // rep on a US number who types ten digits means a US number. With no active
  // number there is no country, and bare digits are refused rather than guessed.
  const defaultCountry = useMemo(() => defaultCountryOf(activeNumber?.e164), [activeNumber?.e164])
  const parsed = useMemo(() => readEntry(entry, defaultCountry), [entry, defaultCountry])
  const display = dialing ? entry : formatEntry(entry, defaultCountry)
  const invalidMessage = entryMessage(parsed)

  // A key landed — from a grid button or the keyboard. Always show it; send it as
  // a tone only when a call is live. During a call the press is shown verbatim,
  // because `*` and `#` are tones rather than digits of a number being composed.
  const press = useCallback(
    (key: string) => {
      if (dialing) {
        setEntry((current) => current + key)
        sendDigit(key)
        return
      }
      setEntry((current) => sanitizeEntry(current + key))
    },
    [dialing, sendDigit],
  )

  const removeLast = useCallback(() => setEntry((current) => current.slice(0, -1)), [])

  // Place the call. Guarded so an unusable number or an in-flight call is a no-op
  // rather than a bad request, and so a member with no active org gets told what
  // is missing instead of a silent nothing. The org check comes first because a
  // missing org is the bigger blocker — the number does not matter without one.
  const dial = useCallback(() => {
    if (dialing || createCall.isPending) return
    if (parsed.status === 'empty') return
    if (!org) {
      toast.error('Select an organization to call from.')
      return
    }
    // Only E.164 goes out. The message under the field already says why anything
    // else is refused, so this is silent rather than a second telling.
    if (parsed.status !== 'valid') return
    createCall.mutate(
      { orgId: org.id, toE164: parsed.e164, recordingConsent },
      {
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : 'Could not place the call. Try again.'),
      },
    )
  }, [dialing, createCall, parsed, org, recordingConsent])

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

  // The Call button is live only when a call can actually go out: the entry is a
  // number we can dial, no call is already up or in flight, and the org has a
  // caller ID to dial from. Without an active number the button is not disabled —
  // it is not shown at all, and the buy prompt takes its place (never a
  // live-looking control that does nothing).
  const callDisabled =
    parsed.status !== 'valid' || dialing || createCall.isPending || !activeNumber

  const messageId = 'keypad-number-error'
  const keys = dialing ? IN_CALL_KEYS : ENTRY_KEYS

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {activeNumber ? (
        <p className="text-center text-xs tabular-nums text-muted-foreground">
          From {activeNumber.e164}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <Input
          aria-label="Phone number"
          inputMode="tel"
          placeholder="Enter a number"
          value={display}
          aria-invalid={invalidMessage ? true : undefined}
          aria-describedby={invalidMessage ? messageId : undefined}
          onChange={(e) => setEntry(dialing ? e.target.value : sanitizeEntry(e.target.value))}
          onKeyDown={handleKeyDown}
          className="text-center tabular-nums"
        />
        {invalidMessage ? (
          <p id={messageId} role="alert" className="text-center text-xs text-destructive">
            {invalidMessage}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
        {keys.map((key) => (
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
      {hasNoActiveNumber ? (
        <BuyNumberBanner />
      ) : (
        <Button
          type="button"
          variant="success"
          size="sm"
          className="w-full"
          disabled={callDisabled}
          onClick={dial}
        >
          <Phone size={16} aria-hidden="true" />
          Call
        </Button>
      )}
    </div>
  )
}
