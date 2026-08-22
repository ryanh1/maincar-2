import { describe, expect, it } from 'vitest'

import { normalizeAudioLevel } from '@/lib/audioLevel'

describe('normalizeAudioLevel', () => {
  it('keeps silence idle while making low input and ordinary speech distinct', () => {
    expect(normalizeAudioLevel(0)).toBe(0)
    expect(normalizeAudioLevel(0.01)).toBe(0.1)
    expect(normalizeAudioLevel(0.06)).toBe(0.6)
  })

  it('clamps loud and invalid analyser values to the meter range', () => {
    expect(normalizeAudioLevel(0.2)).toBe(1)
    expect(normalizeAudioLevel(-0.1)).toBe(0)
    expect(normalizeAudioLevel(Number.NaN)).toBe(0)
  })
})
