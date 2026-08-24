import { useCallback, useReducer } from 'react'

import type { AccountTimelineFilterValue, AccountTimelineRoot, AccountTimelineSourceType } from '@/lib/accountTimelineTypes'

const SOURCE_TYPES = new Set<AccountTimelineSourceType>([
  'call',
  'email',
  'sms',
  'meeting',
  'note',
  'stage_change',
  'task',
  'record_created',
  'custom',
])

function preferenceKey(orgId: string, root: AccountTimelineRoot): string {
  return `account-timeline-filters:${orgId}:${root.type}:${root.id}`
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function sanitizeFilters(value: Record<string, unknown>, rootType: AccountTimelineRoot['type']): AccountTimelineFilterValue {
  const sourceType = SOURCE_TYPES.has(value.sourceType as AccountTimelineSourceType)
    ? value.sourceType as AccountTimelineSourceType
    : undefined
  const personId = nonEmptyString(value.personId)
  const dealId = nonEmptyString(value.dealId)
  return {
    ...(sourceType ? { sourceType } : {}),
    ...(rootType === 'company' && personId ? { personId } : {}),
    ...(rootType === 'company' && dealId ? { dealId } : {}),
    ...(value.mine === true ? { mine: true } : {}),
  }
}

function readFilters(key: string, rootType: AccountTimelineRoot['type']): AccountTimelineFilterValue {
  if (typeof window === 'undefined') return {}

  const raw = window.sessionStorage.getItem(key)
  if (!raw) return {}

  try {
    return sanitizeFilters(JSON.parse(raw) as Record<string, unknown>, rootType)
  } catch {
    window.sessionStorage.removeItem(key)
    return {}
  }
}

/** Remembers the controlled timeline filters for one Company or Deal record. */
export function useAccountTimelineFilterPreference(
  orgId: string | null | undefined,
  root: AccountTimelineRoot | null,
) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  const key = orgId && root ? preferenceKey(orgId, root) : null
  const rootType = root?.type
  const filters = key && rootType ? readFilters(key, rootType) : {}

  const setFilters = useCallback((next: AccountTimelineFilterValue) => {
    if (!key || !rootType || typeof window === 'undefined') return
    const sanitized = sanitizeFilters(next, rootType)
    if (Object.keys(sanitized).length === 0) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify(sanitized))
    refresh()
  }, [key, rootType])

  return { filters, setFilters }
}
