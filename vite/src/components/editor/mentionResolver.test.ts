import { describe, expect, it } from 'vitest'

import { filterMentionSuggestions, groupMentionSuggestions } from './mentionResolver'

const suggestions = [
  { id: 'user-1', label: 'Ada Lovelace', kind: 'teammate' as const, detail: 'ada@example.com' },
  { id: 'company-1', label: 'Acme', kind: 'company' as const, detail: 'Company' },
  { id: 'person-1', label: 'Ada Byron', kind: 'contact' as const, detail: 'Contact' },
  { id: 'deal-1', label: 'Acme renewal', kind: 'deal' as const, detail: 'Deal' },
]

describe('mention resolver', () => {
  it('filters names and details without changing the durable ID', () => {
    expect(filterMentionSuggestions(suggestions, 'ada')).toEqual([
      suggestions[0],
      suggestions[2],
    ])
    expect(filterMentionSuggestions(suggestions, 'renewal')).toEqual([suggestions[3]])
  })

  it('groups teammates before record links, preserving stable IDs', () => {
    expect(groupMentionSuggestions(suggestions)).toEqual([
      { label: 'Teammates', items: [suggestions[0]] },
      { label: 'Contacts', items: [suggestions[2]] },
      { label: 'Companies', items: [suggestions[1]] },
      { label: 'Deals', items: [suggestions[3]] },
    ])
  })
})
