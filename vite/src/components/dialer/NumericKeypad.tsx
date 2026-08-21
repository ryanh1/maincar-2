import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import { Headphones, Phone } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BuyNumberBanner } from '@/components/BuyNumberBanner'
import { GreenRoom } from '@/components/GreenRoom'
import type { DeviceSelection } from '@/components/DeviceCheck'
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
import { isAdoptableInFlightCallError, useCreateCall } from '@/hooks/dialer'
import { useGetNumbers } from '@/hooks/phoneNumbers'
import { clearGreenRoomCheckInStore, useGreenRoomDecision } from '@/hooks/devices'
import { useDialer } from '@/components/dialer/dialerContext'

/** Ties the consent checkbox to its label. */
const CONSENT_ID = 'dialer-recording-consent'

export interface NumericKeypadProps {
  className?: string
}

/**
 * The dialer's numeric keypad: an editable number field above a twelve-key grid.
 *
 * Two jobs, chosen by whether a call is live (read from `useDialer().dialing`):
 *  - No call: the keys build up a number, and Enter places the call through
 *    `useCreateCall` — gated behind the greenroom on the first call of a session
 *    (MAI-193). The entry is normalised to E.164 before it is sent — see
 *    `@/lib/dialPad` (MAI-194).
 *  - Call live: each key sends a real DTMF tone through `useDialer().sendDigits`,
 *    which forwards to the live browser Voice SDK Call's `sendDigits()`
 *    (MAI-195) — the callee's phone system hears it — AND appends to the field,
 *    so the press is visible too.
 *
 * The keys differ by mode for the same reason the field's validation does. `*`
 * and `#` are real tones on a connected call, but inside a number they make the
 * entry unparseable, so entry mode offers `+` instead (`ENTRY_KEYS` vs
 * `IN_CALL_KEYS`).
 *
 * Enter dials only when idle; Backspace/Delete drops the last character. Both are
 * handled on the field, which is where a rep's focus sits while entering a
 * number.
 *
 * ## The greenroom gate
 *
 * `useGreenRoomDecision().shouldShow` decides whether `dial()` opens `GreenRoom`
 * instead of calling straight through — the same pattern `GreenRoom`'s own
 * docstring documents and `GreenRoom.integration.test.tsx` proves end to end.
 * `gatingCall` tells `GreenRoom`'s `onConfirm` whether there is a call waiting on
 * the other side of it: set when the gate opens it, left false when the
 * headphones button opens it on demand, so confirming an on-demand check closes
 * the dialog without dialing. It is checked LAST in `dial()`, after every other
 * reason to bail (including an entry that does not parse), so the greenroom never
 * opens for a call that was never going out anyway.
 *
 * ## Recording consent (MAI-192)
 *
 * Captured here, per call, by the checkbox above the Call button. It is state,
 * not a prop: the spec allows recording only on an explicit opt-in for each
 * call, so there is no default to inherit and nothing to persist. It starts at
 * `declined` and returns there on every fresh keypad — the dock swaps this
 * component out for the in-call controls once a call is up, so a granted tick
 * can never outlive the call it was given for. The greenroom detour does not
 * reset it: the choice is made before `dial()` runs, whether or not the gate
 * opens.
 */
export function NumericKeypad({ className }: NumericKeypadProps) {
  // The entry as digits plus an optional leading `+` — never the formatted text.
  // Formatting is derived on every render, so one keystroke is always one
  // character here and Backspace never has to step over a bracket or a dash.
  const [entry, setEntry] = useState('')
  const [recordingConsent, setRecordingConsent] = useState<RecordingConsent>('declined')
  const { org } = useAuth()
  const { dialing, sendDigits } = useDialer()
  const createCall = useCreateCall()
  const { shouldShow: shouldShowGreenRoom } = useGreenRoomDecision()

  const [greenRoomOpen, setGreenRoomOpen] = useState(false)
  const [gatingCall, setGatingCall] = useState(false)

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
        sendDigits(key)
        return
      }
      setEntry((current) => sanitizeEntry(current + key))
    },
    [dialing, sendDigits],
  )

  const removeLast = useCallback(() => setEntry((current) => current.slice(0, -1)), [])

  const placeCall = useCallback(
    (toE164: string) => {
      if (!org) return
      createCall.mutate(
        { orgId: org.id, toE164, recordingConsent },
        {
          onError: (err) => {
            // A 409 with a live Call is a recovered session, not an actionable
            // failure. useCreateCall has expanded the dialer with that call.
            if (isAdoptableInFlightCallError(err)) return
            toast.error(err instanceof ApiError ? err.message : 'Could not place the call. Try again.')
          },
        },
      )
    },
    [org, createCall, recordingConsent],
  )

  // Place the call, or gate it behind the greenroom first. Guarded so an unusable
  // number or an in-flight call is a no-op rather than a bad request, and so a
  // member with no active org gets told what is missing instead of a silent
  // nothing. Only E.164 goes out — the message under the field already says why
  // anything else is refused, so this is silent rather than a second telling.
  const dial = useCallback(() => {
    if (dialing || createCall.isPending) return
    if (parsed.status === 'empty') return
    if (!org) {
      toast.error('Select an organization to call from.')
      return
    }
    if (parsed.status !== 'valid') return
    if (shouldShowGreenRoom) {
      setGatingCall(true)
      setGreenRoomOpen(true)
      return
    }
    placeCall(parsed.e164)
  }, [dialing, createCall.isPending, parsed, org, shouldShowGreenRoom, placeCall])

  // The headphones button: check devices on demand, independent of whether a call
  // is waiting. Clearing the recorded check first is what makes GreenRoom open at
  // all for a rep who already passed this session — its own decision hook would
  // otherwise read 'retry' and render nothing, by design (see its docstring).
  const openDeviceCheck = useCallback(() => {
    clearGreenRoomCheckInStore()
    setGatingCall(false)
    setGreenRoomOpen(true)
  }, [])

  const handleGreenRoomOpenChange = useCallback((open: boolean) => {
    setGreenRoomOpen(open)
    if (!open) setGatingCall(false)
  }, [])

  // Confirming records the check (GreenRoom does that itself, before this runs)
  // and, only when the greenroom was gating a call the rep already asked to
  // place, places it. An on-demand check has nothing waiting to place; a gated
  // call always has a valid `parsed.e164` because `dial()` checked before opening.
  const handleGreenRoomConfirm = useCallback(
    (_selection: DeviceSelection) => {
      setGreenRoomOpen(false)
      if (gatingCall && parsed.status === 'valid') placeCall(parsed.e164)
      setGatingCall(false)
    },
    [gatingCall, parsed, placeCall],
  )

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
      <div className="flex items-center gap-2">
        <p className="flex-1 text-center text-xs tabular-nums text-muted-foreground">
          {activeNumber ? `From ${activeNumber.e164}` : null}
        </p>
        <IconButton
          type="button"
          variant="outline"
          tooltip="Check your microphone and speaker"
          onClick={openDeviceCheck}
        >
          <Headphones size={16} aria-hidden="true" />
        </IconButton>
      </div>
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
        <>
          {/*
            Consent rides with the Call button, not with the keypad grid: both are
            hidden together when there is no line to call from, so a rep is never
            offered a recording choice for a call they cannot place. It locks while
            a call is in flight — the value the POST carried is already fixed, so a
            togglable box would be a control that does nothing.
          */}
          <Label htmlFor={CONSENT_ID} className="cursor-pointer">
            <Checkbox
              id={CONSENT_ID}
              checked={recordingConsent === 'granted'}
              onCheckedChange={(checked) =>
                setRecordingConsent(checked === true ? 'granted' : 'declined')
              }
              disabled={dialing || createCall.isPending}
            />
            Record this call
          </Label>
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
        </>
      )}
      <GreenRoom
        open={greenRoomOpen}
        onOpenChange={handleGreenRoomOpenChange}
        onConfirm={handleGreenRoomConfirm}
        confirmLabel={gatingCall ? undefined : 'Done'}
      />
    </div>
  )
}
