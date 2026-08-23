/** One stable target available from the shared @ picker. */
export interface MentionSuggestion {
  id: string
  label: string
  kind: 'teammate' | 'contact' | 'company' | 'deal'
  detail: string
}

export interface MentionSuggestionGroup {
  label: 'Teammates' | 'Contacts' | 'Companies' | 'Deals'
  items: MentionSuggestion[]
}

const GROUPS: Array<{ kind: MentionSuggestion['kind']; label: MentionSuggestionGroup['label'] }> = [
  { kind: 'teammate', label: 'Teammates' },
  { kind: 'contact', label: 'Contacts' },
  { kind: 'company', label: 'Companies' },
  { kind: 'deal', label: 'Deals' },
]

/** Case-insensitive local filtering keeps the picker instant after its one org-scoped load. */
export function filterMentionSuggestions(items: readonly MentionSuggestion[], query: string): MentionSuggestion[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return [...items]
  return items.filter((item) =>
    item.label.toLocaleLowerCase().includes(normalized) || item.detail.toLocaleLowerCase().includes(normalized),
  )
}

/** Keep category order stable so keyboard position never moves between identical queries. */
export function groupMentionSuggestions(items: readonly MentionSuggestion[]): MentionSuggestionGroup[] {
  return GROUPS.flatMap(({ kind, label }) => {
    const grouped = items.filter((item) => item.kind === kind)
    return grouped.length > 0 ? [{ label, items: grouped }] : []
  })
}
