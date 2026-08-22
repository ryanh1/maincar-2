import type { ProvideEditorComponent } from '@glideapps/glide-data-grid'

import type { ChipCell } from './chipCell'

/** The dropdown `chipCellRenderer.provideEditor` opens on click (DECISIONS D4). */
export const ChipCellEditor: ProvideEditorComponent<ChipCell> = (props) => {
  const { value, onChange, onFinishedEditing } = props
  const { options, selectedValues, isMulti, cellReadonly } = value.data

  function selectOption(optionValue: string) {
    if (cellReadonly) return
    const next = isMulti
      ? selectedValues.includes(optionValue)
        ? selectedValues.filter((existing) => existing !== optionValue)
        : [...selectedValues, optionValue]
      : [optionValue]
    const nextCell: ChipCell = { ...value, data: { ...value.data, selectedValues: next } }
    onChange(nextCell)
    if (!isMulti) onFinishedEditing(nextCell)
  }

  return (
    <div className="min-w-40 rounded-md border border-border bg-popover p-1 shadow-md" role="listbox">
      {options
        .filter((option) => !option.isArchived)
        .map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selectedValues.includes(option.value)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onClick={() => selectOption(option.value)}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: option.color ?? 'var(--muted-foreground)' }}
            />
            <span className="truncate">{option.label}</span>
            {selectedValues.includes(option.value) && <span className="ml-auto text-xs">✓</span>}
          </button>
        ))}
    </div>
  )
}
