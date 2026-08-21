import { describe, expect, it } from 'vitest'

import { getCallStatusLabel, getTranscriptStatusLabel } from '@/lib/callLabels'

describe('getCallStatusLabel', () => {
  it('turns every raw status into a human label', () => {
    expect(getCallStatusLabel('completed')).toBe('Completed')
    expect(getCallStatusLabel('in-progress')).toBe('In progress')
    expect(getCallStatusLabel('no-answer')).toBe('No answer')
  })

  it('falls back to the raw value rather than rendering nothing', () => {
    expect(getCallStatusLabel('something-new')).toBe('something-new')
  })
})

describe('getTranscriptStatusLabel', () => {
  it('reads a never-recorded call as None, not an error', () => {
    expect(getTranscriptStatusLabel('skipped-not-recorded')).toBe('None')
  })

  it('labels the ready and pending states', () => {
    expect(getTranscriptStatusLabel('done')).toBe('Ready')
    expect(getTranscriptStatusLabel('pending')).toBe('Pending')
  })
})
