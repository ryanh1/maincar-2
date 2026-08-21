/**
 * Where a finished greenroom check is remembered, so a rep dialling sixty
 * numbers sees the device modal once rather than sixty times.
 *
 * **Session storage, not localStorage.** Device readiness is a property of this
 * browsing session: the headset that was plugged in last Tuesday says nothing
 * about the one plugged in now, and a stale "everything was fine" is worse than
 * asking again, because it lets the rep dial into a call with a dead mic.
 * Closing the tab should forget the check. `useGetDevices` does use
 * localStorage, but for the rep's *device choice* — a preference that should
 * outlive the session. A preference and a check result are different things and
 * are deliberately kept in different stores.
 *
 * Pure functions, no React. Every access is wrapped, because Safari in private
 * mode throws on write and a device check must never be the thing that breaks
 * the dialer. A storage failure degrades to "no record", which shows the
 * greenroom — the safe direction.
 */
import type { GreenRoomCheck, GreenRoomCheckResult, MicPermission } from '@/hooks/devices/types'

/** Namespaced so it cannot collide with another feature's session entry. */
export const GREEN_ROOM_SESSION_KEY = 'maincar.greenroom.check'

const PERMISSIONS: readonly MicPermission[] = ['granted', 'denied', 'prompt', 'unknown']

function isGreenRoomCheck(value: unknown): value is GreenRoomCheck {
  if (typeof value !== 'object' || value === null) return false
  const check = value as Partial<GreenRoomCheck>
  return (
    PERMISSIONS.includes(check.permission as MicPermission) &&
    typeof check.hasMicrophone === 'boolean' &&
    (check.problem === null || typeof check.problem === 'string') &&
    typeof check.checkedAt === 'string'
  )
}

/**
 * The check recorded earlier in this session, or null.
 *
 * Returns null for anything it cannot trust: no storage, unreadable storage,
 * unparseable JSON, or a shape written by an older build. Every one of those
 * means "ask again".
 */
export function readGreenRoomCheck(): GreenRoomCheck | null {
  try {
    const raw = window.sessionStorage.getItem(GREEN_ROOM_SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isGreenRoomCheck(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Record a finished check, problems included.
 *
 * The hook exposes this as `recordSession`; MAI-23 names it both ways and they
 * are the same function. Returns the record it stored, so a caller can hold the
 * result without re-reading storage, or null when nothing could be written.
 */
export function recordGreenRoomCheck(
  result: GreenRoomCheckResult & { permission: MicPermission }
): GreenRoomCheck | null {
  const check: GreenRoomCheck = {
    permission: result.permission,
    hasMicrophone: result.hasMicrophone,
    problem: result.problem ?? null,
    checkedAt: new Date().toISOString(),
  }
  try {
    window.sessionStorage.setItem(GREEN_ROOM_SESSION_KEY, JSON.stringify(check))
    return check
  } catch {
    // Safari private mode throws here. Losing the record only costs the rep
    // another greenroom, so swallow it rather than break the dial.
    return null
  }
}

/** Forget this session's check, so the next decision starts over. */
export function clearGreenRoomCheck(): void {
  try {
    window.sessionStorage.removeItem(GREEN_ROOM_SESSION_KEY)
  } catch {
    // Nothing to do. The next read fails closed and shows the greenroom anyway.
  }
}

/**
 * Did the recorded check clear the rep to call?
 *
 * A check that found no usable microphone is not a pass, so it can never be the
 * thing that skips the greenroom.
 */
export function greenRoomCheckPassed(check: GreenRoomCheck): boolean {
  return check.hasMicrophone && check.problem === null && check.permission !== 'denied'
}
