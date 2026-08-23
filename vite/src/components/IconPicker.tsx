import { useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { dynamicIconImports } from 'lucide-react/dynamic'
import type { IconName } from 'lucide-react/dynamic'

import { RecordTypeIcon } from '@/components/RecordTypeIcon'
import { normalizeRecordTypeIconName } from '@/components/recordTypeIcons'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface IconAssignment {
  icon: string | null
  objectName: string
}

interface IconPickerProps {
  value: string | null
  onValueChange: (icon: string) => void
  assignments?: IconAssignment[]
  disabled?: boolean
}

const POPULAR_ICONS: IconName[] = [
  'user',
  'users',
  'building-2',
  'circle-dollar-sign',
  'phone',
  'mail',
  'message-square',
  'calendar-clock',
  'square-check',
  'sticky-note',
  'briefcase-business',
  'folder',
  'package',
  'rocket',
  'shopping-cart',
  'ticket',
  'wrench',
]

const ALL_ICONS = (Object.keys(dynamicIconImports) as IconName[]).sort()
const RESULT_LIMIT = 60

function iconLabel(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizedSearch(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

export function IconPicker({ value, onValueChange, assignments = [], disabled = false }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedName = normalizeRecordTypeIconName(value)

  const assignedByIcon = useMemo(() => {
    const result = new Map<IconName, string[]>()
    for (const assignment of assignments) {
      const name = normalizeRecordTypeIconName(assignment.icon)
      if (!name) continue
      result.set(name, [...(result.get(name) ?? []), assignment.objectName])
    }
    return result
  }, [assignments])

  const visibleIcons = useMemo(() => {
    const query = normalizedSearch(search)
    if (query) {
      return ALL_ICONS.filter((name) => name.includes(query) || iconLabel(name).toLowerCase().includes(search.trim().toLowerCase())).slice(0, RESULT_LIMIT)
    }
    return Array.from(new Set([...(selectedName ? [selectedName] : []), ...POPULAR_ICONS]))
  }, [search, selectedName])

  function select(name: IconName) {
    onValueChange(name)
    setOpen(false)
    setSearch('')
  }

  const triggerLabel = selectedName ? iconLabel(selectedName) : 'Choose an icon'

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setSearch('') }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          role="combobox"
          aria-label="Icon"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between"
        >
          <span className="flex min-w-0 items-center gap-2">
            <RecordTypeIcon icon={selectedName} aria-hidden />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronDown size={16} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false} label="Search icons">
          <CommandInput
            aria-label="Search icons"
            placeholder="Search icons"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No icons found.</CommandEmpty>
            <CommandGroup>
              {visibleIcons.map((name) => {
                const isSelected = name === selectedName
                const usedBy = assignedByIcon.get(name) ?? []
                const state = [isSelected ? 'selected' : null, usedBy.length > 0 ? `used by ${usedBy.join(', ')}` : null].filter(Boolean).join(', ')
                const accessibleLabel = state ? `${iconLabel(name)}, ${state}` : iconLabel(name)
                return (
                  <CommandItem
                    key={name}
                    value={name}
                    aria-label={accessibleLabel}
                    aria-selected={isSelected}
                    onSelect={() => select(name)}
                  >
                    <RecordTypeIcon icon={name} aria-hidden />
                    <span>{iconLabel(name)}</span>
                    {usedBy.length > 0 && <span className="ml-auto text-xs text-text-muted">Used by {usedBy.join(', ')}</span>}
                    {isSelected && <Check size={16} aria-hidden className={usedBy.length > 0 ? '' : 'ml-auto'} />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
