// Unit tests for the field-history helpers (MAI-136 T8, spec §5.7).
//
// These cover the pure decisions — what counts as a change, how a value is
// normalized for a JSONB column, which source carries a user id, and when a bad
// shape is refused. The ATOMICITY claim (a rolled-back write leaves no history row)
// needs a real transaction and lives in fieldHistory.integration.test.ts.
import { describe, expect, it, vi } from 'vitest'

import {
  CHANGE_SOURCES,
  diffFieldValues,
  FieldHistoryShapeError,
  isChangeSource,
  recordFieldHistoryInTx,
  toHistoryJson,
  validateChangeShapes,
  type HistoryClient,
} from '../fieldHistory.js'
import type { ValidatorAttribute } from '../valuesValidator.js'

// A stand-in for the transaction client: history writing only ever touches
// fieldHistory.createMany, and the type says it must be a transaction client.
function fakeTx() {
  const createMany = vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length }))
  return {
    tx: { fieldHistory: { createMany } } as unknown as HistoryClient,
    createMany,
  }
}

const TITLE: ValidatorAttribute = { slug: 'title', name: 'Title', type: 'text' }

describe('isChangeSource', () => {
  it('accepts every documented source and nothing else', () => {
    for (const source of CHANGE_SOURCES) expect(isChangeSource(source)).toBe(true)
    expect(isChangeSource('robot')).toBe(false)
    expect(isChangeSource(null)).toBe(false)
  })
})

describe('toHistoryJson', () => {
  it('turns what JSONB cannot hold into what it can', () => {
    expect(toHistoryJson(undefined)).toBeNull()
    expect(toHistoryJson(null)).toBeNull()
    expect(toHistoryJson(new Date('2026-06-24T18:00:00.000Z'))).toBe('2026-06-24T18:00:00.000Z')
    expect(toHistoryJson(123456n)).toBe('123456')
    expect(toHistoryJson({ at: new Date('2026-06-24T18:00:00.000Z') })).toEqual({
      at: '2026-06-24T18:00:00.000Z',
    })
    expect(toHistoryJson(['a', 1, true])).toEqual(['a', 1, true])
  })
})

describe('diffFieldValues', () => {
  it('reports only the fields that actually changed', () => {
    const changes = diffFieldValues(
      { title: 'SDR', firstName: 'Jo' },
      { title: 'AE', firstName: 'Jo' },
    )
    expect(changes).toEqual([{ attribute: 'title', oldValue: 'SDR', newValue: 'AE' }])
  })

  it('treats a key the caller did not send as unchanged (patch mode)', () => {
    expect(diffFieldValues({ title: 'SDR', persona: 'champion' }, { title: 'SDR' })).toEqual([])
  })

  it('records a cleared field as a change to null', () => {
    expect(diffFieldValues({ title: 'SDR' }, { title: null })).toEqual([
      { attribute: 'title', oldValue: 'SDR', newValue: null },
    ])
  })

  it('sees a vanished key as a clear in full mode', () => {
    expect(diffFieldValues({ x_url: 'https://x.com/jo' }, {}, { mode: 'full' })).toEqual([
      { attribute: 'x_url', oldValue: 'https://x.com/jo', newValue: null },
    ])
    // ...but not in patch mode, where an absent key means "not sent".
    expect(diffFieldValues({ x_url: 'https://x.com/jo' }, {})).toEqual([])
  })

  it('compares by value, not by reference, so a re-save writes nothing', () => {
    expect(
      diffFieldValues(
        { tags: ['a', 'b'], meta: { k: 1 } },
        { tags: ['a', 'b'], meta: { k: 1 } },
        { mode: 'full' },
      ),
    ).toEqual([])
  })

  it('normalizes a Date the same way on both sides', () => {
    const before = { callbackDate: new Date('2026-06-24T00:00:00.000Z') }
    expect(diffFieldValues(before, { callbackDate: new Date('2026-06-24T00:00:00.000Z') })).toEqual(
      [],
    )
    expect(
      diffFieldValues(before, { callbackDate: new Date('2026-07-01T00:00:00.000Z') }),
    ).toEqual([
      {
        attribute: 'callbackDate',
        oldValue: '2026-06-24T00:00:00.000Z',
        newValue: '2026-07-01T00:00:00.000Z',
      },
    ])
  })

  it('ignores anything outside the named attributes', () => {
    const changes = diffFieldValues(
      { title: 'SDR', updatedAt: new Date('2026-01-01T00:00:00.000Z') },
      { title: 'AE', updatedAt: new Date('2026-02-02T00:00:00.000Z') },
      { only: ['title'] },
    )
    expect(changes.map((c) => c.attribute)).toEqual(['title'])
  })
})

describe('validateChangeShapes', () => {
  it('refuses a value that does not match the attribute type', () => {
    expect(() =>
      validateChangeShapes([{ attribute: 'title', oldValue: null, newValue: 42 }], [TITLE]),
    ).toThrow(FieldHistoryShapeError)
  })

  it('checks the OLD value too, not just the new one', () => {
    expect(() =>
      validateChangeShapes([{ attribute: 'title', oldValue: { a: 1 }, newValue: 'AE' }], [TITLE]),
    ).toThrow(/title/)
  })

  it('leaves an attribute it has no definition for alone', () => {
    expect(() =>
      validateChangeShapes([{ attribute: 'mystery', oldValue: null, newValue: 42 }], [TITLE]),
    ).not.toThrow()
  })

  it('allows a cleared value for any type', () => {
    const rating: ValidatorAttribute = { slug: 'rating', name: 'Rating', type: 'rating' }
    expect(() =>
      validateChangeShapes([{ attribute: 'rating', oldValue: 4, newValue: null }], [rating]),
    ).not.toThrow()
  })
})

describe('recordFieldHistoryInTx', () => {
  it('writes one row per changed field, with the user who made the change', async () => {
    const { tx, createMany } = fakeTx()

    const written = await recordFieldHistoryInTx(tx, {
      orgId: 'org_1',
      objectSlug: 'person',
      recordId: 'per_1',
      changes: diffFieldValues({ title: 'SDR' }, { title: 'AE' }),
      changedByUserId: 'usr_1',
      reason: 'promoted',
      attributes: [TITLE],
    })

    expect(written).toBe(1)
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany.mock.calls[0][0].data).toEqual([
      {
        orgId: 'org_1',
        objectSlug: 'person',
        recordId: 'per_1',
        attribute: 'title',
        oldJson: 'SDR',
        newJson: 'AE',
        changedByUserId: 'usr_1',
        changeSource: 'user',
        reason: 'promoted',
      },
    ])
  })

  it('records a system change with a null user, even if one is offered', async () => {
    const { tx, createMany } = fakeTx()

    await recordFieldHistoryInTx(tx, {
      orgId: 'org_1',
      objectSlug: 'person',
      recordId: 'per_1',
      changes: [{ attribute: 'title', oldValue: null, newValue: 'AE' }],
      changeSource: 'system',
      changedByUserId: 'usr_1',
    })

    const row = (createMany.mock.calls[0][0].data as Record<string, unknown>[])[0]
    expect(row.changeSource).toBe('system')
    expect(row.changedByUserId).toBeNull()
  })

  it('writes nothing at all when nothing changed', async () => {
    const { tx, createMany } = fakeTx()

    const written = await recordFieldHistoryInTx(tx, {
      orgId: 'org_1',
      objectSlug: 'person',
      recordId: 'per_1',
      changes: diffFieldValues({ title: 'AE' }, { title: 'AE' }),
      changedByUserId: 'usr_1',
    })

    expect(written).toBe(0)
    expect(createMany).not.toHaveBeenCalled()
  })

  it('refuses to write a history row whose shape contradicts the attribute type', async () => {
    const { tx, createMany } = fakeTx()

    await expect(
      recordFieldHistoryInTx(tx, {
        orgId: 'org_1',
        objectSlug: 'person',
        recordId: 'per_1',
        changes: [{ attribute: 'title', oldValue: null, newValue: 42 }],
        changedByUserId: 'usr_1',
        attributes: [TITLE],
      }),
    ).rejects.toThrow(FieldHistoryShapeError)
    expect(createMany).not.toHaveBeenCalled()
  })
})
