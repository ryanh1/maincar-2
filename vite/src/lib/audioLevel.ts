/**
 * Browser analyser RMS values are naturally small: ordinary speech usually
 * sits near 0.06, which a direct five-bar display makes look almost silent.
 * Keep true silence at zero while lifting low input to one bar and speech into
 * the meter's useful middle range. Every device meter uses this one mapping.
 */
const AUDIO_LEVEL_GAIN = 10

export function normalizeAudioLevel(rms: number): number {
  if (!Number.isFinite(rms)) return 0
  return Math.max(0, Math.min(1, rms * AUDIO_LEVEL_GAIN))
}
