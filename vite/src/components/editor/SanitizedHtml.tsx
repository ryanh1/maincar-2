/**
 * Render stored HTML — the one component in the app that may.
 *
 * The rules, the allow-list, and the reasons all live in
 * [`sanitizeStoredHtml.ts`](./sanitizeStoredHtml.ts) beside this file. Split in
 * two only because a `.tsx` that exports anything other than a component breaks
 * fast refresh, which is the same reason `editorExtensions.ts` is a `.ts`.
 */
import { useMemo } from 'react'

import { cn } from '@/lib/utils'
import { sanitizeStoredHtml } from './sanitizeStoredHtml'

export interface SanitizedHtmlProps {
  /** The stored HTML. `null` and `undefined` render as nothing. */
  html: string | null | undefined
  className?: string
}

/**
 * Render stored HTML.
 *
 * ```tsx
 * <SanitizedHtml html={draft.bodyHtml} className="tiptap text-sm" />
 * ```
 *
 * The sanitising is memoised on the string, so a parent that re-renders on every
 * keystroke does not re-parse the whole body each time.
 */
export function SanitizedHtml({ html, className }: SanitizedHtmlProps) {
  const clean = useMemo(() => (html ? sanitizeStoredHtml(html) : ''), [html])

  return <div className={cn(className)} dangerouslySetInnerHTML={{ __html: clean }} />
}
