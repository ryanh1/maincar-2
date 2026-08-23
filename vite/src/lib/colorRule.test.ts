import { describe, expect, it } from 'vitest'

import type { ColorRule } from '@/hooks/colorRules'
import { colorRuleThemeOverride, evaluateColorRule, matchColorRule } from './colorRule'

const TODAY = new Date('2026-08-23T12:00:00.000Z')

function rule(overrides: Partial<ColorRule> = {}): ColorRule {
  return {
    id: 'rule-1',
    viewId: 'view-1',
    attribute: 'attr-date',
    predicate: { op: 'before_today' },
    target: 'background',
    scope: 'cell',
    color: 'option-5',
    sortOrder: 0,
    isDefault: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('evaluateColorRule', () => {
  it('matches a date before today', () => {
    expect(evaluateColorRule({ op: 'before_today' }, '2026-08-20', TODAY)).toBe(true)
    expect(evaluateColorRule({ op: 'before_today' }, '2026-08-23', TODAY)).toBe(false)
  })

  it('matches a date today', () => {
    expect(evaluateColorRule({ op: 'is_today' }, '2026-08-23', TODAY)).toBe(true)
    expect(evaluateColorRule({ op: 'is_today' }, '2026-08-24', TODAY)).toBe(false)
  })

  it('matches a date after today', () => {
    expect(evaluateColorRule({ op: 'after_today' }, '2026-08-25', TODAY)).toBe(true)
    expect(evaluateColorRule({ op: 'after_today' }, '2026-08-23', TODAY)).toBe(false)
  })

  it('compares equality, greater-than, and less-than', () => {
    expect(evaluateColorRule({ op: 'eq', value: 'At risk' }, 'At risk', TODAY)).toBe(true)
    expect(evaluateColorRule({ op: 'eq', value: 'At risk' }, 'Won', TODAY)).toBe(false)
    expect(evaluateColorRule({ op: 'gt', value: 100 }, 150, TODAY)).toBe(true)
    expect(evaluateColorRule({ op: 'lt', value: 100 }, 50, TODAY)).toBe(true)
  })

  it('treats an empty value as non-matching for today-relative ops', () => {
    expect(evaluateColorRule({ op: 'before_today' }, null, TODAY)).toBe(false)
    expect(evaluateColorRule({ op: 'is_today' }, '', TODAY)).toBe(false)
  })
})

describe('matchColorRule', () => {
  it('returns the first enabled matching rule in order', () => {
    const rules = [
      rule({ id: 'a', predicate: { op: 'eq', value: 'x' }, enabled: false }),
      rule({ id: 'b', predicate: { op: 'eq', value: 'x' }, enabled: true }),
      rule({ id: 'c', predicate: { op: 'eq', value: 'x' }, enabled: true }),
    ]
    expect(matchColorRule(rules, 'x', TODAY)?.id).toBe('b')
  })

  it('skips disabled rules and returns null when nothing matches', () => {
    const rules = [rule({ predicate: { op: 'eq', value: 'x' }, enabled: false })]
    expect(matchColorRule(rules, 'x', TODAY)).toBeNull()
  })
})

describe('colorRuleThemeOverride', () => {
  const colors = { 'option-5': '#be123c', 'option-6': '#b45309' }

  it('maps a background target to bgCell', () => {
    expect(colorRuleThemeOverride(rule({ target: 'background', color: 'option-5' }), colors)).toEqual({ bgCell: '#be123c' })
  })

  it('maps a text target to textDark', () => {
    expect(colorRuleThemeOverride(rule({ target: 'text', color: 'option-6' }), colors)).toEqual({ textDark: '#b45309' })
  })

  it('contributes nothing for a dot target (drawn separately)', () => {
    expect(colorRuleThemeOverride(rule({ target: 'dot', color: 'option-5' }), colors)).toEqual({})
  })
})
