import { describe, expect, it } from 'vitest'

import { callOutcomeMessage } from './callOutcomeMessage'

describe('callOutcomeMessage', () => {
  it.each([
    ['busy', 'The number is busy. Try again later.'],
    ['no-answer', 'No one answered. Try again later.'],
    ['failed', 'The call could not connect. Check your connection and try again.'],
    ['dropped', 'The call dropped. Try again.'],
  ] as const)('explains a %s call outcome and names the next action', (outcome, message) => {
    expect(callOutcomeMessage(outcome)).toBe(message)
  })
})
