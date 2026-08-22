import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AttributeDef, ObjectDef } from '@/lib/crmTypes'

interface RecordGridCreateRowProps {
  object: ObjectDef
  attributes: AttributeDef[]
  isSaving: boolean
  error: string | null
  onSave: (values: Record<string, unknown>) => void
  onCancel: () => void
}

/** A compact, identity-first draft row for grid-backed record creation. */
export function RecordGridCreateRow({ object, attributes, isSaving, error, onSave, onCancel }: RecordGridCreateRowProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const errorId = 'record-grid-create-error'

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(Object.fromEntries(
      attributes.flatMap((attribute) => {
        const value = values[attribute.slug]?.trim()
        return value ? [[attribute.slug, value]] : []
      }),
    ))
  }

  return (
    <form aria-label={`New ${object.name}`} className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg px-2 py-1" onSubmit={submit}>
      <span className="text-sm font-medium">New {object.name}</span>
      {attributes.length > 0 ? attributes.map((attribute, index) => (
        <Input
          key={attribute.id}
          autoFocus={index === 0}
          aria-label={attribute.name}
          aria-describedby={error ? errorId : undefined}
          className="h-8 min-w-48 max-w-sm"
          disabled={isSaving}
          placeholder={attribute.name}
          value={values[attribute.slug] ?? ''}
          onChange={(event) => setValues((current) => ({ ...current, [attribute.slug]: event.target.value }))}
        />
      )) : (
        <span className="text-sm text-text-muted">This record has no editable fields.</span>
      )}
      <Button type="submit" size="sm" disabled={isSaving}>{isSaving ? 'Saving' : `Save ${object.name}`}</Button>
      <Button type="button" size="sm" variant="secondary" disabled={isSaving} onClick={onCancel}>Cancel</Button>
      {error && <p id={errorId} role="alert" className="basis-full text-xs text-danger">{error}</p>}
    </form>
  )
}
