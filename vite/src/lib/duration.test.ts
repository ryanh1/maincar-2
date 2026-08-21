import { describe, expect, it } from 'vitest'

import { formatElapsed } from './duration'

describe('formatElapsed', () => {
  it('formats whole seconds as mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(9)).toBe('00:09')
    expect(formatElapsed(65)).toBe('01:05')
    expect(formatElapsed(600)).toBe('10:00')
  })

  it('never renders a negative or fractional duration', () => {
    expect(formatElapsed(-5)).toBe('00:00')
    expect(formatElapsed(3.9)).toBe('00:03')
  })
})
