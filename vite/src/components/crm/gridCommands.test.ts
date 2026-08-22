import { describe, expect, it } from 'vitest'

import { parseGridCommand } from './gridCommands'

describe('parseGridCommand', () => {
  it('parses a natural-language @date command into an ISO calendar date', () => {
    expect(parseGridCommand('@date next tue', { type: 'date' }, new Date('2026-08-22T12:00:00Z'))).toEqual({
      kind: 'value',
      value: '2026-08-25',
    })
  })

  it('maps @status to a matching option value', () => {
    expect(
      parseGridCommand('@status In progress', {
        type: 'status',
        options: [{ value: 'in_progress', label: 'In progress' }],
      }),
    ).toEqual({ kind: 'value', value: 'in_progress' })
  })
})
