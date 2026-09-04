import { useState, type RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  calendarRepeatPresets,
  createCustomRepeatDraft,
  customRepeatRule,
  customRepeatSummary,
  rruleError,
  type CustomRepeatDraft,
  type RRuleFrequency,
} from './calendarRecurrence'

const WEEKDAYS = [
  { code: 'SU', short: 'S', name: 'Sunday' },
  { code: 'MO', short: 'M', name: 'Monday' },
  { code: 'TU', short: 'T', name: 'Tuesday' },
  { code: 'WE', short: 'W', name: 'Wednesday' },
  { code: 'TH', short: 'T', name: 'Thursday' },
  { code: 'FR', short: 'F', name: 'Friday' },
  { code: 'SA', short: 'S', name: 'Saturday' },
] as const

const FREQUENCIES: Array<{ value: RRuleFrequency; singular: string; plural: string }> = [
  { value: 'DAILY', singular: 'day', plural: 'days' },
  { value: 'WEEKLY', singular: 'week', plural: 'weeks' },
  { value: 'MONTHLY', singular: 'month', plural: 'months' },
  { value: 'YEARLY', singular: 'year', plural: 'years' },
]

interface CustomRepeatDialogProps {
  date: Date
  recurrenceRule: string
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onSave: (rule: string) => void
}

export function CalendarWorkspace_CustomRepeatDialog({
  date,
  recurrenceRule,
  returnFocusRef,
  onCancel,
  onSave,
}: CustomRepeatDialogProps) {
  const [draft, setDraft] = useState(() => createCustomRepeatDraft(date, recurrenceRule))
  const update = (patch: Partial<CustomRepeatDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const error = rruleError(draft, date)
  const summary = customRepeatSummary(draft, date)
  const interval = Number(draft.interval)
  const frequency = FREQUENCIES.find((item) => item.value === draft.frequency) ?? FREQUENCIES[1]
  const frequencyLabel = interval === 1 ? frequency.singular : frequency.plural
  const monthlyWeekdayValue = calendarRepeatPresets(date)[3].label.replace(/^Monthly on /, '')
  const monthlyWeekday = `${monthlyWeekdayValue[0].toUpperCase()}${monthlyWeekdayValue.slice(1)}`

  const toggleWeekday = (code: string) => {
    update({
      daysOfWeek: draft.daysOfWeek.includes(code)
        ? draft.daysOfWeek.filter((day) => day !== code)
        : [...draft.daysOfWeek, code],
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <DialogHeader><DialogTitle>Custom repeat</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="custom-repeat-interval">Repeat every</Label>
              <Input
                id="custom-repeat-interval"
                aria-label="Repeat interval"
                className="h-8 tabular-nums"
                type="number"
                min={1}
                max={999}
                value={draft.interval}
                onChange={(event) => update({ interval: event.target.value })}
              />
            </div>
            <Select value={draft.frequency} onValueChange={(value) => update({ frequency: value as RRuleFrequency })}>
              <SelectTrigger size="sm" className="w-32" aria-label="Repeat frequency"><SelectValue>{frequencyLabel}</SelectValue></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((item) => <SelectItem key={item.value} value={item.value}>{interval === 1 ? item.singular : item.plural}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {draft.frequency === 'WEEKLY' ? (
            <div className="flex flex-col gap-1">
              <Label>Repeat on</Label>
              <div className="flex justify-between gap-1" role="group" aria-label="Weekdays">
                {WEEKDAYS.map((day) => {
                  const selected = draft.daysOfWeek.includes(day.code)
                  return (
                    <Button
                      key={day.code}
                      type="button"
                      size="icon-sm"
                      variant={selected ? 'default' : 'secondary'}
                      className="rounded-full p-0"
                      aria-label={day.name}
                      aria-pressed={selected}
                      onClick={() => toggleWeekday(day.code)}
                    >
                      {day.short}
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {draft.frequency === 'MONTHLY' ? (
            <div className="flex flex-col gap-1">
              <Label>Repeat on</Label>
              <RadioGroup value={draft.monthlyMode} onValueChange={(value) => update({ monthlyMode: value as CustomRepeatDraft['monthlyMode'] })}>
                <Label className="font-normal"><RadioGroupItem value="month-day" />Day {date.getDate()} of the month</Label>
                <Label className="font-normal"><RadioGroupItem value="weekday" />{monthlyWeekday}</Label>
              </RadioGroup>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label>Ends</Label>
            <RadioGroup value={draft.endMode} onValueChange={(value) => update({ endMode: value as CustomRepeatDraft['endMode'] })}>
              <Label className="font-normal"><RadioGroupItem value="never" />Never</Label>
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <Label className="font-normal"><RadioGroupItem value="on" />On</Label>
                <DatePicker
                  value={draft.endDate instanceof Date ? draft.endDate : undefined}
                  onChange={(endDate) => update({ endDate })}
                  ariaLabel="Repeat until"
                  disabled={draft.endMode !== 'on'}
                />
              </div>
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <Label className="font-normal"><RadioGroupItem value="after" />After</Label>
                <Input
                  aria-label="Number of occurrences"
                  className="h-8 tabular-nums"
                  type="number"
                  min={1}
                  max={999}
                  value={draft.count}
                  disabled={draft.endMode !== 'after'}
                  onChange={(event) => update({ count: event.target.value })}
                />
              </div>
            </RadioGroup>
          </div>

          <p className="text-[13px] font-medium" aria-live="polite">{summary}</p>
          {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" disabled={!!error} onClick={() => onSave(customRepeatRule(draft, date))}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
