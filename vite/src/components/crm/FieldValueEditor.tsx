import { useRef, useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetObject, useListRecords } from '@/hooks/crm'
import { memberDisplayName, useGetMembers } from '@/hooks/orgs'
import { formatDate } from '@/lib/datetime'
import type { AttributeDef } from '@/lib/crmTypes'
import { coerceCurrency, coerceNumber } from './cellCoercion'
import { coerceForType, parseOptions } from './cellBuilder'

interface FieldValueEditorProps {
  orgId: string
  attribute: AttributeDef
  value: unknown
  timeZone: string | null | undefined
  onCommit: (value: unknown) => void
  onCancel: () => void
}

function draftValue(value: unknown, attribute: AttributeDef): string {
  if (value === null || value === undefined) return ''
  if (attribute.type === 'currency' && attribute.slug === 'amountMinor') {
    const amount = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(amount) ? String(amount / 100) : String(value)
  }
  return String(value)
}

/**
 * One editor vocabulary for a record field, shared by the grid overlay and the
 * record drawer. It keeps an invalid draft on screen and names the correction
 * instead of handing an unparseable value to the server or silently clearing it.
 */
export function FieldValueEditor({ orgId, attribute, value, timeZone, onCommit, onCancel }: FieldValueEditorProps) {
  const [draft, setDraft] = useState(() => draftValue(value, attribute))
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const [selectedValues, setSelectedValues] = useState<string[]>(() =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : [],
  )

  function commitText() {
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
      return
    }
    setError(null)
    onCommit(attribute.type === 'currency' && attribute.slug === 'amountMinor' && typeof result.value === 'number' ? result.value * 100 : result.value)
  }

  if (attribute.type === 'select' || attribute.type === 'status') {
    const options = parseOptions(attribute.optionsJson).filter((option) => !option.isArchived)
    return (
      <Select value={selectedValues[0] ?? ''} onValueChange={(next) => onCommit(next || null)}>
        <SelectTrigger className="h-8 w-full" aria-label={attribute.name}>
          <SelectValue placeholder={`Choose ${attribute.name}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    )
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
                onCheckedChange={(next) => setSelectedValues((current) => next === true ? [...current, option.value] : current.filter((entry) => entry !== option.value))}
              />
              {option.label}
            </label>
          )
        })}
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => onCommit(selectedValues)}>
          Save {attribute.name}
        </Button>
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
    return <DateEditor attribute={attribute} value={draft} timeZone={timeZone} onCommit={onCommit} />
  }

  const errorId = `${attribute.id}-edit-error`
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        aria-label={attribute.type === 'timestamp' ? `${attribute.name} (UTC)` : attribute.name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        inputMode={attribute.type === 'currency' || attribute.type === 'number' || attribute.type === 'rating' ? 'decimal' : undefined}
        placeholder={attribute.type === 'timestamp' ? 'YYYY-MM-DDTHH:MM:SSZ (UTC)' : undefined}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false
            return
          }
          commitText()
        }}
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
      {error && <p id={errorId} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
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

function DateEditor({ attribute, value, timeZone, onCommit }: Pick<FieldValueEditorProps, 'attribute' | 'timeZone' | 'onCommit'> & { value: string }) {
  const [open, setOpen] = useState(false)
  const selected = dateOnlyToLocal(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="w-full justify-start" aria-label={attribute.name}>
          {selected ? formatDate(value, timeZone) : `Choose ${attribute.name}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(next) => {
            if (!next) return
            onCommit(localDateOnly(next))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
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
