import { describe, expect, it } from 'vitest'

import { mapGroupRows } from '../recordList.js'

describe('mapGroupRows', () => {
  it('maps People grouped by Company into counted sections, including the no-value section', () => {
    const groups = mapGroupRows(
      [
        { __groupDepth: 1, __groupKey0: 'acme', __groupCount: '2' },
        { __groupDepth: 1, __groupKey0: null, __groupCount: '1' },
      ],
      [],
    )

    expect(groups).toEqual([
      { key: '["acme"]', value: 'acme', count: 2 },
      { key: '[null]', value: '(No value)', count: 1 },
    ])
  })

  it('maps Deals grouped by Stage with server-calculated amount sums and averages', () => {
    const groups = mapGroupRows(
      [
        { __groupDepth: 1, __groupKey0: 'won', __groupCount: '2', __sum0: '480000', __avg0: '240000.0000000000000000' },
        { __groupDepth: 1, __groupKey0: 'open', __groupCount: '1', __sum0: null, __avg0: null },
      ],
      ['amountMinor'],
    )

    expect(groups).toEqual([
      { key: '["won"]', value: 'won', count: 2, sum: { amountMinor: '480000' }, avg: { amountMinor: '240000' } },
      { key: '["open"]', value: 'open', count: 1 },
    ])
  })

  it('nests a second grouping level below its aggregate parent section', () => {
    const groups = mapGroupRows(
      [
        { __groupDepth: 1, __groupKey0: 'open', __groupCount: '3', __sum0: '580000', __avg0: '193333.3333333333333333' },
        { __groupDepth: 2, __groupKey0: 'open', __groupKey1: 'discovery', __groupCount: '2', __sum0: '480000', __avg0: '240000.0000000000000000' },
        { __groupDepth: 2, __groupKey0: 'open', __groupKey1: 'proposal', __groupCount: '1', __sum0: '100000', __avg0: '100000.0000000000000000' },
      ],
      ['amountMinor'],
    )

    expect(groups).toMatchObject([
      {
        key: '["open"]',
        count: 3,
        sum: { amountMinor: '580000' },
        avg: { amountMinor: '193333.3333333333333333' },
        children: [
          { key: '["open","discovery"]', count: 2, sum: { amountMinor: '480000' }, avg: { amountMinor: '240000' } },
          { key: '["open","proposal"]', count: 1, sum: { amountMinor: '100000' }, avg: { amountMinor: '100000' } },
        ],
      },
    ])
  })
})
