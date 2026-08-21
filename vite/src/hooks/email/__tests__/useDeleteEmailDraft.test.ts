import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useDeleteEmailDraft } from '../useDeleteEmailDraft'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderDeleteDraft(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useDeleteEmailDraft(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useDeleteEmailDraft', () => {
  it('DELETEs the draft path and hands back the id the server confirmed', async () => {
    jsonFetch.mockResolvedValue({ draft: { id: 'draft-1' } })

    const { result } = renderDeleteDraft()
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts/draft-1', {
      method: 'DELETE',
    })
    // The dock drops exactly this card, rather than trusting the request it sent.
    expect(result.current.data?.draft.id).toBe('draft-1')
  })

  it('does not invalidate after a discard that worked', async () => {
    jsonFetch.mockResolvedValue({ draft: { id: 'draft-1' } })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDeleteDraft(client)
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Refetching would re-read rows the dock already holds, and would hand the
    // provider stale server copies of the cards still being typed in.
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('invalidates this org drafts on error, to resync a dock that now disagrees', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Draft not found', 404))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDeleteDraft(client)
    result.current.mutate({ orgId: 'org-1', draftId: 'draft-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.email.drafts('org-1') })
    expect((result.current.error as ApiError).message).toBe('Draft not found')
    expect((result.current.error as ApiError).status).toBe(404)
  })
})
