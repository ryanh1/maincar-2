import { describe, expect, it } from 'vitest'

import { pinDisposition, reorderPinned } from './dispositionBar'

describe('disposition bar configuration', () => {
  it('moves a pinned disposition into the requested final order', () => {
    expect(reorderPinned(['connected', 'voicemail', 'callback'], 'callback', 'connected')).toEqual([
      'callback',
      'connected',
      'voicemail',
    ])
  })

  it('keeps an eighth disposition in overflow and explains why', () => {
    expect(pinDisposition(['one', 'two', 'three', 'four', 'five', 'six', 'seven'], 'eight')).toEqual({
      pinnedIds: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
      overflowed: true,
    })
  })
})
