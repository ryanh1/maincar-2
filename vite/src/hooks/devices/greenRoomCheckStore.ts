/**
 * The session's greenroom check, held in ONE place for every hook instance.
 *
 * ## Why this module exists
 *
 * `useGreenRoomDecision` is read twice on the same screen, by design: the dialer
 * reads it to decide whether to open the greenroom or dial straight through, and
 * `GreenRoom` reads it again to decide whether to render. If each instance kept
 * its own copy of the record in `useState`, the two would disagree the moment one
 * of them recorded a check — and they disagree in the worst possible direction:
 *
 *   - the caller's instance still holds `null`   -> shouldShow, so it sets intent
 *   - GreenRoom's instance holds the fresh pass  -> 'retry', so it renders nothing
 *
 * and `GreenRoom` never auto-confirms. **The rep presses Call and nothing happens
 * at all** — no dialog, no call. Two instances of this hook must agree, so the
 * record lives here, outside React, and every instance subscribes to it.
 *
 * The store is deliberately thin: `@/lib/greenRoomSession` still owns the storage
 * format and stays pure and React-free. This module owns only *who is told when
 * it changes*.
 */
import {
  clearGreenRoomCheck,
  readGreenRoomCheck,
  recordGreenRoomCheck,
} from '@/lib/greenRoomSession'

import type { GreenRoomCheck, GreenRoomCheckResult, MicPermission } from './types'

/**
 * The cached record, and whether it has been read yet.
 *
 * `getSnapshot` MUST return the same reference until the value actually changes:
 * React calls it on every render and re-renders whenever the result differs by
 * identity, so parsing storage afresh each time would return a new object each
 * time and loop forever. Hence a cached value rather than a read per call —
 * which also means session storage is touched once, not on every render.
 */
let cached: GreenRoomCheck | null = null
let hasRead = false

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Subscribe to record changes. The unsubscribe is what React holds on to. */
export function subscribeToGreenRoomCheck(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current record, read from session storage once and cached by reference. */
export function getGreenRoomCheckSnapshot(): GreenRoomCheck | null {
  if (!hasRead) {
    cached = readGreenRoomCheck()
    hasRead = true
  }
  return cached
}

/**
 * Record a finished check and tell every instance.
 *
 * A refused write (Safari private mode) stores nothing and caches null, so the
 * next decision is 'initial' and the greenroom shows — the safe direction, and
 * the same behaviour as before this store existed.
 */
export function recordGreenRoomCheckInStore(
  result: GreenRoomCheckResult & { permission: MicPermission }
): void {
  cached = recordGreenRoomCheck(result)
  hasRead = true
  emit()
}

/**
 * Forget this session's check, everywhere.
 *
 * Nothing calls this yet, but `clearGreenRoomCheck` in `@/lib/greenRoomSession`
 * is exported, and calling *that* one directly would clear storage while every
 * mounted hook kept showing the cached record — exactly the split-brain this
 * store exists to prevent. Anything inside React clears the check through here.
 */
export function clearGreenRoomCheckInStore(): void {
  clearGreenRoomCheck()
  cached = null
  hasRead = true
  emit()
}

/**
 * TEST ONLY. Drop the cache so the next snapshot re-reads session storage.
 *
 * Module state outlives an individual test, so a suite that writes storage
 * directly (`recordGreenRoomCheck`) or clears it between cases must reset this
 * too, or it reads a record from the test before. Not for production code —
 * production has exactly one session, and it lasts as long as the tab.
 */
export function __resetGreenRoomCheckStoreForTests(): void {
  cached = null
  hasRead = false
  emit()
}
