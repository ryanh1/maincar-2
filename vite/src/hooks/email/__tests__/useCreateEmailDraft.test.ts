import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailDraft } from '@/lib/emailTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useCreateEmailDraft } from '../useCreateEmailDraft'

// Only the transport is mocked. The hook's job is the URL, the method, the body
// it sends, and what it does to the cache afterwards.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function draft(id: string): EmailDraft {
  return {
    id,
    mailAccountId: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: null,
    bodyHtml: null,
    isOpen: true,
    isMinimized: false,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderCreateDraft(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useCreateEmailDraft(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useCreateEmailDraft', () => {
  it('POSTs an empty body to the org-scoped path', async () => {
    jsonFetch.mockResolvedValue({ draft: draft('draft-1') })

    const { result } = renderCreateDraft()
    result.current.mutate({ orgId: 'org-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // Empty, because the row is created the moment the card opens and every
    // later keystroke is a PATCH against the id this returns.
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts', {
      method: 'POST',
      body: '{}',
    })
    expect(result.current.data?.draft.id).toBe('draft-1')
  })

  it('sends the seed fields when a composer opens from a record, and never orgId', async () => {
    jsonFetch.mockResolvedValue({ draft: draft('draft-1') })

    const { result } = renderCreateDraft()
    result.current.mutate({ orgId: 'org-1', toAddrs: ['ann@example.com'], recordId: 'rec-9' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // orgId names the tenant in the PATH. Repeating it in the body would put a
    // tenant key somewhere the server does not read and could drift.
    expect(JSON.parse(jsonFetch.mock.calls[0][1].body)).toEqual({
      toAddrs: ['ann@example.com'],
      recordId: 'rec-9',
    })
  })

  it('does not invalidate the drafts list, because the response is the new row', async () => {
    jsonFetch.mockResolvedValue({ draft: draft('draft-1') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderCreateDraft(client)
    result.current.mutate({ orgId: 'org-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
    // Nothing was seeded into the list cache by hand either: the dock adds the
    // card from the mutation result, and the cache is not a second source.
    expect(client.getQueryData(queryKeys.email.drafts('org-1'))).toBeUndefined()
  })

  it('surfaces the server own 409 sentence when the dock is full', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('You have 12 composers open. Close or discard one before starting another.', 409),
    )

    const { result } = renderCreateDraft()
    result.current.mutate({ orgId: 'org-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // The server names the limit. The hook must not restate or guess it.
    expect((result.current.error as ApiError).message).toBe(
      'You have 12 composers open. Close or discard one before starting another.',
    )
    expect((result.current.error as ApiError).status).toBe(409)
  })
})
