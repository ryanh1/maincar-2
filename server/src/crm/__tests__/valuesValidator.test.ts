// Unit tests for the ONE custom-value validator (MAI-135, T7; spec §5.11, §5.14).
//
// This is the single place every valuesJson write is checked, so its four jobs are
// pinned here: type, required, unique, and empty-normalization. It is a pure
// function (uniqueness is an injected callback), so no database is needed.
import { describe, expect, it, vi } from 'vitest'

import {
  checkValueShape,
  validateRecordValues,
  type ValidatorAttribute,
} from '../valuesValidator.js'

function attr(overrides: Partial<ValidatorAttribute> & { slug: string; type: string }): ValidatorAttribute {
  return { name: overrides.slug, ...overrides }
}

describe('validateRecordValues — type checking (spec §8)', () => {
  it('accepts a well-typed value for each core type', async () => {
    const attributes: ValidatorAttribute[] = [
      attr({ slug: 'title', type: 'text' }),
      attr({ slug: 'count', type: 'number' }),
      attr({ slug: 'active', type: 'checkbox' }),
      attr({ slug: 'site', type: 'url' }),
      attr({ slug: 'contact', type: 'email' }),
      attr({ slug: 'renew', type: 'date' }),
    ]
    const res = await validateRecordValues({
      attributes,
      mode: 'create',
      input: {
        title: 'Acme',
        count: 42,
        active: true,
        site: 'https://acme.com',
        contact: 'jo@acme.com',
        renew: '2026-03-01',
      },
    })
    expect(res).toEqual({
      ok: true,
      values: {
        title: 'Acme',
        count: 42,
        active: true,
        site: 'https://acme.com',
        contact: 'jo@acme.com',
        renew: '2026-03-01',
      },
    })
  })

  it('rejects a number field given a string', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'count', name: 'Count', type: 'number' })],
      mode: 'create',
      input: { count: 'lots' },
    })
    expect(res).toEqual({ ok: false, error: 'Count must be a number.' })
  })

  it('rejects a malformed email and a non-http url', async () => {
    const bad = await validateRecordValues({
      attributes: [attr({ slug: 'contact', name: 'Contact', type: 'email' })],
      mode: 'create',
      input: { contact: 'not-an-email' },
    })
    expect(bad.ok).toBe(false)

    const badUrl = await validateRecordValues({
      attributes: [attr({ slug: 'site', name: 'Site', type: 'url' })],
      mode: 'create',
      input: { site: 'acme.com' },
    })
    expect(badUrl.ok).toBe(false)
  })

  it('rejects a value whose key is not a field on the object', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'title', type: 'text' })],
      mode: 'create',
      input: { nope: 'x' },
    })
    expect(res).toEqual({ ok: false, error: 'nope is not a field on this object.' })
  })

  it('rejects writing a read-only field', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'score', name: 'Score', type: 'number', isReadOnly: true })],
      mode: 'create',
      input: { score: 5 },
    })
    expect(res).toEqual({ ok: false, error: 'Score is read-only.' })
  })
})

describe('validateRecordValues — select/status option membership (spec §5.6a)', () => {
  const options = [
    { value: 'saas', label: 'SaaS', isArchived: false },
    { value: 'agency', label: 'Agency', isArchived: false },
    { value: 'legacy', label: 'Legacy', isArchived: true },
  ]

  it('accepts a live option value', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'kind', type: 'select', optionsJson: options })],
      mode: 'create',
      input: { kind: 'saas' },
    })
    expect(res.ok).toBe(true)
  })

  it('rejects a value that is not an option', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'kind', name: 'Kind', type: 'select', optionsJson: options })],
      mode: 'create',
      input: { kind: 'unknown' },
    })
    expect(res).toEqual({ ok: false, error: 'unknown is not an option for Kind.' })
  })

  it('rejects an archived option', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'kind', type: 'select', optionsJson: options })],
      mode: 'create',
      input: { kind: 'legacy' },
    })
    expect(res.ok).toBe(false)
  })

  it('skips membership when the attribute has no option list (e.g. a stage)', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'stageId', type: 'status' })],
      mode: 'create',
      input: { stageId: 'stage-123' },
    })
    expect(res.ok).toBe(true)
  })
})

describe('validateRecordValues — multiplicity (isMulti)', () => {
  const tags = attr({
    slug: 'tags',
    name: 'Tags',
    type: 'multiselect',
    isMulti: true,
    optionsJson: [
      { value: 'a', label: 'A', isArchived: false },
      { value: 'b', label: 'B', isArchived: false },
    ],
  })

  it('accepts an array of valid options and drops empty elements', async () => {
    const res = await validateRecordValues({
      attributes: [tags],
      mode: 'create',
      input: { tags: ['a', '', 'b'] },
    })
    expect(res).toEqual({ ok: true, values: { tags: ['a', 'b'] } })
  })

  it('rejects a single value where a list is required', async () => {
    const res = await validateRecordValues({
      attributes: [tags],
      mode: 'create',
      input: { tags: 'a' },
    })
    expect(res).toEqual({ ok: false, error: 'Tags must be a list of values.' })
  })

  it('rejects a list where a single value is required', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'name', name: 'Name', type: 'text' })],
      mode: 'create',
      input: { name: ['a', 'b'] },
    })
    expect(res).toEqual({ ok: false, error: 'Name does not take a list of values.' })
  })
})

describe('validateRecordValues — required (spec §5.11)', () => {
  it('rejects a create missing a required field', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'name', name: 'Name', type: 'text', isRequired: true })],
      mode: 'create',
      input: {},
    })
    expect(res).toEqual({ ok: false, error: 'Name is required.' })
  })

  it('rejects clearing a required field on update', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'name', name: 'Name', type: 'text', isRequired: true })],
      mode: 'update',
      current: { name: 'Acme' },
      input: { name: '' },
    })
    expect(res).toEqual({ ok: false, error: 'Name is required.' })
  })

  it('keeps a required field satisfied by the current value on a partial update', async () => {
    const res = await validateRecordValues({
      attributes: [
        attr({ slug: 'name', name: 'Name', type: 'text', isRequired: true }),
        attr({ slug: 'note', type: 'text' }),
      ],
      mode: 'update',
      current: { name: 'Acme' },
      input: { note: 'hi' },
    })
    expect(res).toEqual({ ok: true, values: { name: 'Acme', note: 'hi' } })
  })
})

describe('validateRecordValues — empty normalization (spec §5.14)', () => {
  it('stores a cleared value as ABSENT, never ""', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'title', type: 'text' })],
      mode: 'create',
      input: { title: '   ' },
    })
    expect(res).toEqual({ ok: true, values: {} })
  })

  it('trims surrounding whitespace on a kept value', async () => {
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'title', type: 'text' })],
      mode: 'create',
      input: { title: '  Acme  ' },
    })
    expect(res).toEqual({ ok: true, values: { title: 'Acme' } })
  })

  it('removes a key on update when it is cleared, leaving others intact', async () => {
    const res = await validateRecordValues({
      attributes: [
        attr({ slug: 'title', type: 'text' }),
        attr({ slug: 'note', type: 'text' }),
      ],
      mode: 'update',
      current: { title: 'Acme', note: 'keep' },
      input: { title: null },
    })
    expect(res).toEqual({ ok: true, values: { note: 'keep' } })
  })
})

describe('validateRecordValues — uniqueness (injected checker)', () => {
  it('rejects a value another record already holds', async () => {
    const checkUnique = vi.fn().mockResolvedValue(true)
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'sku', name: 'SKU', type: 'text', isUnique: true })],
      mode: 'create',
      input: { sku: 'ABC-1' },
      checkUnique,
    })
    expect(res).toEqual({ ok: false, error: 'SKU must be unique; that value is already used.' })
    expect(checkUnique).toHaveBeenCalledOnce()
  })

  it('accepts a unique value no other record holds', async () => {
    const checkUnique = vi.fn().mockResolvedValue(false)
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'sku', type: 'text', isUnique: true })],
      mode: 'create',
      input: { sku: 'ABC-1' },
      checkUnique,
    })
    expect(res.ok).toBe(true)
  })

  it('does not run the uniqueness check for an absent value', async () => {
    const checkUnique = vi.fn().mockResolvedValue(true)
    const res = await validateRecordValues({
      attributes: [attr({ slug: 'sku', type: 'text', isUnique: true })],
      mode: 'create',
      input: {},
      checkUnique,
    })
    expect(res.ok).toBe(true)
    expect(checkUnique).not.toHaveBeenCalled()
  })
})

// The shape half of the validator on its own — what field history validates
// oldJson/newJson with (MAI-136, spec §5.7).
describe('checkValueShape', () => {
  it('accepts a well-typed value and refuses a wrongly-typed one', () => {
    const title = attr({ slug: 'title', type: 'text' })
    expect(checkValueShape(title, 'VP Sales')).toBeNull()
    expect(checkValueShape(title, 42)).toContain('must be text')
  })

  it('treats an empty value as fine — a field can always be cleared', () => {
    const count = attr({ slug: 'count', type: 'number' })
    expect(checkValueShape(count, null)).toBeNull()
    expect(checkValueShape(count, undefined)).toBeNull()
    expect(checkValueShape(count, '   ')).toBeNull()
    expect(checkValueShape(count, [])).toBeNull()
  })

  it('checks every element of a multi value, and refuses a list for a single field', () => {
    const tags = attr({ slug: 'tags', type: 'text', isMulti: true })
    expect(checkValueShape(tags, ['a', 'b'])).toBeNull()
    expect(checkValueShape(tags, ['a', 3])).toContain('must be text')
    expect(checkValueShape(tags, 'a')).toContain('must be a list')
    expect(checkValueShape(attr({ slug: 'title', type: 'text' }), ['a'])).toContain(
      'does not take a list',
    )
  })

  it('enforces option membership for a select', () => {
    const stage = attr({
      slug: 'stage',
      type: 'select',
      optionsJson: [{ value: 'new' }, { value: 'old', isArchived: true }],
    })
    expect(checkValueShape(stage, 'new')).toBeNull()
    expect(checkValueShape(stage, 'old')).toContain('is not an option')
  })
})
