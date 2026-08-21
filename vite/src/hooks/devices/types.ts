// Shapes for the audio-device hooks. Nothing here comes from the API — these
// describe the hardware the browser reports through the Web Audio APIs.

/**
 * One microphone or speaker, narrowed from the browser's `MediaDeviceInfo`.
 *
 * `label` is the human-readable name ("MacBook Pro Microphone"). The browser
 * returns an empty string for it until the page holds microphone permission,
 * and some browsers still withhold it for the default device, so a consumer
 * rendering a picker must handle an empty label.
 */
export interface AudioDevice {
  deviceId: string
  label: string
  groupId: string
}

/** What `useGetDevices()` returns. */
export interface UseGetDevicesResult {
  microphones: AudioDevice[]
  speakers: AudioDevice[]
  /** True while a read is in flight, including a refetch and a device-change re-read. */
  isLoading: boolean
  /** A sentence the rep can act on, or null. Never a raw DOMException message. */
  error: string | null
  /** Re-read the device list. Does not re-prompt once permission is granted. */
  refetch: () => void
}

// ---------------------------------------------------------------------------
// Greenroom decision (MAI-11 / MAI-23)
// ---------------------------------------------------------------------------

/**
 * What the browser says about microphone permission.
 *
 * `'unknown'` is a real state, not a missing value. Firefox rejects
 * `permissions.query({ name: 'microphone' })` outright, and some browsers ship
 * no Permissions API at all. It never compares equal to a recorded state, so an
 * unknown permission always sends the rep back through the greenroom, which is
 * the safe direction.
 */
export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

/**
 * One completed greenroom check, as held in session storage.
 *
 * It records the problems too, not just the passes, so the next decision has
 * something real to compare the live permission against.
 */
export interface GreenRoomCheck {
  /** The permission state seen when the check ran. */
  permission: MicPermission
  /** Whether the check found a microphone it could use. */
  hasMicrophone: boolean
  /** What went wrong, in the rep's words, or null when the check passed. */
  problem: string | null
  /** ISO-8601 UTC. Diagnostic only — never rendered, so it carries no zone label. */
  checkedAt: string
}

/** What a finished greenroom check hands back to `recordSession`. */
export interface GreenRoomCheckResult {
  /** Whether the check found a microphone it could use. */
  hasMicrophone: boolean
  /** What went wrong, in the rep's words. Omit or pass null when the check passed. */
  problem?: string | null
  /**
   * Defaults to the permission the hook last read. Pass it when the check
   * learned something more current — `getUserMedia` is more authoritative than
   * the Permissions API, and it is the greenroom that calls it.
   */
  permission?: MicPermission
}

/** Why the greenroom is showing, or why it is being skipped. */
export type GreenRoomReason = 'initial' | 'mic-denied' | 'permission-changed' | 'retry'

/** What `useGreenRoomDecision()` returns. */
export interface UseGreenRoomDecisionResult {
  /** Why the decision came out the way it did. */
  reason: GreenRoomReason
  /** The single boolean a caller acts on. */
  shouldShow: boolean
  /** The current microphone permission state. */
  permission: MicPermission
  /**
   * Record a finished check for the rest of this browsing session.
   *
   * This is the hook's name for the pure `recordGreenRoomCheck` in
   * `@/lib/greenRoomSession` — MAI-23 calls it by both names, and they are one
   * thing.
   */
  recordSession: (result: GreenRoomCheckResult) => void
}
