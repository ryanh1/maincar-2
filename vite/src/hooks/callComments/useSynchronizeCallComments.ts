import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { CallCommentThread } from '@/lib/callCommentTypes'

export type CallReviewPane = 'playback' | 'comments'

const EMPTY_THREADS: readonly CallCommentThread[] = []

interface SynchronizeCallCommentsInput {
  callId: string
  threads?: readonly CallCommentThread[]
  currentTimeMs: number
  onActivateMoment: (atMs: number) => void
}

/** Keeps every comment navigation surface on one URL-backed media moment. */
export function useSynchronizeCallComments({
  callId,
  threads = EMPTY_THREADS,
  currentTimeMs,
  onActivateMoment,
}: SynchronizeCallCommentsInput) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activePane, setActivePane] = useState<CallReviewPane>(
    () => searchParams.get('mode') === 'comments' ? 'comments' : 'playback',
  )
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const handledDeepLinkRef = useRef<string | null>(null)

  const commentPins = useMemo(
    () => threads.flatMap((thread) =>
      thread.atMs === null ? [] : [{ id: thread.id, time: thread.atMs / 1_000 }]),
    [threads],
  )
  const nearestCommentId = useMemo(() => {
    let nearest: { id: string; distance: number } | null = null
    for (const thread of threads) {
      if (thread.atMs === null) continue
      const distance = Math.abs(thread.atMs - currentTimeMs)
      if (!nearest || distance < nearest.distance) nearest = { id: thread.id, distance }
    }
    return nearest?.id ?? null
  }, [currentTimeMs, threads])

  const activateComment = useCallback((commentId: string, atMs: number) => {
    handledDeepLinkRef.current = `${callId}:${commentId}`
    setActiveCommentId(commentId)
    setActivePane('comments')
    onActivateMoment(atMs)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('mode', 'comments')
      next.set('commentId', commentId)
      return next
    })
  }, [callId, onActivateMoment, setSearchParams])

  const deepLinkCommentId = searchParams.get('commentId')
  useEffect(() => {
    if (!deepLinkCommentId) return
    const thread = threads.find((candidate) =>
      candidate.id === deepLinkCommentId ||
      candidate.replies.some((reply) => reply.id === deepLinkCommentId),
    )
    if (!thread || thread.atMs === null) return
    const key = `${callId}:${thread.id}`
    if (handledDeepLinkRef.current === key) return
    handledDeepLinkRef.current = key
    setActiveCommentId(thread.id)
    setActivePane('comments')
    onActivateMoment(thread.atMs)
  }, [callId, deepLinkCommentId, onActivateMoment, threads])

  return {
    activeCommentId,
    activePane,
    activateComment,
    commentPins,
    nearestCommentId,
    setActivePane,
  }
}
