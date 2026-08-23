import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onValueChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

/**
 * A free-form tag input: type a value and press Enter or comma to add it, click
 * the × on a chip to remove it. Used for the Capture settings' domain, address,
 * and subject lists, where the values are open-ended rather than a fixed option
 * set (which is what SelectedValuesPicker is for).
 */
export function TagInput({ value, onValueChange, placeholder, disabled, id, 'aria-label': ariaLabel }: TagInputProps) {
  const [draft, setDraft] = useState('')

  function commit(): void {
    const next = draft.trim()
    if (!next) return
    if (!value.includes(next)) onValueChange([...value, next])
    setDraft('')
  }

  function remove(target: string): void {
    onValueChange(value.filter((item) => item !== target))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-bg px-2 py-1',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {value.map((item) => (
        <span
          key={item}
          className="flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-xs text-text"
        >
          {item}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${item}`}
              className="text-text-muted hover:text-text"
              onClick={() => remove(item)}
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          id={id}
          aria-label={ariaLabel}
          className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
          value={draft}
          placeholder={value.length === 0 ? placeholder : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      )}
    </div>
  )
}
