import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import type { SuggestionProps } from '@tiptap/suggestion'

import { cn } from '@/lib/utils'

import { groupMentionSuggestions, type MentionSuggestion } from './mentionResolver'

export interface MentionSuggestionMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type MentionSuggestionMenuProps = SuggestionProps<MentionSuggestion, MentionSuggestion>

/** An anchored, keyboard-complete picker used by TipTap's managed suggestion popup. */
export const MentionSuggestionMenu = forwardRef<MentionSuggestionMenuHandle, MentionSuggestionMenuProps>(
  function MentionSuggestionMenu({ items, command, query }: MentionSuggestionMenuProps, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const groups = useMemo(() => groupMentionSuggestions(items), [items])
    const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

    useImperativeHandle(ref, () => ({
      onKeyDown(event) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex((current) => Math.min(current + 1, Math.max(flatItems.length - 1, 0)))
          return true
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex((current) => Math.max(current - 1, 0))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const selected = flatItems[selectedIndex]
          if (!selected) return false
          event.preventDefault()
          command(selected)
          return true
        }
        return false
      },
    }), [command, flatItems, selectedIndex])

    if (flatItems.length === 0) {
      return <div className="mention-suggestion-menu" role="status">No matches for @{query}</div>
    }

    let itemIndex = -1
    return (
      <div className="mention-suggestion-menu" role="listbox" aria-label="Mention suggestions">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mention-suggestion-heading">{group.label}</p>
            {group.items.map((item) => {
              itemIndex += 1
              const index = itemIndex
              return (
                <button
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={cn('mention-suggestion-option', index === selectedIndex && 'is-selected')}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => command(item)}
                >
                  <span className="mention-suggestion-label">{item.label}</span>
                  <span className="mention-suggestion-detail">{item.detail}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  },
)
