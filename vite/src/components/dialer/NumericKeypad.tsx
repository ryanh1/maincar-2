import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Headphones, Phone } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BuyNumberBanner } from '@/components/BuyNumberBanner'
import { GreenRoom } from '@/components/GreenRoom'
import type { DeviceSelection } from '@/components/DeviceCheck'
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

export interface NumericKeypadProps {
  className?: string
  /** A known number supplied by the action that opened the dialer. */
  initialEntry?: string
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
 */
export function NumericKeypad({ className, initialEntry = '' }: NumericKeypadProps) {
  // The entry as digits plus an optional leading `+` — never the formatted text.
  // Formatting is derived on every render, so one keystroke is always one
  // character here and Backspace never has to step over a bracket or a dash.
  const [entry, setEntry] = useState(() => sanitizeEntry(initialEntry))
  const { org } = useAuth()
  const { dialing, sendDigits } = useDialer()
  const createCall = useCreateCall()
  const { shouldShow: shouldShowGreenRoom } = useGreenRoomDecision()

  const [greenRoomOpen, setGreenRoomOpen] = useState(false)
  const [gatingCall, setGatingCall] = useState(false)
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState<string | undefined>()
  const numberInputRef = useRef<HTMLInputElement>(null)
  const callButtonRef = useRef<HTMLButtonElement>(null)
  const deviceCheckButtonRef = useRef<HTMLButtonElement>(null)
  const greenRoomReturnTargetRef = useRef<'call' | 'devices' | null>(null)
  const initialFocusPendingRef = useRef(true)

  // The org's numbers, so the rep sees every assigned active line and can choose
  // one for this call only. The primary is the default, but a rep with no primary
  // can still call after explicitly choosing an active number.
  const { data: numbers } = useGetNumbers(org?.id)
  const dialableNumbers = useMemo(
    () => numbers?.numbers.filter((number) => number.status === 'active') ?? [],
    [numbers],
  )
  const primaryNumber = dialableNumbers.find((number) => number.isActiveForOutbound)
  const selectedNumber = selectedPhoneNumberId
    ? dialableNumbers.find((number) => number.id === selectedPhoneNumberId)
    : primaryNumber
  const hasNoDialableNumber = !!numbers && dialableNumbers.length === 0

  // The line the call goes out on is also the country bare digits are read in: a
  // rep on a US number who types ten digits means a US number. With no active
  // number there is no country, and bare digits are refused rather than guessed.
  const defaultCountry = useMemo(() => defaultCountryOf(selectedNumber?.e164), [selectedNumber?.e164])
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
        {
          orgId: org.id,
          toE164,
          ...(selectedPhoneNumberId ? { phoneNumberId: selectedPhoneNumberId } : {}),
        },
        {
          onSuccess: () => setSelectedPhoneNumberId(undefined),
          onError: (err) => {
            // A 409 with a live Call is a recovered session, not an actionable
            // failure. useCreateCall has expanded the dialer with that call.
            if (isAdoptableInFlightCallError(err)) return
            toast.error(err instanceof ApiError ? err.message : 'Could not place the call. Try again.')
          },
        },
      )
    },
    [org, createCall, selectedPhoneNumberId],
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
      greenRoomReturnTargetRef.current = 'call'
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
    greenRoomReturnTargetRef.current = 'devices'
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
  // caller ID to dial from. Without a dialable number the button is not shown at
  // all, and the buy prompt takes its place (never a live-looking control that
  // does nothing). A caller with no primary needs an explicit selection.
  const callDisabled =
    parsed.status !== 'valid' || dialing || createCall.isPending || !selectedNumber

  const messageId = 'keypad-number-error'
  const keys = dialing ? IN_CALL_KEYS : ENTRY_KEYS

  // A valid number supplied before opening goes straight to its action; an empty
  // dialer goes to the field. The prefill can wait for the caller ID query, but
  // it never retargets after a rep edits the field.
  useLayoutEffect(() => {
    if (!initialFocusPendingRef.current) return
    const initial = readEntry(sanitizeEntry(initialEntry), defaultCountry)
    if (initial.status === 'valid' && !callButtonRef.current?.disabled) {
      initialFocusPendingRef.current = false
      callButtonRef.current?.focus()
      return
    }
    if (initial.status !== 'valid') initialFocusPendingRef.current = false
    numberInputRef.current?.focus()
  }, [defaultCountry, initialEntry])

  const handleGreenRoomCloseAutoFocus = useCallback((event: Event) => {
    const returnTarget = greenRoomReturnTargetRef.current
    greenRoomReturnTargetRef.current = null
    if (!returnTarget) return

    const target = returnTarget === 'call' ? callButtonRef.current : deviceCheckButtonRef.current
    if (!target?.isConnected || target.disabled) return
    event.preventDefault()
    target.focus()
  }, [])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-2">
        {dialableNumbers.length > 0 ? (
          <div className="flex flex-1 items-center gap-2">
            <span className="text-xs text-muted-foreground">Call from</span>
            <Select
              value={selectedNumber?.id}
              onValueChange={setSelectedPhoneNumberId}
            >
              <SelectTrigger aria-label="Call from" size="sm" className="min-w-0 flex-1 tabular-nums">
                <SelectValue placeholder="Select a number" />
              </SelectTrigger>
              <SelectContent>
                {dialableNumbers.map((number) => (
                  <SelectItem key={number.id} value={number.id} className="tabular-nums">
                    {number.e164}{number.isActiveForOutbound ? ' (Primary)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : <div className="flex-1" />}
        <IconButton
          ref={deviceCheckButtonRef}
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
          ref={numberInputRef}
          aria-label="Phone number"
          inputMode="tel"
          placeholder="Enter a number"
          value={display}
          aria-invalid={invalidMessage ? true : undefined}
          aria-describedby={invalidMessage ? messageId : undefined}
          onChange={(e) => {
            initialFocusPendingRef.current = false
            setEntry(dialing ? e.target.value : sanitizeEntry(e.target.value))
          }}
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
      {hasNoDialableNumber ? (
        <BuyNumberBanner />
      ) : (
        <>
          <Button
            ref={callButtonRef}
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
        onCloseAutoFocus={handleGreenRoomCloseAutoFocus}
      />
    </div>
  )
}
