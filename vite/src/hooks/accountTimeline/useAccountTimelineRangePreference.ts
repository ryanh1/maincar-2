import { useCallback, useEffect, useReducer } from 'react'

import type { AccountTimelineParams, AccountTimelineRoot } from '@/lib/accountTimelineTypes'

export const ACCOUNT_TIMELINE_RANGE_PREFERENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AccountTimelineRangeSelection {
  from: string
  to: string
}

interface StoredRangeSelection extends AccountTimelineRangeSelection {
  expiresAt: string
}

function preferenceKey(orgId: string, root: AccountTimelineRoot): string {
  return `account-timeline-range:${orgId}:${root.type}:${root.id}`
}

function readRange(key: string): StoredRangeSelection | null {
  if (typeof window === 'undefined') return null

  const raw = window.sessionStorage.getItem(key)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredRangeSelection>
    const expiresAt = parsed.expiresAt
    const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN
    const from = typeof parsed.from === 'string' ? Date.parse(parsed.from) : Number.NaN
    const to = typeof parsed.to === 'string' ? Date.parse(parsed.to) : Number.NaN
    if (
      typeof parsed.from !== 'string' ||
      typeof parsed.to !== 'string' ||
      typeof expiresAt !== 'string' ||
      Number.isNaN(from) ||
      Number.isNaN(to) ||
      to <= from ||
      Number.isNaN(expiry) ||
      expiry <= Date.now()
    ) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return { from: parsed.from, to: parsed.to, expiresAt }
  } catch {
    window.sessionStorage.removeItem(key)
    return null
  }
}

/**
 * Keeps a selected range within this browser session only. Its key includes both
 * the organization and Company/Deal root, preventing one account's selection
 * from leaking into another. Once the selection is 30 days old, it is removed so
 * the next timeline query omits the range and receives a fresh server default.
 */
export function useAccountTimelineRangePreference(
  orgId: string | null | undefined,
  root: AccountTimelineRoot | null,
) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  const key = orgId && root ? preferenceKey(orgId, root) : null
  // `refresh` rerenders after writes and expiry; reading here also drops a stale
  // stored selection whenever the caller changes organization or root scope.
  const selection = key ? readRange(key) : null
  const expiresAt = selection?.expiresAt

  useEffect(() => {
    if (!expiresAt) return undefined

    const remainingMs = Date.parse(expiresAt) - Date.now()
    const timer = window.setTimeout(refresh, Math.max(remainingMs, 0))
    return () => window.clearTimeout(timer)
  }, [expiresAt])

  const setRange = useCallback(
    (range: AccountTimelineRangeSelection) => {
      if (!key || typeof window === 'undefined') return

      const expiresAt = new Date(Date.now() + ACCOUNT_TIMELINE_RANGE_PREFERENCE_TTL_MS).toISOString()
      window.sessionStorage.setItem(key, JSON.stringify({ ...range, expiresAt }))
      refresh()
    },
    [key],
  )

  const reset = useCallback(() => {
    if (!key || typeof window === 'undefined') return
    window.sessionStorage.removeItem(key)
    refresh()
  }, [key])

  const range: Pick<AccountTimelineParams, 'occurredFrom' | 'occurredTo'> | null = selection
    ? { occurredFrom: selection.from, occurredTo: selection.to }
    : null

  return { range, hasOverride: !!range, setRange, reset }
}
