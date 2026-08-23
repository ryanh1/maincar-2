export type GridAutocompleteTrigger = '@' | '/'

const RICH_TEXT_TYPES = new Set(['text', 'note', 'task'])

/** Gates the canvas-only overlay exactly where the rich-surface interaction is supported. */
export function supportsGridAutocomplete(type: string, trigger: GridAutocompleteTrigger): boolean {
  if (RICH_TEXT_TYPES.has(type)) return trigger === '@' || trigger === '/'
  if (type === 'date') return trigger === '@'
  return (type === 'select' || type === 'status') && trigger === '@'
}
