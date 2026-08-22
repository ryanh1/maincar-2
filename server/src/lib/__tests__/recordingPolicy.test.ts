import { describe, expect, it } from 'vitest'

import { decideRecordingPolicy } from '../recordingPolicy.js'

describe('decideRecordingPolicy', () => {
  const defaults = {
    recordCalls: true,
    blockTwoPartyConsentStates: true,
    allowedStates: [] as string[],
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

  it('does not record a two-party-consent state while its safeguard is enabled', () => {
    expect(decideRecordingPolicy(defaults, '+14155550123')).toEqual({
      record: false,
      destinationState: 'CA',
      reason: 'two-party-consent-state',
    })
  })

  it('allows a two-party-consent state when the safeguard is disabled', () => {
    expect(
      decideRecordingPolicy({ ...defaults, blockTwoPartyConsentStates: false }, '+14155550123'),
    ).toMatchObject({ record: true, destinationState: 'CA', reason: 'allowed' })
  })

  it('does not record a mapped state excluded by the organization allowlist', () => {
    expect(decideRecordingPolicy({ ...defaults, allowedStates: ['NY'] }, '+12025550123')).toEqual({
      record: false,
      destinationState: 'DC',
      reason: 'state-not-allowed',
    })
  })

  it('takes the conservative path for unknown and non-US numbers while safeguarded', () => {
    expect(decideRecordingPolicy(defaults, '+442071838750')).toEqual({
      record: false,
      destinationState: null,
      reason: 'unknown-destination-state',
    })
  })
})
