import { describe, expect, it } from 'vitest'

import { getOutreachLayout } from './outreachLayout'

describe('getOutreachLayout', () => {
  it('reserves a stable desktop rail while the dialer is collapsed', () => {
    expect(getOutreachLayout(1440, false)).toEqual({
      usesRail: true,
      pageRightInsetPx: 64,
      pageBottomInsetPx: 0,
      dialerRightInsetPx: 64,
    })
  })

  it('adds the expanded dialer to the protected page inset', () => {
    expect(getOutreachLayout(1440, true)).toEqual({
      usesRail: true,
      pageRightInsetPx: 384,
      pageBottomInsetPx: 0,
      dialerRightInsetPx: 64,
    })
  })

  it('reserves the desktop composer height without changing the shared right boundary', () => {
    expect(getOutreachLayout(1440, true, true)).toEqual({
      usesRail: true,
      pageRightInsetPx: 384,
      pageBottomInsetPx: 384,
      dialerRightInsetPx: 64,
    })
  })

  it('switches from mobile bottom space to the rail at 640 px', () => {
    expect(getOutreachLayout(639, true)).toEqual({
      usesRail: false,
      pageRightInsetPx: 0,
      pageBottomInsetPx: 48,
      dialerRightInsetPx: 0,
    })
    expect(getOutreachLayout(640, false).usesRail).toBe(true)
  })
})
