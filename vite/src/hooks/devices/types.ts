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
