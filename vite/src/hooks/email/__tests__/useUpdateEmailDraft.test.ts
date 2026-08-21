import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailDraft } from '@/lib/emailTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useUpdateEmailDraft } from '../useUpdateEmailDraft'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function draft(id: string, subject: string | null): EmailDraft {
  return {
    id,
    mailAccountId: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject,
    bodyHtml: null,
    isOpen: true,
    isMinimized: false,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderUpdateDraft(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useUpdateEmailDraft(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useUpdateEmailDraft', () => {
  it('PATCHes the draft path with only the keys that changed', async () => {
    jsonFetch.mockResolvedValue({ draft: draft('draft-1', 'Quote') })

    const { result } = renderUpdateDraft()
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1', subject: 'Quote' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts/draft-1', {
      method: 'PATCH',
      body: '{"subject":"Quote"}',
    })
  })

  it('keeps orgId and draftId out of the body, so a half-written body is untouched', async () => {
    jsonFetch.mockResolvedValue({ draft: draft('draft-1', 'Quote') })

    const { result } = renderUpdateDraft()
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1', isMinimized: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The route writes exactly the keys the body carries. A body that also
    // spelled out bodyHtml would blank a half-written email on every minimize.
    expect(JSON.parse(jsonFetch.mock.calls[0][1].body)).toEqual({ isMinimized: true })
  })

  it('saves a close as isOpen false, never as a delete', async () => {
    jsonFetch.mockResolvedValue({ draft: { ...draft('draft-1', 'Quote'), isOpen: false } })

    const { result } = renderUpdateDraft()
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1', isOpen: false })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch.mock.calls[0][1].method).toBe('PATCH')
    expect(result.current.data?.draft.isOpen).toBe(false)
  })

  it('never invalidates on a successful save, so an open card is never re-rendered from the server', async () => {
    jsonFetch.mockResolvedValue({ draft: draft('draft-1', 'Quo') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    // A list already in cache is what an invalidation would go and refetch.
    // The shared test client garbage-collects instantly, so this one key is
    // pinned — otherwise the row would vanish on its own and prove nothing.
    client.setQueryDefaults(queryKeys.email.drafts('org-1'), { gcTime: Infinity })
    client.setQueryData(queryKeys.email.drafts('org-1'), {
      drafts: [draft('draft-1', 'stale server copy')],
      total: 1,
    })

    const { result } = renderUpdateDraft(client)
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1', subject: 'Quo' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
    // Only the PATCH went out. A refetch mid-keystroke would push the server's
    // copy of the body back at an editor the rep is still typing in.
    expect(jsonFetch).toHaveBeenCalledTimes(1)
    // And the cache was not written by hand either, which would be the same
    // push by another route.
    expect(
      (client.getQueryData(queryKeys.email.drafts('org-1')) as { drafts: EmailDraft[] }).drafts[0]
        .subject,
    ).toBe('stale server copy')
  })

  it('does not invalidate on a failed save either', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Draft not found', 404))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderUpdateDraft(client)
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1', subject: 'Quote' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // A save fails while the rep is mid-sentence. Resyncing the list here would
    // answer a failed save by throwing away the text that failed to save.
    expect(invalidate).not.toHaveBeenCalled()
    expect((result.current.error as ApiError).message).toBe('Draft not found')
    expect((result.current.error as ApiError).status).toBe(404)
  })
})
