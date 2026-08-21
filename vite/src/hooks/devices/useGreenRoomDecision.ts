import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { greenRoomCheckPassed } from '@/lib/greenRoomSession'

import {
  getGreenRoomCheckSnapshot,
  recordGreenRoomCheckInStore,
  subscribeToGreenRoomCheck,
} from './greenRoomCheckStore'

import type {
  GreenRoomCheck,
  GreenRoomCheckResult,
  GreenRoomReason,
  MicPermission,
  UseGreenRoomDecisionResult,
} from './types'

/**
 * Read microphone permission without ever throwing.
 *
 * `navigator.permissions` is missing in older browsers, and Firefox ships the
 * API but rejects the `microphone` descriptor, so both the absence and the
 * rejection have to land on 'unknown' rather than escape.
 */
async function queryMicPermission(): Promise<PermissionStatus | null> {
  try {
    const permissions = navigator.permissions
    if (typeof permissions?.query !== 'function') return null
    return await permissions.query({ name: 'microphone' as PermissionName })
  } catch {
    return null
  }
}

function toMicPermission(state: PermissionState | undefined): MicPermission {
  return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown'
}

/**
 * The decision rules, in priority order. Each returns the reason it fired.
 *
 * Everything here is derived, not stored: the record says what was true when
 * the check ran, and `permission` says what is true now.
 */
function decide(permission: MicPermission, check: GreenRoomCheck | null): GreenRoomReason {
  // 1. The microphone is denied. Always show, and say so — on a retry, and on
  //    the very first dial of the session, which is the likeliest moment for a
  //    mic blocked in browser settings. A live denial is a fact about right now
  //    and a missing record is only a fact about history, so this rule is tested
  //    FIRST: 'initial' shows the greenroom too, but it leaves the primary
  //    button live, and a rep who dials past a blocked mic joins a call nobody
  //    can hear.
  if (permission === 'denied') return 'mic-denied'

  // 2. Nothing recorded this session — the rep has not been through the
  //    greenroom yet, so run it. A check that found no usable microphone is not
  //    a pass and reads the same as no record: start over.
  if (!check || !greenRoomCheckPassed(check)) return 'initial'

  // 3. Permission is not what it was when the check passed. The rep changed a
  //    browser setting, so the recorded pass no longer describes reality.
  //    'unknown' never equals a recorded state, so it lands here and shows.
  if (permission !== check.permission) return 'permission-changed'

  // 4. A check passed and nothing has changed. Stay out of the way.
  return 'retry'
}

/**
 * Whether the greenroom needs to open before this call, and why.
 *
 * The greenroom is worth one interruption per session, not one per call, so the
 * hook skips it on a retry — unless something actually changed. It reads
 * permission from the Permissions API where that exists and falls back to
 * 'unknown' (which shows) everywhere else.
 */
export function useGreenRoomDecision(): UseGreenRoomDecisionResult {
  // Starts 'unknown', which shows the greenroom, and settles once the browser
  // answers. Failing toward showing means a slow answer never skips a check.
  const [permission, setPermission] = useState<MicPermission>('unknown')
  // Shared, not per-instance. Two instances of this hook are read on the same
  // screen — the dialer's and `GreenRoom`'s — and they must agree, or the rep
  // presses Call and nothing happens. See `greenRoomCheckStore`.
  const check = useSyncExternalStore(subscribeToGreenRoomCheck, getGreenRoomCheckSnapshot)

  useEffect(() => {
    let cancelled = false
    let status: PermissionStatus | null = null
    const onChange = () => {
      if (!cancelled) setPermission(toMicPermission(status?.state))
    }

    void queryMicPermission().then((result) => {
      if (cancelled) {
        // Resolved after unmount. Still detach, or the listener outlives the hook.
        result?.removeEventListener?.('change', onChange)
        return
      }
      status = result
      setPermission(toMicPermission(result?.state))
      // The rep can flip the site permission mid-session from the address bar,
      // so track it rather than reading once.
      result?.addEventListener?.('change', onChange)
    })

    return () => {
      cancelled = true
      status?.removeEventListener?.('change', onChange)
    }
  }, [])

  const recordSession = useCallback(
    (result: GreenRoomCheckResult) => {
      // Through the store, so every instance of this hook sees it, not just this
      // one. A failed write leaves no record, so the next decision is 'initial'
      // and shows — for all of them.
      recordGreenRoomCheckInStore({
        ...result,
        permission: result.permission ?? permission,
      })
    },
    [permission]
  )

  const reason = decide(permission, check)

  return { reason, shouldShow: reason !== 'retry', permission, recordSession }
}
