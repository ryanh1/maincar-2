import { describe, expect, it } from 'vitest'

import {
  isOptionToken,
  nextOptionToken,
  OPTION_TOKEN_HEX,
  resolveOptionColor,
  resolveOptionColorHex,
} from '../optionPalette'

describe('isOptionToken', () => {
  it('recognises the eight muted tokens', () => {
    expect(isOptionToken('option-1')).toBe(true)
    expect(isOptionToken('option-8')).toBe(true)
  })

  it('rejects hex and unknown strings', () => {
    expect(isOptionToken('#0e7490')).toBe(false)
    expect(isOptionToken('option-9')).toBe(false)
    expect(isOptionToken('')).toBe(false)
  })
})

describe('nextOptionToken', () => {
  it('returns option-1 for an empty list', () => {
    expect(nextOptionToken([])).toBe('option-1')
  })

  it('returns the first unused token', () => {
    expect(nextOptionToken([{ color: 'option-1' }, { color: 'option-2' }])).toBe('option-3')
  })

  it('ignores legacy hex and missing colors when choosing', () => {
    expect(nextOptionToken([{ color: '#0e7490' }, {}])).toBe('option-1')
  })

  it('cycles back to option-1 when all eight are used', () => {
    const all = ['option-1', 'option-2', 'option-3', 'option-4', 'option-5', 'option-6', 'option-7', 'option-8'].map((color) => ({ color }))
    expect(nextOptionToken(all)).toBe('option-1')
  })
})

describe('resolveOptionColor', () => {
  it('turns a token into a CSS var', () => {
    expect(resolveOptionColor('option-3')).toBe('var(--option-3)')
  })

  it('passes a legacy hex through unchanged', () => {
    expect(resolveOptionColor('#0e7490')).toBe('#0e7490')
  })

  it('falls back to the muted foreground when no color is set', () => {
    expect(resolveOptionColor(undefined)).toBe('var(--muted-foreground)')
  })
})

describe('resolveOptionColorHex', () => {
  it('resolves a token through the theme-aware map when provided', () => {
    expect(resolveOptionColorHex('option-1', { 'option-1': '#22d3ee' })).toBe('#22d3ee')
  })

  it('falls back to the static light-mode hex without a map', () => {
    expect(resolveOptionColorHex('option-1')).toBe(OPTION_TOKEN_HEX['option-1'])
  })

  it('passes a legacy hex through unchanged', () => {
    expect(resolveOptionColorHex('#0e7490')).toBe('#0e7490')
  })
})
