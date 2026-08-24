import { useState } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CallCommentsRail } from '@/components/call-review/CallCommentsRail'
import type { CallCommentDraftAnchor, CallCommentThread } from '@/lib/callCommentTypes'
import { renderWithProviders } from '@/test/utils'

const {
  useGetCallCommentsMock,
  createMutation,
  deleteMutation,
  replyMutation,
  reactionMutation,
  updateMutation,
  refetchMock,
} = vi.hoisted(() => ({
  useGetCallCommentsMock: vi.fn(),
  createMutation: { mutateAsync: vi.fn(), error: null },
  deleteMutation: { mutate: vi.fn(), error: null },
  replyMutation: { mutateAsync: vi.fn(), error: null },
  reactionMutation: { mutate: vi.fn(), error: null },
  updateMutation: { mutateAsync: vi.fn(), error: null },
  refetchMock: vi.fn(),
}))

vi.mock('@/hooks/callComments', () => ({
  useGetCallComments: useGetCallCommentsMock,
  useCreateCallComment: () => createMutation,
  useDeleteCallComment: () => deleteMutation,
  useReplyToCallComment: () => replyMutation,
  useToggleCallCommentReaction: () => reactionMutation,
  useUpdateCallComment: () => updateMutation,
}))

vi.mock('@/hooks/orgs', () => ({
  useGetMembers: () => ({
    data: {
      members: [{
        userId: 'user-2',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        enabled: true,
      }],
    },
    isError: false,
  }),
  memberDisplayName: (member: { firstName: string | null; lastName: string | null; email: string }) =>
    [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
}))

const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review this moment.' }] }] }

beforeAll(() => {
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  }
  if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  }
})

async function writeEditor(label: string, html: string): Promise<void> {
  const editor = screen.getByRole('textbox', { name: label })
  editor.innerHTML = html
  fireEvent.input(editor)
  await act(async () => {})
}

function thread(overrides: Partial<CallCommentThread> = {}): CallCommentThread {
  return {
    id: 'comment-1',
    parentId: null,
    atMs: 1_650,
    anchorEndMs: null,
    anchorQuote: null,
    selectionStartChar: null,
    selectionEndChar: null,
    transcriptId: null,
    bodyJson: BODY,
    bodyText: 'Review this moment.',
    deletedAt: null,
    createdAt: '2026-01-02T15:04:00.000Z',
    updatedAt: '2026-01-02T15:04:00.000Z',
    author: { id: 'user-1', name: 'Grace Hopper', imageUrl: null },
    reactions: [],
    replies: [],
    ...overrides,
  }
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: { comments: [], total: 0, page: 1, limit: 100 },
    isPending: false,
    isError: false,
    refetch: refetchMock,
    ...overrides,
  }
}

function RailHarness({ initialDraft = null }: { initialDraft?: CallCommentDraftAnchor | null }) {
  const [draft, setDraft] = useState<CallCommentDraftAnchor | null>(initialDraft)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  return (
    <CallCommentsRail
      orgId="org-1"
      callId="call-1"
      currentUserId="user-1"
      timeZone="America/New_York"
      currentTimeMs={1_650}
      draft={draft}
      activeCommentId={activeCommentId}
      onDraftChange={setDraft}
      onActivate={(commentId) => setActiveCommentId(commentId)}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useGetCallCommentsMock.mockReturnValue(query())
  createMutation.mutateAsync.mockResolvedValue({ comment: thread() })
  replyMutation.mutateAsync.mockResolvedValue({ comment: thread({ id: 'reply-1', parentId: 'comment-1' }) })
  updateMutation.mutateAsync.mockResolvedValue({ comment: thread() })
})

describe('CallCommentsRail', () => {
  it('renders loading, error retry, and empty states without an untimed composer', async () => {
    const user = userEvent.setup()
    useGetCallCommentsMock.mockReturnValue(query({ data: undefined, isPending: true }))
    const loading = renderWithProviders(<RailHarness />)
    expect(screen.getByLabelText('Loading comments')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    loading.unmount()

    useGetCallCommentsMock.mockReturnValue(query({ data: undefined, isPending: false, isError: true }))
    const failed = renderWithProviders(<RailHarness />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetchMock).toHaveBeenCalled()
    failed.unmount()

    useGetCallCommentsMock.mockReturnValue(query())
    renderWithProviders(<RailHarness />)
    expect(screen.getByText('Start the review')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('creates a root at the exact current playhead', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RailHarness />)

    await user.click(screen.getByRole('button', { name: 'Comment at 00:01' }))
    await writeEditor('Comment at 00:01', '<p>Follow up with Ada.</p>')
    await user.click(screen.getByRole('button', { name: 'Post comment' }))

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      callId: 'call-1',
      anchor: { kind: 'playhead', atMs: 1_650 },
    })))
  })

  it('preloads an exact transcript quote and range into the selection journey', () => {
    renderWithProviders(
      <RailHarness initialDraft={{
        kind: 'selection',
        atMs: 1_650,
        anchorEndMs: 2_500,
        anchorQuote: 'renewal works',
        selectionStartChar: 12,
        selectionEndChar: 25,
        transcriptId: 'pass-1',
      }} />,
    )

    expect(screen.getByText('“renewal works”')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Comment on selected transcript text' })).toBeInTheDocument()
  })

  it('renders primary media moments, explicit-zone timestamps, active and nearest states, replies, tombstones, and reactions', async () => {
    const user = userEvent.setup()
    const nearest = thread({
      id: 'comment-2',
      atMs: 2_500,
      deletedAt: '2026-01-02T15:05:00.000Z',
      bodyJson: null,
      bodyText: null,
      author: null,
      replies: [{
        ...thread({ id: 'reply-1', parentId: 'comment-2', atMs: null }),
        replies: undefined,
      } as never],
    })
    useGetCallCommentsMock.mockReturnValue(query({
      data: { comments: [thread(), nearest], total: 2, page: 1, limit: 100 },
    }))
    const onActivate = vi.fn()
    renderWithProviders(
      <CallCommentsRail
        orgId="org-1"
        callId="call-1"
        currentUserId="user-1"
        timeZone="America/New_York"
        currentTimeMs={1_650}
        draft={null}
        activeCommentId="comment-1"
        nearestCommentId="comment-2"
        onDraftChange={vi.fn()}
        onActivate={onActivate}
      />,
    )

    expect(screen.getAllByText('Jan 2, 2026, 10:04 AM EST').length).toBeGreaterThan(0)
    const activeThread = document.querySelector<HTMLElement>('[data-comment-id="comment-1"]')
    expect(activeThread).toHaveAttribute('data-active', 'true')
    expect(document.querySelector('[data-comment-id="comment-2"]')).toHaveAttribute('data-nearest', 'true')
    expect(screen.getByText('This comment was deleted.')).toBeInTheDocument()
    if (!activeThread) throw new Error('Active thread did not render')
    const moment = within(activeThread).getByRole('button', { name: /00:01Jan 2, 2026/ })
    moment.focus()
    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledWith('comment-1', 1_650)
    await user.click(within(activeThread).getByRole('button', { name: 'Add 👍 reaction to Grace Hopper\'s comment' }))
    expect(reactionMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'comment-1',
      emoji: '👍',
      active: false,
    }))
  })

  it('supports replies, edits, and confirmed deletion for the author', async () => {
    const user = userEvent.setup()
    useGetCallCommentsMock.mockReturnValue(query({
      data: { comments: [thread()], total: 1, page: 1, limit: 100 },
    }))
    renderWithProviders(<RailHarness />)

    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await writeEditor('Reply at 00:01', '<p>Agreed.</p>')
    await user.click(screen.getByRole('button', { name: 'Post reply' }))
    await waitFor(() => expect(replyMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'comment-1' })))

    await user.click(screen.getByRole('button', { name: "Show actions for Grace Hopper's comment" }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toHaveTextContent('Review this moment.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: "Show actions for Grace Hopper's comment" }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete comment' }))
    expect(deleteMutation.mutate).toHaveBeenCalledWith({ orgId: 'org-1', callId: 'call-1', commentId: 'comment-1' })
  })
})
