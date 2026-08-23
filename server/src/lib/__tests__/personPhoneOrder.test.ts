import { describe, expect, it } from 'vitest'

import { resolveNextUsablePersonPhone, type PersonPhoneCandidate } from '../personPhoneOrder.js'

function phone(overrides: Partial<PersonPhoneCandidate> = {}): PersonPhoneCandidate {
  return {
    id: 'phone-primary',
    e164: '+12025550100',
    position: 0,
    isPrimary: true,
    isDnc: false,
    status: 'unverified',
    ...overrides,
  }
}

describe('resolveNextUsablePersonPhone', () => {
  it('returns the primary before later positions, then advances past an attempted phone', () => {
    const phones = [
      phone({ id: 'work', e164: '+12025550102', position: 2, isPrimary: false }),
      phone({ id: 'mobile', e164: '+12025550101', position: 1, isPrimary: false }),
      phone(),
    ]

    expect(resolveNextUsablePersonPhone({ phones, attemptedPhoneIds: [] })).toEqual({
      kind: 'phone',
      phone: phone(),
    })
    expect(resolveNextUsablePersonPhone({ phones, attemptedPhoneIds: ['phone-primary'] })).toEqual({
      kind: 'phone',
      phone: phone({ id: 'mobile', e164: '+12025550101', position: 1, isPrimary: false }),
    })
  })

  it('skips attempted, DNC, and dead phones and explicitly reports exhaustion', () => {
    const phones = [
      phone({ id: 'attempted', isPrimary: true }),
      phone({ id: 'dnc', position: 1, isPrimary: false, isDnc: true }),
      phone({ id: 'dead', position: 2, isPrimary: false, status: 'dead' }),
    ]

    expect(resolveNextUsablePersonPhone({ phones, attemptedPhoneIds: ['attempted'] })).toEqual({
      kind: 'exhausted',
    })
  })
})
