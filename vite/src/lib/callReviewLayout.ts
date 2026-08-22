export const CALL_REVIEW_LAYOUT_STORAGE_PREFIX = 'maincar:call-review-layout'

export type CallReviewLayoutPreset = 'focused-comments' | 'balanced' | 'focused-transcript'

export interface CallReviewLayout {
  preset: CallReviewLayoutPreset
  playbackWidth: number
}

export const DEFAULT_CALL_REVIEW_LAYOUT: CallReviewLayout = {
  preset: 'balanced',
  playbackWidth: 60,
}

function isCallReviewLayout(value: unknown): value is CallReviewLayout {
  if (!value || typeof value !== 'object') return false

  const layout = value as Partial<CallReviewLayout>
  return (
    (layout.preset === 'focused-comments' || layout.preset === 'balanced' || layout.preset === 'focused-transcript') &&
    typeof layout.playbackWidth === 'number' &&
    layout.playbackWidth >= 30 &&
    layout.playbackWidth <= 70
  )
}

function storageKey(userId: string): string {
  return `${CALL_REVIEW_LAYOUT_STORAGE_PREFIX}:${userId}`
}

/**
 * A review layout is a personal browser preference. The user id scopes it so a
 * shared browser never carries one rep's review setup into another rep's view.
 */
export function getStoredCallReviewLayout(userId: string | null | undefined): CallReviewLayout {
  if (!userId || typeof window === 'undefined') return DEFAULT_CALL_REVIEW_LAYOUT

  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? 'null') as unknown
    return isCallReviewLayout(saved) ? saved : DEFAULT_CALL_REVIEW_LAYOUT
  } catch {
    return DEFAULT_CALL_REVIEW_LAYOUT
  }
}

export function saveCallReviewLayout(userId: string | null | undefined, layout: CallReviewLayout): void {
  if (!userId || typeof window === 'undefined') return

  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(layout))
  } catch {
    // Layout controls remain usable when a browser refuses preference storage.
  }
}
