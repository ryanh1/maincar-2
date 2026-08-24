import type { CallComment } from '@/lib/callCommentTypes'
import { formatDateTime } from '@/lib/datetime'

/** Created or edited moment in the viewing user's explicit timezone. */
export function formatCallCommentTimestamp(
  comment: CallComment,
  timeZone: string | null | undefined,
): string {
  const edited = comment.updatedAt !== comment.createdAt
  return `${formatDateTime(edited ? comment.updatedAt : comment.createdAt, timeZone)}${edited ? ' · Edited' : ''}`
}
