import { describe, expect, it } from 'vitest'

import { calendarRepeatPresets, recurrenceSummary } from './calendarRecurrence'

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
