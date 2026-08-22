import { describe, expect, it } from 'vitest'

import { decideRecordingPolicy } from '../recordingPolicy.js'

describe('decideRecordingPolicy', () => {
  const defaults = {
    recordCalls: true,
    blockedStates: [] as string[],
  }

  it('records a mapped one-party state when the policy uses its defaults', () => {
    expect(decideRecordingPolicy(defaults, '+12025550123')).toEqual({
      record: true,
      destinationState: 'DC',
      reason: 'allowed',
    })
  })

  it('does not record when recording is disabled for the organization, while retaining its resolved state', () => {
    expect(decideRecordingPolicy({ ...defaults, recordCalls: false }, '+12025550123')).toEqual({
      record: false,
      destinationState: 'DC',
      reason: 'recording-disabled',
    })
  })

  it('does not record a state in the saved blocked set', () => {
    expect(decideRecordingPolicy({ ...defaults, blockedStates: ['CA'] }, '+14155550123')).toEqual({
      record: false,
      destinationState: 'CA',
      reason: 'state-blocked',
    })
  })

  it('does not record an unknown destination only when Unknown is in the saved blocked set', () => {
    expect(decideRecordingPolicy({ ...defaults, blockedStates: ['UNKNOWN'] }, '+442071838750')).toEqual({
      record: false,
      destinationState: null,
      reason: 'unknown-destination-state',
    })

    expect(decideRecordingPolicy(defaults, '+442071838750')).toMatchObject({
      record: true,
      destinationState: null,
      reason: 'allowed',
    })
  })
})
