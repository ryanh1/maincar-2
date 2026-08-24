import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

import { Avatar } from '@/components/Avatar'
import { formatCallCommentTimestamp } from '@/components/call-review/callCommentTimestamp'
import { SanitizedHtml } from '@/components/editor/SanitizedHtml'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { callCommentBodyHtml } from '@/lib/callCommentBody'
import type { CallComment } from '@/lib/callCommentTypes'
import { cn } from '@/lib/utils'

const QUICK_REACTIONS = ['👍', '✅', '🎯'] as const

interface CallCommentsRailCommentProps {
  comment: CallComment
  currentUserId: string
  timeZone: string | null | undefined
  onEdit: (comment: CallComment) => void
  onDelete: (comment: CallComment) => void
  onReact: (emoji: string, active: boolean) => void
}

/** One root or reply body with author-owned actions and optimistic reaction controls. */
export function CallCommentsRail_Comment({
  comment,
  currentUserId,
  timeZone,
  onEdit,
  onDelete,
  onReact,
}: CallCommentsRailCommentProps) {
  const authorName = comment.author?.name ?? 'Former teammate'
  const emojis = [...QUICK_REACTIONS, ...comment.reactions.map((item) => item.emoji)]
    .filter((emoji, index, all) => all.indexOf(emoji) === index)

  return (
    <div className="flex gap-2">
      <Avatar name={authorName} src={comment.author?.imageUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{authorName}</p>
            {comment.parentId && <p className="text-xs text-text-muted">{formatCallCommentTimestamp(comment, timeZone)}</p>}
          </div>
          {comment.author?.id === currentUserId && !comment.deletedAt && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton tooltip={`Show actions for ${authorName}'s comment`}><MoreHorizontal size={16} aria-hidden /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(comment)}><Pencil size={16} aria-hidden />Edit</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(comment)}><Trash2 size={16} aria-hidden />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {comment.deletedAt ? (
          <p className="mt-2 text-sm italic text-text-muted">This comment was deleted.</p>
        ) : (
          <SanitizedHtml html={callCommentBodyHtml(comment.bodyJson)} className="tiptap mt-2 text-sm" />
        )}
        {!comment.deletedAt && (
          <div className="mt-2 flex flex-wrap gap-1" aria-label={`Reactions to ${authorName}'s comment`}>
            {emojis.map((emoji) => {
              const reactions = comment.reactions.filter((item) => item.emoji === emoji)
              const active = reactions.some((item) => item.userId === currentUserId)
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`${active ? 'Remove' : 'Add'} ${emoji} reaction to ${authorName}'s comment`}
                  aria-pressed={active}
                  className={cn(
                    'h-8 rounded-md border border-border px-2 text-xs tabular-nums hover:bg-surface-2 focus-visible:border-primary focus-visible:outline-none',
                    active && 'border-primary bg-surface',
                  )}
                  onClick={() => onReact(emoji, active)}
                >
                  {emoji}{reactions.length > 0 ? ` ${reactions.length}` : ''}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
