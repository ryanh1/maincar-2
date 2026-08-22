import { describe, expect, it } from 'vitest'

import {
  coerceCheckbox,
  coerceCurrency,
  coerceDate,
  coerceEmail,
  coerceNumber,
  coercePhone,
  coerceTimestamp,
  coerceUrl,
} from './cellCoercion'

describe('coerceDate', () => {
  it('accepts an ISO date as-is', () => {
    expect(coerceDate('2026-06-24')).toMatchObject({ ok: true, value: '2026-06-24' })
  })

  it('accepts a pasted M/D/YYYY date', () => {
    expect(coerceDate('6/24/2026')).toMatchObject({ ok: true, value: '2026-06-24' })
  })

  it('flags but keeps an unparseable date, never dropping it', () => {
    const result = coerceDate('not a date')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('not a date')
    expect(result.reason).toBeTruthy()
  })

  it('treats an empty string as clearing the cell', () => {
    expect(coerceDate('')).toMatchObject({ ok: true, value: null })
  })
})

describe('coerceTimestamp', () => {
  it('parses a full ISO datetime', () => {
    const result = coerceTimestamp('2026-06-24T22:00:00.000Z')
    expect(result.ok).toBe(true)
    expect(result.value).toBe('2026-06-24T22:00:00.000Z')
  })

  it('flags but keeps unparseable text', () => {
    const result = coerceTimestamp('whenever')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('whenever')
  })
})

describe('coercePhone', () => {
  it('coerces a pasted number to E.164, formatted national for display', () => {
    const result = coercePhone('(202) 555-0123', '+12025550100')
    expect(result.ok).toBe(true)
    expect(result.value).toBe('+12025550123')
    expect(result.display).toContain('202')
  })

  it('flags an ambiguous number (no default country) but keeps the raw text', () => {
    const result = coercePhone('2025550123')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('2025550123')
    expect(result.reason).toBeTruthy()
  })

  it('flags an invalid number but keeps the raw text', () => {
    const result = coercePhone('+1000')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('+1000')
  })
})

describe('coerceEmail', () => {
  it('accepts a well-formed email', () => {
    expect(coerceEmail('ada@example.com')).toMatchObject({ ok: true, value: 'ada@example.com' })
  })

  it('flags but keeps a malformed email', () => {
    const result = coerceEmail('not-an-email')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('not-an-email')
  })
})

describe('coerceUrl', () => {
  it('adds a scheme when missing', () => {
    expect(coerceUrl('example.com')).toMatchObject({ ok: true, value: 'https://example.com' })
  })

  it('lowercases the host', () => {
    const result = coerceUrl('https://EXAMPLE.com/Path')
    expect(result.value).toBe('https://example.com/Path')
  })

  it('flags but keeps an unparseable URL', () => {
    const result = coerceUrl('not a url at all')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('not a url at all')
  })
})

describe('coerceNumber / coerceCurrency', () => {
  it('parses a plain number', () => {
    expect(coerceNumber('42')).toMatchObject({ ok: true, value: 42 })
  })

  it('strips currency formatting for currency cells', () => {
    expect(coerceCurrency('$1,234.50')).toMatchObject({ ok: true, value: 1234.5 })
  })

  it('flags but keeps unparseable numeric text', () => {
    const result = coerceNumber('abc')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('abc')
  })
})

describe('coerceCheckbox', () => {
  it('recognizes common truthy/falsy spellings', () => {
    expect(coerceCheckbox('yes')).toMatchObject({ ok: true, value: true })
    expect(coerceCheckbox('0')).toMatchObject({ ok: true, value: false })
  })

  it('flags but keeps unrecognized text', () => {
    const result = coerceCheckbox('maybe')
    expect(result.ok).toBe(false)
    expect(result.value).toBe('maybe')
  })
})
