import { describe, expect, it } from 'vitest'

import { formatCellValue } from './recordCellValue'

describe('formatCellValue', () => {
  it('renders null, undefined, and empty string as blank', () => {
    expect(formatCellValue(null, 'text', 'America/New_York')).toBe('')
    expect(formatCellValue(undefined, 'text', 'America/New_York')).toBe('')
    expect(formatCellValue('', 'text', 'America/New_York')).toBe('')
  })

  it('formats a timestamp in the viewing user zone, with a zone label', () => {
    const value = formatCellValue('2026-06-24T22:00:00.000Z', 'timestamp', 'America/New_York')
    expect(value).toContain('Jun 24, 2026')
    expect(value).toMatch(/EDT|EST/)
  })

  it('formats a date with no time and no zone', () => {
    // A bare "YYYY-MM-DD" string parses as UTC midnight (`formatDate`'s own
    // caveat) — a zone west of UTC reads it as the previous day, which is why
    // this test picks a UTC-anchored value rather than asserting the day back.
    const value = formatCellValue('2026-06-24', 'date', 'UTC')
    expect(value).toBe('Jun 24, 2026')
  })

  it('renders a checkbox as Yes/No', () => {
    expect(formatCellValue(true, 'checkbox', null)).toBe('Yes')
    expect(formatCellValue(false, 'checkbox', null)).toBe('No')
  })

  it('renders currency through the locale formatter, including minor-unit deal amounts', () => {
    expect(formatCellValue(42.5, 'currency', null)).toBe('$42.50')
    expect(formatCellValue('12345', 'currency', null, 'USD', true)).toBe('$123.45')
  })

  it('stringifies a plain scalar for every other type', () => {
    expect(formatCellValue('Ada', 'person_name', null)).toBe('Ada')
    expect(formatCellValue(42, 'number', null)).toBe('42')
  })
})
