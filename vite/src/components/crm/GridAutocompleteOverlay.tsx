import { useEffect, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { useMentionSuggestions } from '@/components/editor/useMentionSuggestions'
import { filterMentionSuggestions, groupMentionSuggestions, type MentionSuggestion } from '@/components/editor/mentionResolver'
import type { AttributeDef } from '@/lib/crmTypes'

import { parseOptions } from './cellBuilder'
import { supportsGridAutocomplete, type GridAutocompleteTrigger } from './gridAutocomplete'
import { parseGridCommand } from './gridCommands'

const SLASH_COMMANDS = [
  { id: 'task', label: 'Task', detail: 'Add a task' },
  { id: 'note', label: 'Note', detail: 'Add a note' },
  { id: 'call', label: 'Call', detail: 'Add a call' },
  { id: 'status', label: 'Status', detail: 'Set a status' },
] as const

interface GridAutocompleteOverlayProps {
  anchor: { x: number; y: number; width: number; height: number }
  attribute: AttributeDef
  orgId: string
  trigger: GridAutocompleteTrigger
  onCommit: (value: string) => void
  onClose: () => void
}

interface PickerOption {
  id: string
  label: string
  detail: string
  value: string
}

/** The canvas grid has no DOM cell to host TipTap's picker, so it owns this positioned equivalent. */
export function GridAutocompleteOverlay(props: GridAutocompleteOverlayProps) {
  return supportsGridAutocomplete(props.attribute.type, '/')
    ? <MentionGridAutocompleteOverlay {...props} />
    : <ValueGridAutocompleteOverlay {...props} />
}

function MentionGridAutocompleteOverlay({ anchor, attribute, orgId, trigger, onCommit, onClose }: GridAutocompleteOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const mentions = useMentionSuggestions(orgId)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const options = useMemo<PickerOption[]>(() => {
    if (trigger === '/') {
      const normalized = query.trim().toLocaleLowerCase()
      return SLASH_COMMANDS
        .filter((command) => normalized === '' || command.label.toLocaleLowerCase().includes(normalized))
        .map((command) => ({ ...command, value: `/${command.id}` }))
    }
    if (trigger === '@') {
      return filterMentionSuggestions(mentions.items, query).map((item) => ({
        id: `${item.kind}:${item.id}`,
        label: item.label,
        detail: item.detail,
        value: `@${item.label}`,
      }))
    }
    return []
  }, [mentions.items, query, trigger])

  function choose(option: PickerOption) {
    onCommit(option.value)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % options.length)
      return
    }
    if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current - 1 + options.length) % options.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (options[selectedIndex]) choose(options[selectedIndex])
    }
  }

  const groupedMentions = trigger === '@'
    ? groupMentionSuggestions(filterMentionSuggestions(mentions.items, query))
    : []

  return (
    <div
      role="dialog"
      aria-label={`Autocomplete for ${attribute.name}`}
      className="absolute z-20 w-72 border border-border bg-popover p-1 shadow-md"
      style={{ left: anchor.x, top: anchor.y + anchor.height, minWidth: anchor.width }}
    >
      <Input
        ref={inputRef}
        className="h-8"
        aria-label={`Search ${attribute.name} suggestions`}
        aria-controls="grid-autocomplete-options"
        aria-expanded="true"
        placeholder={trigger === '@' ? 'Search mentions' : 'Search commands'}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelectedIndex(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div id="grid-autocomplete-options" role="listbox" aria-label={`${attribute.name} suggestions`} className="mt-1 max-h-72 overflow-y-auto">
        {groupedMentions.length > 0
          ? groupedMentions.map((group) => (
            <MentionGroup key={group.label} group={group} options={options} selectedIndex={selectedIndex} onChoose={choose} />
          ))
          : options.length > 0
            ? options.map((option, index) => <Option key={option.id} option={option} selected={index === selectedIndex} onChoose={choose} />)
            : <p role="status" className="px-2 py-1 text-xs text-text-muted">No matching suggestions.</p>}
      </div>
    </div>
  )
}

function ValueGridAutocompleteOverlay({ anchor, attribute, trigger, onCommit, onClose }: Omit<GridAutocompleteOverlayProps, 'orgId'>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const isDateField = attribute.type === 'date'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const options = useMemo<PickerOption[]>(() => {
    if (trigger !== '@' || (attribute.type !== 'select' && attribute.type !== 'status')) return []
    const normalized = query.trim().toLocaleLowerCase()
    return parseOptions(attribute.optionsJson)
      .filter((option) => !option.isArchived)
      .filter((option) => normalized === '' || option.label.toLocaleLowerCase().includes(normalized))
      .map((option) => ({ id: option.value, label: option.label, detail: attribute.name, value: option.value }))
  }, [attribute.name, attribute.optionsJson, attribute.type, query, trigger])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % options.length)
      return
    }
    if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current - 1 + options.length) % options.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (isDateField) {
        const result = parseGridCommand(`@${query}`, { type: attribute.type })
        if (result.kind === 'value') onCommit(result.value)
      } else if (options[selectedIndex]) onCommit(options[selectedIndex].value)
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Autocomplete for ${attribute.name}`}
      className="absolute z-20 w-72 border border-border bg-popover p-1 shadow-md"
      style={{ left: anchor.x, top: anchor.y + anchor.height, minWidth: anchor.width }}
    >
      <Input
        ref={inputRef}
        className="h-8"
        aria-label={`Search ${attribute.name} suggestions`}
        aria-controls="grid-autocomplete-options"
        aria-expanded="true"
        placeholder={isDateField ? 'date tomorrow' : 'Search options'}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelectedIndex(0)
        }}
        onKeyDown={onKeyDown}
      />
      {isDateField ? (
        <p className="px-2 py-1 text-xs text-text-muted">Type date followed by a date, then press Enter.</p>
      ) : (
        <div id="grid-autocomplete-options" role="listbox" aria-label={`${attribute.name} suggestions`} className="mt-1 max-h-72 overflow-y-auto">
          {options.length > 0
            ? options.map((option, index) => <Option key={option.id} option={option} selected={index === selectedIndex} onChoose={(selected) => onCommit(selected.value)} />)
            : <p role="status" className="px-2 py-1 text-xs text-text-muted">No matching suggestions.</p>}
        </div>
      )}
    </div>
  )
}

function MentionGroup({ group, options, selectedIndex, onChoose }: {
  group: ReturnType<typeof groupMentionSuggestions>[number]
  options: PickerOption[]
  selectedIndex: number
  onChoose: (option: PickerOption) => void
}) {
  return (
    <div>
      <p className="px-2 py-1 text-xs font-medium text-text-muted">{group.label}</p>
      {group.items.map((item: MentionSuggestion) => {
        const option = options.find((candidate) => candidate.id === `${item.kind}:${item.id}`)
        if (!option) return null
        return <Option key={option.id} option={option} selected={options.indexOf(option) === selectedIndex} onChoose={onChoose} />
      })}
    </div>
  )
}

function Option({ option, selected, onChoose }: { option: PickerOption; selected: boolean; onChoose: (option: PickerOption) => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex w-full flex-col items-start px-2 py-1 text-left text-sm ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChoose(option)}
    >
      <span>{option.label}</span>
      <span className="text-xs text-text-muted">{option.detail}</span>
    </button>
  )
}
