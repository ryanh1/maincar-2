import { useCallback, useRef, useState } from 'react'
import { DeviceCheck, type DeviceSelection } from '@/components/DeviceCheck'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGetDevices, useGreenRoomDecision } from '@/hooks/devices'

export interface GreenRoomProps {
  /**
   * The rep's intent: true once they have asked to start something.
   *
   * This is NOT "the check is needed" — see the component docstring. The parent
   * owns it, and setting it is the only way the dialog ever opens.
   */
  open: boolean
  /**
   * Radix's open state, forwarded. Fires with `false` on Escape, on the overlay,
   * on the close button, and on Cancel. The parent must clear its intent here,
   * or the dialog reopens on the next render.
   */
  onOpenChange: (open: boolean) => void
  /**
   * The rep pressed the primary button. The check has already been recorded for
   * the session by the time this runs, so the next dial can skip the greenroom.
   *
   * Receives the microphone and speaker the check settled on, so the caller does
   * not re-read device storage. Either id is null when nothing usable was found.
   */
  onConfirm: (selection: DeviceSelection) => void
  /**
   * The primary button's label. A verb, because the verb survives the flow.
   *
   * Defaults to "Start call". Phase 2 reuses this dialog before a voicemail
   * drop, where the button reads "Drop voicemail".
   */
  confirmLabel?: string
}

/**
 * The pre-call greenroom: check the microphone and the speaker, then dial.
 *
 * ## The prop contract (MAI-24 and Phase 2 both build on this)
 *
 * Two facts drive this component and they are deliberately kept apart:
 *
 * 1. **The rep wants to start a call.** That is `open`, and only the parent
 *    knows it. This component never decides it.
 * 2. **The check needs showing.** That is `useGreenRoomDecision()`, read here.
 *    A rep who already passed a check this session should not see the greenroom
 *    sixty times in a dialling session.
 *
 * The dialog appears only when **both** hold. That means:
 *
 * - **`GreenRoom` never auto-confirms.** With `open` set on a `'retry'`
 *   decision it renders nothing and calls nothing. The caller reads
 *   `useGreenRoomDecision().shouldShow` itself and starts the call directly
 *   when it is false; setting `open` is for the case where it is true.
 * - Once the dialog is up it stays up until the parent closes it, even if the
 *   decision flips to `'retry'` underneath — a permission that settles halfway
 *   through must not yank the dialog out from under the rep.
 */
export function GreenRoom({ open, onOpenChange, onConfirm, confirmLabel }: GreenRoomProps) {
  const { reason, shouldShow, permission, recordSession } = useGreenRoomDecision()
  const { error, isLoading } = useGetDevices()

  // Not cleared on close. `DeviceCheck` unmounts with the dialog and reports a
  // fresh selection from its mount effect, which lands before the rep can press
  // anything, so a value left over from the last open is never the one recorded.
  const [selection, setSelection] = useState<DeviceSelection | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // `useGreenRoomDecision` starts at permission 'unknown' and settles a tick
  // later. With a recorded pass in session storage that first tick decides
  // 'permission-changed', so a dialog wired straight to `shouldShow` would open
  // and shut again — the flash MAI-23 warned about.
  //
  // This exact pair is the pending window and nothing else. An 'unknown'
  // permission is only ever *evidence of a change* once something recorded a
  // known one, and a browser with no Permissions API records 'unknown' too, so
  // an equal pair decides 'retry' rather than 'permission-changed'. Holding the
  // dialog closed until the browser answers therefore costs nothing.
  const awaitingPermission = reason === 'permission-changed' && permission === 'unknown'
  const needsCheck = shouldShow && !awaitingPermission

  // Latched, not derived: opening follows `needsCheck`, closing follows the
  // parent. See the docstring — a decision that flips mid-check must not close
  // a dialog the rep is using. A rep who fixes a blocked microphone in browser
  // settings turns 'mic-denied' into 'retry' while standing in this dialog, and
  // having it vanish before they dial is the bug this prevents.
  //
  // Adjusted during render rather than in an effect, which is React's own
  // pattern for state that follows props: an effect here would open the dialog
  // one commit late, and the rep would see a frame of empty overlay.
  const [checkOpen, setCheckOpen] = useState(false)
  const shouldBeOpen = open && (checkOpen || needsCheck)
  if (checkOpen !== shouldBeOpen) setCheckOpen(shouldBeOpen)

  const handleSelectionChange = useCallback((next: DeviceSelection) => setSelection(next), [])

  // The rep's microphone is blocked at the browser level, and no button in
  // Maincar can unblock it. So the primary button is DISABLED rather than left
  // live: a call placed on a blocked mic connects, bills, and reaches a
  // prospect who hears nothing, which is worse for the rep than not dialling.
  // The line under the title names the one thing that does fix it, and the
  // decision hook watches the permission, so allowing it re-enables the button
  // without a reload.
  const micDenied = reason === 'mic-denied'
  // A confirmation is safe only after the check has settled on a working
  // microphone and reported no device-readiness error. A failed check stays in
  // the dialog, where the rep can reconnect hardware or cancel; it can never
  // leak through to the caller and place a silent call.
  const readinessFailed = isLoading || error !== null || selection?.microphoneId == null
  // Radix warns when a dialog has no description, and there is nothing honest to
  // put under "Check your devices" — the screen is its own explanation. Passing
  // the prop explicitly is Radix's own way to say "there is none". The actionable
  // permission link lives in DeviceCheck so Settings and the GreenRoom match.
  const noDescription = { 'aria-describedby': undefined }

  function handleConfirm() {
    // Record BEFORE handing control over. `onConfirm` starts a call and may
    // unmount this dialog on the spot; a check that never got recorded means
    // the next dial decides 'initial' and shows the greenroom again, which is
    // the whole thing MAI-23 exists to prevent.
    recordSession({
      // The one signal that matters: the id the check actually settled on.
      // `resolveDeviceId` returns null exactly when no usable microphone
      // exists, so a null here is a real "no mic", and a missing selection
      // records `false` — not a pass, so the next dial asks again.
      hasMicrophone: selection?.microphoneId != null,
      // `useGetDevices` already phrases every failure as the rep's next action,
      // so the recorded problem is that sentence verbatim.
      problem: error,
      // `permission` is deliberately NOT passed. Letting it default keeps the
      // recorded value in the same vocabulary the hook will compare it against
      // next time; writing a more "authoritative" value here would read as a
      // permission change forever on any browser without the Permissions API.
    })
    onConfirm(selection ?? { microphoneId: null, speakerId: null })
  }

  return (
    <Dialog open={open && checkOpen} onOpenChange={onOpenChange}>
      <DialogContent
        // The shared primitive ships `rounded-lg`/`shadow-lg`; the design system
        // allows one radius and one shadow, so both are pinned back here.
        className="rounded-md shadow-md duration-200 ease-out motion-reduce:animate-none sm:max-w-md"
        onOpenAutoFocus={(event) => {
          // Radix fires this before its focus scope moves anything, so this is
          // still whatever the rep pressed to get here. A modal Radix dialog
          // restores focus to its own <DialogTrigger>, and this one has none —
          // it opens from the parent's intent — so without remembering the
          // opener, closing drops focus on <body> and a keyboard rep loses
          // their place.
          const active = document.activeElement
          openerRef.current = active instanceof HTMLElement ? active : null

          // Radix's own hook for the auto-focus, rather than a `.focus()` in an
          // effect racing its focus scope. When the primary button is disabled
          // there is nothing to focus, so the default (first tabbable) stands.
          const target = confirmRef.current
          if (!target || target.disabled) return
          event.preventDefault()
          target.focus()
        }}
        onCloseAutoFocus={(event) => {
          // Radix's own restore targets a trigger this dialog does not have, so
          // it is replaced rather than composed with. An opener that left the
          // page while the dialog was up falls through to Radix's default.
          const opener = openerRef.current
          openerRef.current = null
          if (!opener?.isConnected) return
          event.preventDefault()
          opener.focus()
        }}
        {...noDescription}
      >
        <DialogHeader>
          {/* `text-lg` is forbidden outside auth, so the primitive's size is
              pinned to the page-title step. */}
          <DialogTitle className="text-base font-semibold">Check your devices</DialogTitle>
        </DialogHeader>

        <DeviceCheck className="max-w-none" onSelectionChange={handleSelectionChange} />

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            disabled={micDenied || readinessFailed}
            onClick={handleConfirm}
          >
            {confirmLabel ?? 'Start call'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
