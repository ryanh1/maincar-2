import { describe, expect, it } from 'vitest'

import {
  calendarRepeatPresets,
  createCustomRepeatDraft,
  customRepeatRule,
  customRepeatSummary,
  recurrenceSummary,
  rruleError,
} from './calendarRecurrence'

describe('calendar recurrence presets', () => {
  it('computes all six presets from the event date', () => {
    expect(calendarRepeatPresets(new Date(2026, 8, 3)).map((preset) => preset.label)).toEqual([
      'Does not repeat',
      'Daily',
      'Weekly on Thursday',
      'Monthly on the first Thursday',
      'Yearly',
      'Custom',
    ])

    expect(calendarRepeatPresets(new Date(2026, 8, 4)).map((preset) => preset.label)).toEqual([
      'Does not repeat',
      'Daily',
      'Weekly on Friday',
      'Monthly on the first Friday',
      'Yearly',
      'Custom',
    ])
  })

  it('uses the last weekday form on the 31st and names skipped months', () => {
    const monthly = calendarRepeatPresets(new Date(2026, 11, 31))[3]

    expect(monthly.label).toBe('Monthly on the last Thursday')
    expect(monthly.note).toBe('Day 31 skips February, April, June, September and November.')
    expect(monthly.recurrenceRule).toBe('RRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=-1')
  })

  it('states the provider-owned leap-year fallback before Feb 29 yearly is chosen', () => {
    const yearly = calendarRepeatPresets(new Date(2028, 1, 29))[4]

    expect(yearly.label).toBe('Yearly on February 29')
    expect(yearly.note).toBe("Your calendar provider decides when this repeats in years without February 29.")
  })
})

describe('recurrenceSummary', () => {
  it('reads a weekly rule and its end date as one sentence', () => {
    const summary = recurrenceSummary('RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261123')

    expect(summary).toBe('Weekly on Thursday, until Nov 23, 2026')
  })

  it('reads a custom interval, weekdays and count without using the event date', () => {
    const summary = recurrenceSummary('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=13')

    expect(summary).toBe('Every 2 weeks on Tuesday, Thursday, 13 times')
  })
})

describe('custom recurrence rules', () => {
  const startsOn = new Date(2026, 8, 3)

  it.each(['0', '', '1000'])('rejects the interval %j without coercing the draft', (interval) => {
    const draft = { ...createCustomRepeatDraft(startsOn), interval }

    expect(rruleError(draft, startsOn)).toBe('Choose a number from 1 to 999.')
    expect(draft.interval).toBe(interval)
    expect(draft.interval).not.toBe('NaN')
  })

  it.each(['1', '999'])('accepts the interval boundary %s', (interval) => {
    expect(rruleError({ ...createCustomRepeatDraft(startsOn), interval }, startsOn)).toBeNull()
  })

  it('requires at least one weekday for a weekly rule', () => {
    const draft = { ...createCustomRepeatDraft(startsOn), daysOfWeek: [] }

    expect(rruleError(draft, startsOn)).toBe('Choose at least one weekday.')
    expect(rruleError({ ...draft, daysOfWeek: ['TH'] }, startsOn)).toBeNull()
  })

  it.each(['0', '1000'])('rejects the occurrence count %s without changing it', (count) => {
    const draft = { ...createCustomRepeatDraft(startsOn), endMode: 'after' as const, count }

    expect(rruleError(draft, startsOn)).toBe('Choose 1 to 999 times.')
    expect(draft.count).toBe(count)
  })

  it('rejects an end date before the event and a non-date value', () => {
    const draft = { ...createCustomRepeatDraft(startsOn), endMode: 'on' as const }

    expect(rruleError({ ...draft, endDate: new Date(2026, 8, 2) }, startsOn)).toBe('The end date must be on or after the first event.')
    expect(rruleError({ ...draft, endDate: 'not-a-date' }, startsOn)).toBe('The end date must be on or after the first event.')
    expect(rruleError({ ...draft, endDate: startsOn }, startsOn)).toBeNull()
  })

  it('sorts weekdays in week order in the live summary and saved rule', () => {
    const draft = {
      ...createCustomRepeatDraft(startsOn),
      interval: '2',
      daysOfWeek: ['TH', 'TU'],
      endMode: 'after' as const,
      count: '13',
    }

    expect(customRepeatSummary(draft, startsOn)).toBe('Every 2 weeks on Tuesday, Thursday, 13 times')
    expect(customRepeatRule(draft, startsOn)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=13')
  })

  it('seeds a saved custom rule without replacing its values with defaults', () => {
    const draft = createCustomRepeatDraft(startsOn, 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=13')

    expect(draft).toMatchObject({
      interval: '2',
      frequency: 'WEEKLY',
      daysOfWeek: ['TU', 'TH'],
      endMode: 'after',
      count: '13',
    })
  })

  it('reads custom monthly and yearly intervals as complete sentences', () => {
    const draft = createCustomRepeatDraft(startsOn)

    expect(customRepeatSummary({ ...draft, interval: '2', frequency: 'MONTHLY', monthlyMode: 'month-day' }, startsOn))
      .toBe('Every 2 months on day 3')
    expect(customRepeatSummary({ ...draft, interval: '2', frequency: 'MONTHLY', monthlyMode: 'weekday' }, startsOn))
      .toBe('Every 2 months on the first Thursday')
    expect(customRepeatSummary({ ...draft, interval: '2', frequency: 'YEARLY' }, startsOn))
      .toBe('Every 2 years on September 3')
  })
})
