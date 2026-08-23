import { useEffect, useState } from 'react'

import { AudioPlayer } from '@/components/call-review/AudioPlayer'

function createSilentWavUrl(seconds: number): string {
  const sampleRate = 8_000
  const bytesPerSample = 2
  const dataLength = sampleRate * seconds * bytesPerSample
  const bytes = new Uint8Array(44 + dataLength)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, value: string) => value.split('').forEach((character, index) => bytes[offset + index] = character.charCodeAt(0))

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeText(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataLength, true)

  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}

/** Development-only fixture used by the real-browser audio controller journey. */
export function AudioPlayerFixture() {
  const [sourceUrl] = useState(() => createSilentWavUrl(5))

  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <section aria-labelledby="audio-fixture-title" className="w-full max-w-md border border-border bg-surface p-4">
        <h1 id="audio-fixture-title" className="text-base font-semibold">Audio player fixture</h1>
        <div className="mt-4"><AudioPlayer source={{ kind: 'audio', url: sourceUrl, expiresAt: '2026-08-22T00:00:00.000Z' }} recordingState="ready" callLabel="Audio fixture" segments={[{ speakerKey: 'rep', startMs: 0, endMs: 1_500 }, { speakerKey: 'buyer', startMs: 2_000, endMs: 4_500 }]} speakers={[{ speakerKey: 'rep', label: 'You' }, { speakerKey: 'buyer', label: 'Buyer' }]} /></div>
      </section>
    </main>
  )
}
