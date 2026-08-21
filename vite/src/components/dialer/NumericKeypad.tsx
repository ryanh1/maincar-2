import { useCallback, useState, type KeyboardEvent } from 'react'
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
import { useAuth } from '@/providers/useAuth'
import { useCreateCall } from '@/hooks/dialer'
import { useGetNumbers } from '@/hooks/phoneNumbers'
import { clearGreenRoomCheckInStore, useGreenRoomDecision } from '@/hooks/devices'
import { useDialer } from '@/components/dialer/dialerContext'

/** The phone layout, row by row: 1-9, then * 0 #. Twelve keys, no more. */
const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const

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
 *    (MAI-193). The keys are a convenience over typing into the field.
 *  - Call live: each key sends a real DTMF tone through `useDialer().sendDigits`,
 *    which forwards to the live browser Voice SDK Call's `sendDigits()`
 *    (MAI-195) — the callee's phone system hears it — AND appends to the field,
 *    so the press is visible too.
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
 * the dialog without dialing.
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
  const [value, setValue] = useState('')
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

  // A key landed — from a grid button or the keyboard. Always show it; send it as
  // a tone only when a call is live.
  const press = useCallback(
    (key: string) => {
      setValue((current) => current + key)
      if (dialing) sendDigits(key)
    },
    [dialing, sendDigits],
  )

  const removeLast = useCallback(() => setValue((current) => current.slice(0, -1)), [])

  const placeCall = useCallback(
    (toE164: string) => {
      if (!org) return
      createCall.mutate(
        { orgId: org.id, toE164, recordingConsent },
        {
          onError: (err) =>
            toast.error(err instanceof ApiError ? err.message : 'Could not place the call. Try again.'),
        },
      )
    },
    [org, createCall, recordingConsent],
  )

  // Place the call, or gate it behind the greenroom first. Guarded so a blank
  // number or an in-flight call is a no-op rather than a bad request, and so a
  // member with no active org gets told what is missing instead of a silent
  // nothing. `shouldShowGreenRoom` is checked LAST, after every other reason to
  // bail, so the greenroom never opens for a call that was never going out anyway.
  const dial = useCallback(() => {
    if (dialing || createCall.isPending) return
    const toE164 = value.trim()
    if (!toE164) return
    if (!org) {
      toast.error('Select an organization to call from.')
      return
    }
    if (shouldShowGreenRoom) {
      setGatingCall(true)
      setGreenRoomOpen(true)
      return
    }
    placeCall(toE164)
  }, [dialing, createCall.isPending, value, org, shouldShowGreenRoom, placeCall])

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
  // place, places it. An on-demand check has nothing waiting to place.
  const handleGreenRoomConfirm = useCallback(
    (_selection: DeviceSelection) => {
      setGreenRoomOpen(false)
      if (gatingCall) placeCall(value.trim())
      setGatingCall(false)
    },
    [gatingCall, placeCall, value],
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

  // The Call button is live only when a call can actually go out: a number is
  // entered, no call is already up or in flight, and the org has a caller ID to
  // dial from. Without an active number the button is not disabled — it is not
  // shown at all, and the buy prompt takes its place (never a live-looking control
  // that does nothing).
  const callDisabled = !value.trim() || dialing || createCall.isPending || !activeNumber

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
