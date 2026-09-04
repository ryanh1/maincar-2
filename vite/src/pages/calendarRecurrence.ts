import { format } from 'date-fns'

export type CalendarRepeatMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

export interface CalendarRepeatPreset {
  id: CalendarRepeatMode
  label: string
  recurrenceRule: string | null
  note?: string
}

const DAYS = [
  { code: 'SU', name: 'Sunday' },
  { code: 'MO', name: 'Monday' },
  { code: 'TU', name: 'Tuesday' },
  { code: 'WE', name: 'Wednesday' },
  { code: 'TH', name: 'Thursday' },
  { code: 'FR', name: 'Friday' },
  { code: 'SA', name: 'Saturday' },
] as const

const ORDINALS: Record<string, string> = {
  '1': 'first',
  '2': 'second',
  '3': 'third',
  '4': 'fourth',
  '-1': 'last',
}

function weekdayPosition(date: Date): number {
  if (date.getDate() >= 29) return -1
  return Math.ceil(date.getDate() / 7)
}

function skippedMonthsNote(day: number): string {
  if (day === 29) return 'Day 29 skips February in years without February 29.'
  if (day === 30) return 'Day 30 skips February.'
  return 'Day 31 skips February, April, June, September and November.'
}

export function calendarRepeatPresets(date: Date): CalendarRepeatPreset[] {
  const weekday = DAYS[date.getDay()]
  const position = weekdayPosition(date)
  const monthlyLabel = `Monthly on the ${ORDINALS[String(position)]} ${weekday.name}`
  const isLeapDay = date.getMonth() === 1 && date.getDate() === 29

  return [
    { id: 'none', label: 'Does not repeat', recurrenceRule: null },
    { id: 'daily', label: 'Daily', recurrenceRule: 'RRULE:FREQ=DAILY' },
    { id: 'weekly', label: `Weekly on ${weekday.name}`, recurrenceRule: `RRULE:FREQ=WEEKLY;BYDAY=${weekday.code}` },
    {
      id: 'monthly',
      label: monthlyLabel,
      recurrenceRule: `RRULE:FREQ=MONTHLY;BYDAY=${weekday.code};BYSETPOS=${position}`,
      ...(date.getDate() >= 29
        ? { note: skippedMonthsNote(date.getDate()) }
        : {}),
    },
    {
      id: 'yearly',
      label: isLeapDay ? 'Yearly on February 29' : 'Yearly',
      recurrenceRule: `RRULE:FREQ=YEARLY;BYMONTH=${date.getMonth() + 1};BYMONTHDAY=${date.getDate()}`,
      ...(isLeapDay
        ? { note: "Your calendar provider decides when this repeats in years without February 29." }
        : {}),
    },
    { id: 'custom', label: 'Custom', recurrenceRule: null },
  ]
}

function ruleEntries(rule: string): Record<string, string> {
  return Object.fromEntries(rule.replace(/^RRULE:/i, '').split(';').flatMap((part) => {
    const separator = part.indexOf('=')
    return separator > 0 ? [[part.slice(0, separator).toUpperCase(), part.slice(separator + 1)]] : []
  }))
}

function weekdayNames(value: string | undefined): string[] {
  if (!value) return []
  return value.split(',').flatMap((code) => {
    const normalized = code.replace(/^[+-]?\d+/, '').toUpperCase()
    const day = DAYS.find((candidate) => candidate.code === normalized)
    return day ? [day.name] : []
  })
}

function untilDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : format(date, 'MMM d, yyyy')
}

function summaryEnding(entries: Record<string, string>): string {
  const until = entries.UNTIL ? untilDate(entries.UNTIL) : null
  if (until) return `, until ${until}`
  const count = Number(entries.COUNT)
  if (Number.isInteger(count) && count > 0) return `, ${count} ${count === 1 ? 'time' : 'times'}`
  return ''
}

export function recurrenceSummary(rule: string | null | undefined): string {
  if (!rule) return 'Does not repeat'
  const entries = ruleEntries(rule)
  const frequency = entries.FREQ?.toUpperCase()
  const interval = Math.max(1, Number(entries.INTERVAL) || 1)
  const days = weekdayNames(entries.BYDAY)
  let summary: string

  if (frequency === 'DAILY') {
    summary = interval === 1 ? 'Daily' : `Every ${interval} days`
  } else if (frequency === 'WEEKLY') {
    const cadence = interval === 1 ? 'Weekly' : `Every ${interval} weeks`
    summary = days.length ? `${cadence} on ${days.join(', ')}` : cadence
  } else if (frequency === 'MONTHLY') {
    const position = ORDINALS[entries.BYSETPOS]
    if (position && days[0]) summary = `Monthly on the ${position} ${days[0]}`
    else if (entries.BYMONTHDAY) summary = `Monthly on day ${entries.BYMONTHDAY}`
    else summary = interval === 1 ? 'Monthly' : `Every ${interval} months`
  } else if (frequency === 'YEARLY') {
    const month = Number(entries.BYMONTH)
    const day = Number(entries.BYMONTHDAY)
    const validDate = new Date(2028, month - 1, day)
    summary = month >= 1 && month <= 12
      && validDate.getMonth() === month - 1
      && validDate.getDate() === day
      ? `Yearly on ${format(validDate, 'MMMM d')}`
      : 'Yearly'
  } else {
    return 'Custom repeat'
  }

  return `${summary}${summaryEnding(entries)}`
}
