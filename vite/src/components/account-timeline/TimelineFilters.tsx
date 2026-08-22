import type { AccountTimelineParams, AccountTimelineSourceType } from '@/lib/accountTimelineTypes'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface TimelineFilterOption {
  id: string
  label: string
}

export type TimelineFilterValue = Pick<AccountTimelineParams, 'sourceType' | 'personId' | 'dealId'>

const TYPE_OPTIONS: { value: AccountTimelineSourceType; label: string }[] = [
  { value: 'call', label: 'Calls' },
  { value: 'email', label: 'Emails' },
  { value: 'sms', label: 'Texts' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'note', label: 'Notes' },
  { value: 'stage_change', label: 'Stage changes' },
  { value: 'task', label: 'Tasks' },
  { value: 'record_created', label: 'Record created' },
  { value: 'custom', label: 'Custom activity' },
]

function withoutAll<T extends Record<string, string | undefined>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

/**
 * A controlled filter bar. Its owner supplies the same value to the timeline
 * query and both visualizations, preventing local feed-only filtering drift.
 */
export function TimelineFilters({
  value,
  onChange,
  people,
  deals,
  rootType = 'company',
}: {
  value: TimelineFilterValue
  onChange: (value: TimelineFilterValue) => void
  people: TimelineFilterOption[]
  deals: TimelineFilterOption[]
  rootType?: 'company' | 'deal'
}) {
  function update(next: Partial<TimelineFilterValue>) {
    onChange(withoutAll({ ...value, ...next }))
  }

  return (
    <div className="flex flex-wrap items-end gap-3" aria-label="Timeline filters">
      <FilterSelect
        label="Activity type"
        value={value.sourceType ?? 'all'}
        options={[{ id: 'all', label: 'All activity' }, ...TYPE_OPTIONS.map(({ value: id, label }) => ({ id, label }))]}
        onValueChange={(sourceType) => update({ sourceType: sourceType === 'all' ? undefined : sourceType as AccountTimelineSourceType })}
      />
      {rootType === 'company' && (
        <>
          <FilterSelect
            label="Contact"
            value={value.personId ?? 'all'}
            options={[{ id: 'all', label: 'All contacts' }, ...people]}
            onValueChange={(personId) => update({ personId: personId === 'all' ? undefined : personId })}
          />
          <FilterSelect
            label="Deal"
            value={value.dealId ?? 'all'}
            options={[{ id: 'all', label: 'All deals' }, ...deals]}
            onValueChange={(dealId) => update({ dealId: dealId === 'all' ? undefined : dealId })}
          />
        </>
      )}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string
  value: string
  options: TimelineFilterOption[]
  onValueChange: (value: string) => void
}) {
  const id = `timeline-filter-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
