import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'

import { useToggleCallCommentReaction } from '@/hooks/callComments/useToggleCallCommentReaction'
import type { GetCallCommentsResponse } from '@/lib/callCommentTypes'
import { queryKeys } from '@/lib/queryKeys'

const { jsonFetchMock } = vi.hoisted(() => ({ jsonFetchMock: vi.fn() }))
vi.mock('@/lib/api', () => ({ jsonFetch: jsonFetchMock }))

const key = queryKeys.calls.comments('org-1', 'call-1')
const original: GetCallCommentsResponse = {
  comments: [{
    id: 'comment-1',
    parentId: null,
    atMs: 1_000,
    anchorEndMs: null,
    anchorQuote: null,
    selectionStartChar: null,
    selectionEndChar: null,
    transcriptId: null,
    bodyJson: { type: 'doc' },
    bodyText: 'A comment',
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    author: { id: 'user-2', name: 'Ada', imageUrl: null },
    reactions: [],
    replies: [],
  }],
  total: 1,
  page: 1,
  limit: 100,
}

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })
  client.setQueryData(key, structuredClone(original))
})

it('applies a reaction optimistically and rolls the exact cache back when the request fails', async () => {
  let rejectRequest: ((error: Error) => void) | undefined
  jsonFetchMock.mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject }))
  const { result } = renderHook(() => useToggleCallCommentReaction(), { wrapper })

  act(() => {
    result.current.mutate({
      orgId: 'org-1',
      callId: 'call-1',
      commentId: 'comment-1',
      userId: 'user-1',
      emoji: '👍',
      active: false,
    })
  })

  await waitFor(() => expect(client.getQueryData<GetCallCommentsResponse>(key)?.comments[0]?.reactions).toEqual([
    { userId: 'user-1', emoji: '👍' },
  ]))

  act(() => rejectRequest?.(new Error('offline')))

  await waitFor(() => expect(client.getQueryData<GetCallCommentsResponse>(key)).toEqual(original))
  expect(jsonFetchMock).toHaveBeenCalledWith(
    '/api/orgs/org-1/calls/call-1/comments/comment-1/reactions/%F0%9F%91%8D',
    { method: 'PUT' },
  )
})
