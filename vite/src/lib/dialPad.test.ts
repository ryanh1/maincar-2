import { describe, expect, it } from 'vitest'

import {
  ENTRY_KEYS,
  IN_CALL_KEYS,
  defaultCountryOf,
  entryMessage,
  formatEntry,
  isE164,
  readEntry,
  sanitizeEntry,
} from './dialPad'

/**
 * The four entries the dialer has to tell apart — valid, invalid, ambiguous, and
 * already-E.164 — plus the in-progress one that must NOT read as an error while
 * the rep is still typing.
 */
describe('isE164', () => {
  it('accepts a plus, a non-zero country digit, and 7-15 digits', () => {
    expect(isE164('+12025550123')).toBe(true)
    expect(isE164('+442071838750')).toBe(true)
  })

  it('rejects anything the server would reject', () => {
    expect(isE164('2025550123')).toBe(false)
    expect(isE164('+02025550123')).toBe(false)
    expect(isE164('+1202')).toBe(false)
    expect(isE164('+1202555012345678')).toBe(false)
  })
})

describe('sanitizeEntry', () => {
  it('keeps digits and drops the punctuation a rep types', () => {
    expect(sanitizeEntry('(202) 555-0123')).toBe('2025550123')
  })

  it('keeps a leading plus and drops one typed mid-number', () => {
    expect(sanitizeEntry('+1 202 555 0123')).toBe('+12025550123')
    expect(sanitizeEntry('202+555')).toBe('202555')
  })

  it('folds the 00 international prefix into the plus it stands for', () => {
    expect(sanitizeEntry('00442071838750')).toBe('+442071838750')
    // Mid-entry, `00` alone is just the plus so far.
    expect(sanitizeEntry('00')).toBe('+')
  })
})

describe('defaultCountryOf', () => {
  it('reads the country from the line the rep calls out on', () => {
    expect(defaultCountryOf('+14155550100')).toBe('US')
    expect(defaultCountryOf('+442071838750')).toBe('GB')
  })

  it('has no country when there is no active number', () => {
    expect(defaultCountryOf(null)).toBeUndefined()
    expect(defaultCountryOf(undefined)).toBeUndefined()
    expect(defaultCountryOf('')).toBeUndefined()
  })
})

describe('readEntry', () => {
  it('normalises a nationally typed number to E.164', () => {
    expect(readEntry('2025550123', 'US')).toEqual({ status: 'valid', e164: '+12025550123' })
  })

  it('normalises the same number however the rep punctuates it', () => {
    expect(readEntry('(202) 555-0123', 'US')).toEqual({ status: 'valid', e164: '+12025550123' })
    expect(readEntry('202-555-0123', 'US')).toEqual({ status: 'valid', e164: '+12025550123' })
    expect(readEntry('1 202 555 0123', 'US')).toEqual({ status: 'valid', e164: '+12025550123' })
  })

  it('passes an already-E.164 entry straight through', () => {
    expect(readEntry('+12025550123', 'US')).toEqual({ status: 'valid', e164: '+12025550123' })
    // The default country is ignored once the entry carries its own.
    expect(readEntry('+442071838750', 'US')).toEqual({ status: 'valid', e164: '+442071838750' })
  })

  it('reads 00 as the international prefix', () => {
    expect(readEntry('00442071838750', 'US')).toEqual({ status: 'valid', e164: '+442071838750' })
  })

  it('says nothing while the number is still being typed', () => {
    expect(readEntry('202', 'US')).toEqual({ status: 'incomplete' })
    expect(readEntry('20255', 'US')).toEqual({ status: 'incomplete' })
  })

  it('treats a blank or bare plus as empty', () => {
    expect(readEntry('', 'US')).toEqual({ status: 'empty' })
    expect(readEntry('   ', 'US')).toEqual({ status: 'empty' })
    expect(readEntry('+', 'US')).toEqual({ status: 'empty' })
  })

  it('refuses bare digits when there is no country to read them in', () => {
    expect(readEntry('2025550123')).toEqual({ status: 'ambiguous' })
  })

  it('still reads an E.164 entry with no default country', () => {
    expect(readEntry('+12025550123')).toEqual({ status: 'valid', e164: '+12025550123' })
  })

  it('refuses a foreign number typed without its plus rather than dialling the wrong country', () => {
    // London, typed by a rep on a US line. Read as NANP it is a real Bermuda
    // number, so guessing here places a wrong call, not a failed one.
    expect(readEntry('442071838750', 'US')).toEqual({ status: 'invalid' })
  })

  it('refuses digits that are not a number anywhere', () => {
    expect(readEntry('9999999999', 'US')).toEqual({ status: 'invalid' })
    expect(readEntry('+99999999999999', 'US')).toEqual({ status: 'invalid' })
  })
})

describe('formatEntry', () => {
  it('formats a national number as the rep types it', () => {
    expect(formatEntry('202', 'US')).toBe('(202)')
    expect(formatEntry('202555', 'US')).toBe('(202) 555')
    expect(formatEntry('2025550123', 'US')).toBe('(202) 555-0123')
  })

  it('formats an international number in its own grouping', () => {
    expect(formatEntry('+442071838750', 'US')).toBe('+44 20 7183 8750')
  })

  it('shows plain digits when there is no country to format against', () => {
    expect(formatEntry('2025550123')).toBe('2025550123')
  })

  it('is blank for a blank entry', () => {
    expect(formatEntry('', 'US')).toBe('')
  })

  it('never changes which digits are on screen', () => {
    // A too-long entry has no format; it must still show every digit typed.
    const tooLong = '20255501234567890'
    expect(formatEntry(tooLong, 'US').replace(/\D/g, '')).toBe(tooLong)
  })
})

describe('entryMessage', () => {
  it('tells the rep to add a country code when the digits are ambiguous', () => {
    expect(entryMessage({ status: 'ambiguous' })).toBe(
      'Start with + and the country code, like +12025550123.',
    )
  })

  it('says the number cannot be called when it is not one', () => {
    expect(entryMessage({ status: 'invalid' })).toBe(
      'That is not a number we can call. Check the digits.',
    )
  })

  it('stays quiet while the number is blank, in progress, or good', () => {
    expect(entryMessage({ status: 'empty' })).toBeNull()
    expect(entryMessage({ status: 'incomplete' })).toBeNull()
    expect(entryMessage({ status: 'valid', e164: '+12025550123' })).toBeNull()
  })
})

describe('keypad layouts', () => {
  it('offers + instead of * and # while a number is being entered', () => {
    expect(ENTRY_KEYS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0'])
    expect(ENTRY_KEYS).not.toContain('*')
    expect(ENTRY_KEYS).not.toContain('#')
  })

  it('keeps * and # on a live call, where they are real tones', () => {
    expect(IN_CALL_KEYS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'])
  })
})
