import type { JSONContent } from '@tiptap/core'

export interface CallCommentAuthor {
  id: string
  name: string
  imageUrl: string | null
}

export interface CallCommentReaction {
  userId: string
  emoji: string
}

export interface CallComment {
  id: string
  parentId: string | null
  atMs: number | null
  anchorEndMs: number | null
  anchorQuote: string | null
  selectionStartChar: number | null
  selectionEndChar: number | null
  transcriptId: string | null
  bodyJson: JSONContent | null
  bodyText: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  author: CallCommentAuthor | null
  reactions: CallCommentReaction[]
}

export interface CallCommentThread extends CallComment {
  replies: CallComment[]
}

export interface GetCallCommentsResponse {
  comments: CallCommentThread[]
  total: number
  page: number
  limit: number
}

export interface CallCommentResponse {
  comment: CallComment
}

export interface CallCommentSelectionAnchor {
  kind: 'selection'
  atMs: number
  anchorEndMs: number
  anchorQuote: string
  selectionStartChar: number
  selectionEndChar: number
  transcriptId: string
}

export interface CallCommentPlayheadAnchor {
  kind: 'playhead'
  atMs: number
}

export type CallCommentDraftAnchor = CallCommentSelectionAnchor | CallCommentPlayheadAnchor
