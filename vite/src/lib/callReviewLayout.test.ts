import { beforeEach, describe, expect, it } from 'vitest'

import {
  CALL_REVIEW_LAYOUT_STORAGE_PREFIX,
  getStoredCallReviewLayout,
  saveCallReviewLayout,
} from '@/lib/callReviewLayout'

describe('call review layout storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('uses the balanced layout until this user chooses a layout', () => {
    expect(getStoredCallReviewLayout('user-a')).toEqual({ preset: 'balanced', playbackWidth: 60 })
  })

  it('keeps one user’s chosen preset and divider width separate from another user', () => {
    saveCallReviewLayout('user-a', { preset: 'focused-comments', playbackWidth: 40 })

    expect(getStoredCallReviewLayout('user-a')).toEqual({ preset: 'focused-comments', playbackWidth: 40 })
    expect(getStoredCallReviewLayout('user-b')).toEqual({ preset: 'balanced', playbackWidth: 60 })
    expect(window.localStorage.getItem(`${CALL_REVIEW_LAYOUT_STORAGE_PREFIX}:user-a`)).toContain('focused-comments')
  })

  it('falls back to the balanced layout when saved data is malformed', () => {
    window.localStorage.setItem(`${CALL_REVIEW_LAYOUT_STORAGE_PREFIX}:user-a`, '{bad json')

    expect(getStoredCallReviewLayout('user-a')).toEqual({ preset: 'balanced', playbackWidth: 60 })
  })
})
