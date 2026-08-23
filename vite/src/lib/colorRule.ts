import type { ColorRule, ColorRulePredicate } from '@/hooks/colorRules'

// The client-side evaluation of a conditional-formatting rule (SPEC-CHUNK-2
// J2.5 §C). The server stores and validates the predicate; the grid evaluates it
// per cell to decide the themeOverride. First enabled match wins, so callers
// iterate rules in sortOrder and stop at the first match.

function dayNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Math.floor(value.getTime() / 86_400_000)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return null
    return Math.floor(parsed / 86_400_000)
  }
  if (typeof value === 'number') return Math.floor(value / 86_400_000)
  return null
}

function todayNumber(today: Date): number {
  return Math.floor(today.getTime() / 86_400_000)
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function compareValues(value: unknown, expected: unknown): number {
  const valueNumber = numericValue(value)
  const expectedNumber = numericValue(expected)
  if (valueNumber !== null && expectedNumber !== null) return valueNumber - expectedNumber
  const valueDay = dayNumber(value)
  const expectedDay = dayNumber(expected)
  if (valueDay !== null && expectedDay !== null) return valueDay - expectedDay
  return String(value ?? '') < String(expected ?? '') ? -1 : String(value ?? '') > String(expected ?? '') ? 1 : 0
}

/** True when the cell value satisfies the rule's predicate. */
export function evaluateColorRule(predicate: ColorRulePredicate, value: unknown, today: Date = new Date()): boolean {
  switch (predicate.op) {
    case 'before_today': {
      const day = dayNumber(value)
      return day !== null && day < todayNumber(today)
    }
    case 'is_today': {
      const day = dayNumber(value)
      return day !== null && day === todayNumber(today)
    }
    case 'after_today': {
      const day = dayNumber(value)
      return day !== null && day > todayNumber(today)
    }
    case 'eq':
      return compareValues(value, predicate.value) === 0
    case 'gt':
      return compareValues(value, predicate.value) > 0
    case 'lt':
      return compareValues(value, predicate.value) < 0
  }
}

/** The first enabled rule (in sortOrder) whose predicate matches, or null. */
export function matchColorRule(rules: ColorRule[], value: unknown, today: Date = new Date()): ColorRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (evaluateColorRule(rule.predicate, value, today)) return rule
  }
  return null
}

// The muted palette token name → resolved hex, mirroring useGridColors.paintColors.
export type PaintColorMap = Record<string, string>

/** The themeOverride a matched rule contributes for its target channel. */
export function colorRuleThemeOverride(rule: ColorRule, colors: PaintColorMap): { bgCell?: string; textDark?: string } {
  const color = colors[rule.color] ?? rule.color
  if (rule.target === 'background') return { bgCell: color }
  if (rule.target === 'text') return { textDark: color }
  return {}
}
