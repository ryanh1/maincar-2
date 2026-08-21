import { useCallback, useEffect, useState } from 'react'

import {
  greenRoomCheckPassed,
  readGreenRoomCheck,
  recordGreenRoomCheck,
} from '@/lib/greenRoomSession'

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
  // 1. Nothing recorded this session — the rep has not been through the
  //    greenroom yet, so run it. A check that found no usable microphone is not
  //    a pass and reads the same as no record: start over.
  if (!check || !greenRoomCheckPassed(check)) return 'initial'

  // 2. The microphone is denied. Always show, even on a retry. A denied mic is
  //    exactly the thing the greenroom exists to surface, and a rep who dials
  //    past it joins a call nobody can hear.
  if (permission === 'denied') return 'mic-denied'

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
  const [check, setCheck] = useState<GreenRoomCheck | null>(() => readGreenRoomCheck())

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
      const stored = recordGreenRoomCheck({
        ...result,
        permission: result.permission ?? permission,
      })
      // Keep the in-memory decision honest even when the write failed: a failed
      // write leaves no record, so the next decision is 'initial' and shows.
      setCheck(stored)
    },
    [permission]
  )

  const reason = decide(permission, check)

  return { reason, shouldShow: reason !== 'retry', permission, recordSession }
}
