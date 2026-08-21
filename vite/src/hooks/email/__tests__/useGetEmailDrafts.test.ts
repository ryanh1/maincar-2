import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { EmailDraft } from '@/lib/emailTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetEmailDrafts } from '../useGetEmailDrafts'

// Only the transport is mocked. The hook's job is the URL, the key, and the
// enabled gate, so a real fetch would only add a network to the assertions.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function draft(id: string, subject: string): EmailDraft {
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

function renderGetDrafts(orgId: string | null | undefined, client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetEmailDrafts(orgId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetEmailDrafts', () => {
  it('reads this org drafts from the org-scoped path', async () => {
    const drafts = [draft('draft-old', 'Quote'), draft('draft-new', 'Re: Quote')]
    jsonFetch.mockResolvedValue({ drafts, total: 2 })

    const { result } = renderGetDrafts('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts')
    // The route returns them oldest first and the hook hands them through
    // untouched, because the dock lays cards out left to right.
    expect(result.current.data?.drafts.map((d) => d.id)).toEqual(['draft-old', 'draft-new'])
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetDrafts(null)

    // 'idle' is the disabled state: pending with nothing in flight. Without the
    // gate this would request /api/email/orgs/null/drafts.
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('does not fire while the org is still undefined', () => {
    const { result } = renderGetDrafts(undefined)

    expect(result.current.fetchStatus).toBe('idle')
    expect(jsonFetch).not.toHaveBeenCalled()
  })

  it('caches under the centralized key, so an invalidation reaches it', async () => {
    jsonFetch.mockResolvedValue({ drafts: [draft('draft-1', 'Quote')], total: 1 })

    const { client, result } = renderGetDrafts('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.email.drafts('org-1'))).toEqual({
      drafts: [draft('draft-1', 'Quote')],
      total: 1,
    })
  })

  it('keys by org, so switching organizations does not show the previous one drafts', async () => {
    jsonFetch.mockResolvedValue({ drafts: [draft('draft-1', 'Quote')], total: 1 })
    const client = makeTestQueryClient()

    const first = renderGetDrafts('org-1', client)
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))

    jsonFetch.mockResolvedValue({ drafts: [draft('draft-2', 'Other org')], total: 1 })
    const second = renderGetDrafts('org-2', client)
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))

    expect(jsonFetch).toHaveBeenNthCalledWith(2, '/api/email/orgs/org-2/drafts')
    expect(client.getQueryData(queryKeys.email.drafts('org-1'))).toBeDefined()
    expect(second.result.current.data?.drafts[0].id).toBe('draft-2')
  })

  it('surfaces the server own message when the read fails', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetDrafts('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
