import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

export interface SelectedValueOption {
  value: string
  label: string
}

export interface SelectedValuesPreset {
  label: string
  values: string[]
}

interface SelectedValuesPickerProps {
  label: string
  options: SelectedValueOption[]
  value: string[]
  onValueChange: (value: string[]) => void
  presets?: SelectedValuesPreset[]
  disabled?: boolean
}

/** Reusable selected-values interaction for compact policy filters. */
export function SelectedValuesPicker({ label, options, value, onValueChange, presets = [], disabled = false }: SelectedValuesPickerProps) {
  const [search, setSearch] = useState('')
  const selectedValues = useMemo(() => new Set(value), [value])
  const normalizedSearch = search.trim().toLowerCase()
  const visibleOptions = useMemo(() => {
    const matchesSearch = (option: SelectedValueOption) => normalizedSearch.length === 0 || option.label.toLowerCase().includes(normalizedSearch)
    const selected = options.filter((option) => selectedValues.has(option.value) && matchesSearch(option))
    const unselected = options.filter((option) => !selectedValues.has(option.value) && matchesSearch(option))
    return [...selected, ...unselected]
  }, [normalizedSearch, options, selectedValues])

  function changeSelection(nextValues: Iterable<string>) {
    const nextSet = new Set(nextValues)
    onValueChange(options.filter((option) => nextSet.has(option.value)).map((option) => option.value))
  }

  function toggle(valueToToggle: string) {
    const nextValues = new Set(value)
    if (nextValues.has(valueToToggle)) nextValues.delete(valueToToggle)
    else nextValues.add(valueToToggle)
    changeSelection(nextValues)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm" disabled={disabled}>
          {label} ({value.length}) <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <Input className="h-8" type="search" aria-label={`Search ${label.replace(/^Select /, '').toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="Search" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => changeSelection(options.map((option) => option.value))}>Select all</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => changeSelection([])}>Clear all</Button>
        </div>
        {presets.length > 0 ? <><DropdownMenuSeparator /><div className="flex flex-wrap gap-1 px-1 py-1">{presets.map((preset) => (
          <Button key={preset.label} type="button" variant="secondary" size="sm" onClick={() => changeSelection(preset.values)}>{preset.label}</Button>
        ))}</div></> : null}
        <DropdownMenuSeparator />
        {value.length > 0 ? <DropdownMenuLabel>Selected</DropdownMenuLabel> : null}
        <div className="max-h-56 overflow-y-auto">
          {visibleOptions.map((option) => (
            <DropdownMenuCheckboxItem key={option.value} checked={selectedValues.has(option.value)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => toggle(option.value)}>
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
