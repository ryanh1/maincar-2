import { useEffect, useRef, useState } from 'react'
import { CallCommentComposer } from '@/components/call-review/CallCommentComposer'
import { CallCommentsRail_Comment } from '@/components/call-review/CallCommentsRail_Comment'
import { formatCallCommentTimestamp } from '@/components/call-review/callCommentTimestamp'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  useDeleteCallComment,
  useReplyToCallComment,
  useToggleCallCommentReaction,
  useUpdateCallComment,
} from '@/hooks/callComments'
import type { CallComment, CallCommentThread } from '@/lib/callCommentTypes'
import { formatElapsed } from '@/lib/duration'
import { cn } from '@/lib/utils'

interface CallCommentsRailThreadProps {
  thread: CallCommentThread
  orgId: string
  callId: string
  currentUserId: string
  timeZone: string | null | undefined
  isActive: boolean
  isNearest: boolean
  onActivate: (commentId: string, atMs: number) => void
}

/** One timed root, its one-level replies, and all local thread interactions. */
export function CallCommentsRail_Thread({
  thread,
  orgId,
  callId,
  currentUserId,
  timeZone,
  isActive,
  isNearest,
  onActivate,
}: CallCommentsRailThreadProps) {
  const reply = useReplyToCallComment()
  const update = useUpdateCallComment()
  const remove = useDeleteCallComment()
  const reaction = useToggleCallCommentReaction()
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState<CallComment | null>(null)
  const [deleting, setDeleting] = useState<CallComment | null>(null)
  const threadRef = useRef<HTMLElement>(null)
  const error = reply.error ?? update.error ?? remove.error ?? reaction.error
  const atMs = thread.atMs ?? 0

  useEffect(() => {
    if (isActive) threadRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isActive])

  return (
    <article
      ref={threadRef}
      data-comment-id={thread.id}
      data-active={isActive ? 'true' : undefined}
      data-nearest={isNearest ? 'true' : undefined}
      className={cn(
        'border border-border bg-bg',
        isActive && 'border-primary',
        !isActive && isNearest && 'bg-surface',
      )}
    >
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        className="flex w-full items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-left hover:bg-surface-2 focus-visible:border-primary focus-visible:outline-none"
        onClick={() => onActivate(thread.id, atMs)}
      >
        <span className="text-sm font-medium tabular-nums">{formatElapsed(atMs / 1_000)}</span>
        <span className="truncate text-xs text-text-muted">{formatCallCommentTimestamp(thread, timeZone)}</span>
      </button>
      {thread.anchorQuote && (
        <blockquote className="mx-3 mt-2 border-l-2 border-primary pl-2 text-xs text-text-muted">
          “{thread.anchorQuote}”
        </blockquote>
      )}
      <div className="flex flex-col gap-2 p-3">
        <CallCommentsRail_Comment
          comment={thread}
          currentUserId={currentUserId}
          timeZone={timeZone}
          onEdit={setEditing}
          onDelete={setDeleting}
          onReact={(emoji, active) => reaction.mutate({ orgId, callId, commentId: thread.id, userId: currentUserId, emoji, active })}
        />
        {thread.replies.map((item) => (
          <div key={item.id} className="ml-4 border-l border-border pl-3">
            <CallCommentsRail_Comment
              comment={item}
              currentUserId={currentUserId}
              timeZone={timeZone}
              onEdit={setEditing}
              onDelete={setDeleting}
              onReact={(emoji, active) => reaction.mutate({ orgId, callId, commentId: item.id, userId: currentUserId, emoji, active })}
            />
          </div>
        ))}
        {!thread.deletedAt && !replying && (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setReplying(true)}>
            Reply
          </Button>
        )}
        {replying && (
          <CallCommentComposer
            orgId={orgId}
            label={`Reply at ${formatElapsed(atMs / 1_000)}`}
            saveLabel="Post reply"
            onCancel={() => setReplying(false)}
            onSave={async (bodyJson) => {
              await reply.mutateAsync({ orgId, callId, commentId: thread.id, bodyJson })
              setReplying(false)
            }}
          />
        )}
        {editing && (
          <CallCommentComposer
            key={editing.id}
            orgId={orgId}
            label="Edit comment"
            saveLabel="Save changes"
            initialBody={editing.bodyJson}
            onCancel={() => setEditing(null)}
            onSave={async (bodyJson) => {
              await update.mutateAsync({ orgId, callId, commentId: editing.id, bodyJson })
              setEditing(null)
            }}
          />
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
      </div>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              A comment with replies remains as a deleted marker so the thread stays readable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep comment</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return
                remove.mutate({ orgId, callId, commentId: deleting.id })
                setDeleting(null)
              }}
            >
              Delete comment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
