/**
 * Where the rep's chosen microphone and speaker are remembered.
 *
 * **localStorage, not session storage.** A device choice is a preference: the
 * rep picked their headset once and expects it still picked tomorrow. That is
 * the opposite of `@/lib/greenRoomSession`, which stores a *check result* and
 * deliberately forgets it when the tab closes. Two different things, two
 * different stores.
 *
 * Pure functions, no React. Every access is wrapped, because Safari in private
 * mode throws on `setItem` and a device preference must never be the thing that
 * breaks the dialer. A storage failure degrades to "no saved choice", which
 * falls back to the system default — the safe direction.
 */

/** Namespaced so it cannot collide with another feature's entry. */
export const DEVICE_CHOICE_KEY = 'maincar.devices.choice'

/** The rep's saved picks. `null` means "no saved choice, use the default". */
export interface DeviceChoice {
  microphoneId: string | null
  speakerId: string | null
}

const NO_CHOICE: DeviceChoice = { microphoneId: null, speakerId: null }

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The saved choice, or a pair of nulls.
 *
 * Returns nulls for anything it cannot trust: no storage, unreadable storage,
 * unparseable JSON, or a shape written by an older build. Every one of those
 * means "use the default".
 */
export function readDeviceChoice(): DeviceChoice {
  try {
    const raw = window.localStorage.getItem(DEVICE_CHOICE_KEY)
    if (!raw) return NO_CHOICE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return NO_CHOICE
    const record = parsed as Partial<DeviceChoice>
    return {
      microphoneId: readId(record.microphoneId),
      speakerId: readId(record.speakerId),
    }
  } catch {
    return NO_CHOICE
  }
}

/**
 * Save one half of the choice, leaving the other half as it was.
 *
 * Returns false when nothing could be written. Callers ignore that — losing the
 * preference only costs the rep one more pick — but a test can assert on it.
 */
export function saveDeviceChoice(patch: Partial<DeviceChoice>): boolean {
  const next: DeviceChoice = { ...readDeviceChoice(), ...patch }
  try {
    window.localStorage.setItem(DEVICE_CHOICE_KEY, JSON.stringify(next))
    return true
  } catch {
    // Safari private mode throws here, and so does a full quota.
    return false
  }
}

/** Forget both picks. Used when the rep wants to start from the system default. */
export function clearDeviceChoice(): boolean {
  try {
    window.localStorage.removeItem(DEVICE_CHOICE_KEY)
    return true
  } catch {
    return false
  }
}

/** The minimum a picker needs from a device to resolve a selection. */
interface IdentifiedDevice {
  deviceId: string
}

/**
 * Which device the picker should actually show as selected.
 *
 * A saved device that is no longer plugged in must fall back to the system
 * default, never leave the dropdown pointing at hardware that is not there.
 * Browsers list the system default first, and Chrome gives it the literal id
 * `default`, so prefer that entry and otherwise take the first one.
 *
 * Devices with an empty `deviceId` are skipped: the browser returns those
 * before the page holds microphone permission, and Radix's `Select` rejects an
 * empty value.
 */
export function resolveDeviceId<T extends IdentifiedDevice>(
  preferredId: string | null,
  devices: readonly T[],
): string | null {
  const usable = devices.filter((device) => device.deviceId.length > 0)
  if (usable.length === 0) return null
  if (preferredId && usable.some((device) => device.deviceId === preferredId)) return preferredId
  const systemDefault = usable.find((device) => device.deviceId === 'default')
  return (systemDefault ?? usable[0]).deviceId
}
