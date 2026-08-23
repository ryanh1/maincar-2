import { useRef, useState } from 'react'
import { NumericFormat } from 'react-number-format'

import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetObject, useListRecords } from '@/hooks/crm'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import { formatEntry } from '@/lib/dialPad'
import { formatTimeZoneName, zonedDateTimeParts, zonedDateTimeToIso } from '@/lib/datetime'
import type { AttributeDef } from '@/lib/crmTypes'
import { coerceCurrency, coerceNumber } from './cellCoercion'
import { coerceForType, parseOptions } from './cellBuilder'
import { parseGridCommand } from './gridCommands'

interface FieldValueEditorProps {
  orgId: string
  attribute: AttributeDef
  value: unknown
  timeZone: string | null | undefined
  onCommit: (value: unknown) => void
  onCancel: () => void
  onTabNext?: () => void
}

function draftValue(value: unknown, attribute: AttributeDef): string {
  if (value === null || value === undefined) return ''
  if (attribute.type === 'currency' && attribute.slug === 'amountMinor') {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) ? String(amount / 100) : String(value)
  }
  if (attribute.type === 'phone' && typeof value === 'string') return formatEntry(value)
  return String(value)
}

/**
 * One editor vocabulary for a record field, shared by the grid overlay and the
 * record drawer. It keeps an invalid draft on screen and names the correction
 * instead of handing an unparseable value to the server or silently clearing it.
 */
export function FieldValueEditor({ orgId, attribute, value, timeZone, onCommit, onCancel, onTabNext }: FieldValueEditorProps) {
  const [draft, setDraft] = useState(() => draftValue(value, attribute))
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const [selectedValues, setSelectedValues] = useState<string[]>(() =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : [],
  )

  function commitText(): boolean {
    const result =
      attribute.type === 'currency'
        ? coerceCurrency(draft)
        : attribute.type === 'number' || attribute.type === 'rating'
          ? coerceNumber(draft)
          : coerceForType(attribute, draft, value)
    if (!result.ok || (attribute.type === 'currency' && attribute.slug === 'amountMinor' && typeof result.value === 'number' && !Number.isInteger(result.value * 100))) {
      setError(
        attribute.type === 'currency' && attribute.slug === 'amountMinor' && typeof result.value === 'number' && !Number.isInteger(result.value * 100)
          ? 'Enter an amount with no more than two decimal places.'
          : attribute.type === 'currency'
            ? 'Enter a valid amount.'
          : result.reason ?? `Enter a valid ${attribute.name.toLowerCase()}.`,
      )
      return false
    }
    setError(null)
    onCommit(attribute.type === 'currency' && attribute.slug === 'amountMinor' && typeof result.value === 'number' ? result.value * 100 : result.value)
    return true
  }

  function commitOnBlur() {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    commitText()
  }

  if (attribute.type === 'select' || attribute.type === 'status') {
    return <StatusEditor attribute={attribute} value={selectedValues[0] ?? ''} onCommit={onCommit} />
  }

  if (attribute.type === 'multiselect') {
    const options = parseOptions(attribute.optionsJson).filter((option) => !option.isArchived)
    return (
      <div className="flex flex-col gap-2" role="group" aria-label={attribute.name}>
        {options.map((option) => {
          const checked = selectedValues.includes(option.value)
          return (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(next) => {
                  const updated = next === true ? [...selectedValues, option.value] : selectedValues.filter((entry) => entry !== option.value)
                  onCommit(updated)
                  setSelectedValues(updated)
                }}
              />
              {option.label}
            </label>
          )
        })}
      </div>
    )
  }

  if (attribute.type === 'record_reference') {
    return <RecordReferencePicker orgId={orgId} attribute={attribute} onCommit={onCommit} />
  }

  if (attribute.type === 'user_reference') {
    return <UserReferencePicker orgId={orgId} attribute={attribute} onCommit={onCommit} />
  }

  if (attribute.type === 'date') {
    return <DateEditor attribute={attribute} value={draft} onCommit={onCommit} />
  }

  if (attribute.type === 'timestamp') {
    return <TimestampEditor attribute={attribute} value={draft} timeZone={timeZone} onCommit={onCommit} />
  }

  if (attribute.type === 'checkbox') {
    return (
      <label className="flex h-8 items-center gap-2 text-sm">
        <Checkbox
          aria-label={attribute.name}
          checked={value === true}
          onCheckedChange={(next) => onCommit(next === true)}
        />
        {attribute.name}
      </label>
    )
  }

  if (attribute.type === 'number' || attribute.type === 'currency' || attribute.type === 'rating') {
    return (
      <div className="flex flex-col gap-1">
        <NumericFormat
          autoFocus
          aria-label={attribute.name}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${attribute.id}-edit-error` : undefined}
          customInput={Input}
          className="h-8"
          decimalScale={attribute.type === 'currency' ? 2 : undefined}
          inputMode="decimal"
          thousandSeparator
          value={draft}
          onValueChange={({ value: nextDraft }) => {
            setDraft(nextDraft)
            setError(null)
          }}
          onBlur={commitOnBlur}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitText()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelled.current = true
              onCancel()
            }
          }}
        />
        {error && <p id={`${attribute.id}-edit-error`} role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    )
  }

  const errorId = `${attribute.id}-edit-error`
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        className="h-8"
        aria-label={attribute.name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        onChange={(event) => {
          setDraft(attribute.type === 'phone' ? formatEntry(event.target.value) : event.target.value)
          setError(null)
        }}
        onBlur={commitOnBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitText()
          }
          if (event.key === 'Tab' && onTabNext) {
            event.preventDefault()
            if (commitText()) onTabNext()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelled.current = true
            onCancel()
          }
        }}
      />
      {error && <p id={errorId} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function StatusEditor({ attribute, value, onCommit }: Pick<FieldValueEditorProps, 'attribute' | 'onCommit'> & { value: string }) {
  const [open, setOpen] = useState(false)
  const options = parseOptions(attribute.optionsJson).filter((option) => !option.isArchived)
  return (
    <Select value={value} open={open} onOpenChange={setOpen} onValueChange={(next) => onCommit(next || null)}>
      <SelectTrigger
        className="h-8 w-full"
        aria-label={attribute.name}
        onKeyDown={(event) => {
          if (event.key === '@') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <SelectValue placeholder={`Choose ${attribute.name}`} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function dateOnlyToLocal(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function localDateOnly(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function DateEditor({ attribute, value, onCommit }: Pick<FieldValueEditorProps, 'attribute' | 'onCommit'> & { value: string }) {
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selected = dateOnlyToLocal(value)

  function commitCommand() {
    const result = parseGridCommand(command, { type: 'date' })
    if (result.kind === 'value') {
      setError(null)
      onCommit(result.value)
      return
    }
    setError('Use @date followed by a date, for example “@date next tue”.')
  }

  return (
    <div className="flex flex-col gap-1">
      <DatePicker
        value={selected}
        onChange={(next) => onCommit(next ? localDateOnly(next) : null)}
        ariaLabel={attribute.name}
        placeholder={`Choose ${attribute.name}`}
      />
      <Input
        aria-label={`Set ${attribute.name} with @date`}
        placeholder="@date tomorrow"
        value={command}
        onChange={(event) => {
          setCommand(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commitCommand()
        }}
        className="h-8"
        aria-invalid={error ? 'true' : undefined}
      />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function TimestampEditor({ attribute, value, timeZone, onCommit }: Pick<FieldValueEditorProps, 'attribute' | 'timeZone' | 'onCommit'> & { value: string }) {
  const initial = zonedDateTimeParts(value, timeZone)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [error, setError] = useState<string | null>(null)

  function commit(nextDate = date, nextTime = time) {
    if (!nextDate) return
    const timestamp = zonedDateTimeToIso(nextDate, nextTime, timeZone)
    if (!timestamp) {
      setError(`Enter a time from 00:00 to 23:59 ${formatTimeZoneName(nextDate, timeZone)}.`)
      return
    }
    setError(null)
    onCommit(timestamp)
  }

  return (
    <div className="flex flex-col gap-1">
      <DatePicker
        value={date}
        onChange={(next) => {
          setDate(next)
          if (!next) onCommit(null)
        }}
        ariaLabel={attribute.name}
        placeholder={`Choose ${attribute.name}`}
      />
      <Input
        className="h-8"
        aria-label={`${attribute.name} time (${formatTimeZoneName(date ?? new Date(), timeZone)})`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${attribute.id}-edit-error` : undefined}
        type="time"
        value={time}
        onChange={(event) => {
          setTime(event.target.value)
          setError(null)
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
      {error && <p id={`${attribute.id}-edit-error`} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function RecordReferencePicker({ orgId, attribute, onCommit }: Pick<FieldValueEditorProps, 'orgId' | 'attribute' | 'onCommit'>) {
  const targetObject = useGetObject(orgId, attribute.refObjectId)
  const targetRows = useListRecords(orgId, attribute.refObjectId)
  const identity = targetObject.data?.object.attributes.find((candidate) => candidate.isIdentity) ?? targetObject.data?.object.attributes[0]
  const rows = targetRows.data?.pages.flatMap((page) => page.rows) ?? []
  return (
    <ReferencePicker
      attribute={attribute}
      loading={targetObject.isPending || targetRows.isPending}
      options={rows.map((row) => ({ id: row.id, label: identity ? String(row[identity.slug] ?? row.id) : row.id }))}
      onCommit={onCommit}
    />
  )
}

function UserReferencePicker({ orgId, attribute, onCommit }: Pick<FieldValueEditorProps, 'orgId' | 'attribute' | 'onCommit'>) {
  const members = useGetMembers(orgId, { limit: 200, sort: 'name' })
  return (
    <ReferencePicker
      attribute={attribute}
      loading={members.isPending}
      options={(members.data?.members ?? []).map((member) => ({ id: member.userId, label: memberDisplayName(member) }))}
      onCommit={onCommit}
    />
  )
}

function ReferencePicker({ attribute, loading, options, onCommit }: {
  attribute: AttributeDef
  loading: boolean
  options: Array<{ id: string; label: string }>
  onCommit: (value: unknown) => void
}) {
  if (loading) return <p className="text-sm text-text-muted">Loading choices…</p>
  if (options.length === 0) return <p className="text-sm text-text-muted">No {attribute.name.toLowerCase()} choices are available.</p>
  return (
    <div className="flex flex-col gap-1" role="listbox" aria-label={attribute.name}>
      {options.map((option) => (
        <Button key={option.id} type="button" role="option" variant="ghost" size="sm" className="justify-start" onClick={() => onCommit(option.id)}>
          {option.label}
        </Button>
      ))}
    </div>
  )
}
