import { MessageSquarePlus } from 'lucide-react'

import { CallCommentComposer } from '@/components/call-review/CallCommentComposer'
import { CallCommentsRail_Thread } from '@/components/call-review/CallCommentsRail_Thread'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCreateCallComment, useGetCallComments } from '@/hooks/callComments'
import type { CallCommentDraftAnchor } from '@/lib/callCommentTypes'
import { formatElapsed } from '@/lib/duration'

interface CallCommentsRailProps {
  orgId: string
  callId: string
  currentUserId: string
  timeZone: string | null | undefined
  currentTimeMs: number
  draft: CallCommentDraftAnchor | null
  activeCommentId: string | null
  nearestCommentId?: string | null
  onDraftChange: (draft: CallCommentDraftAnchor | null) => void
  onActivate: (commentId: string, atMs: number) => void
}

/** Independently scrolling timed threads with no untimed root composer. */
export function CallCommentsRail({
  orgId,
  callId,
  currentUserId,
  timeZone,
  currentTimeMs,
  draft,
  activeCommentId,
  nearestCommentId = null,
  onDraftChange,
  onActivate,
}: CallCommentsRailProps) {
  const comments = useGetCallComments(orgId, callId)
  const create = useCreateCallComment()
  const safePlayheadMs = Math.max(0, Math.round(Number.isFinite(currentTimeMs) ? currentTimeMs : 0))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-bg p-3">
        <h2 className="text-sm font-semibold">Comments</h2>
        <Button
          type="button"
          size="sm"
          onClick={() => onDraftChange({ kind: 'playhead', atMs: safePlayheadMs })}
        >
          <MessageSquarePlus size={16} aria-hidden />
          Comment at {formatElapsed(safePlayheadMs / 1_000)}
        </Button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {draft && (
          <div className="flex flex-col gap-2">
            <div className="border border-border bg-surface p-2">
              <p className="text-sm font-medium tabular-nums">
                {draft.kind === 'selection' ? 'Comment on selection' : 'Comment at playhead'} · {formatElapsed(draft.atMs / 1_000)}
              </p>
              {draft.kind === 'selection' && (
                <blockquote className="mt-2 border-l-2 border-primary pl-2 text-xs text-text-muted">“{draft.anchorQuote}”</blockquote>
              )}
            </div>
            <CallCommentComposer
              key={draft.kind === 'selection' ? `${draft.transcriptId}:${draft.selectionStartChar}:${draft.selectionEndChar}` : `playhead:${draft.atMs}`}
              orgId={orgId}
              label={draft.kind === 'selection' ? 'Comment on selected transcript text' : `Comment at ${formatElapsed(draft.atMs / 1_000)}`}
              saveLabel="Post comment"
              onCancel={() => onDraftChange(null)}
              onSave={async (bodyJson) => {
                await create.mutateAsync({ orgId, callId, bodyJson, anchor: draft })
                onDraftChange(null)
              }}
            />
          </div>
        )}

        {comments.isPending && (
          <div aria-label="Loading comments" className="flex flex-col gap-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {comments.isError && (
          <div className="border border-border bg-surface p-3">
            <p role="alert" className="text-sm text-destructive">Could not load comments. Try again.</p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void comments.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {comments.data && comments.data.comments.length === 0 && !draft && (
          <div className="border border-border bg-surface p-3">
            <p className="text-base font-semibold">Start the review</p>
            <p className="mt-1 text-sm text-text-muted">Comment at the playhead or select transcript text.</p>
          </div>
        )}

        {comments.data?.comments.map((thread) => (
          <CallCommentsRail_Thread
            key={thread.id}
            thread={thread}
            orgId={orgId}
            callId={callId}
            currentUserId={currentUserId}
            timeZone={timeZone}
            isActive={thread.id === activeCommentId}
            isNearest={thread.id === nearestCommentId}
            onActivate={onActivate}
          />
        ))}
      </div>
    </div>
  )
}
