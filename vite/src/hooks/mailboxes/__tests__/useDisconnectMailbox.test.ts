import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { Mailbox } from '@/lib/mailboxTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useDisconnectMailbox } from '../useDisconnectMailbox'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function mailbox(id: string, isPrimary: boolean): Mailbox {
  return {
    id,
    provider: 'google',
    providerLabel: 'Google',
    emailAddress: `${id}@acme.com`,
    displayName: null,
    isPrimary,
    status: 'connected',
    statusDetail: '',
    connectionId: `conn-${id}`,
    connectedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderDisconnect(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useDisconnectMailbox(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useDisconnectMailbox', () => {
  it('DELETEs the org- and mailbox-scoped path', async () => {
    jsonFetch.mockResolvedValue({ mailboxes: [] })

    const { result } = renderDisconnect()
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/mailboxes/orgs/org-1/mb-1', {
      method: 'DELETE',
    })
  })

  it('writes the returned remaining list into the cache wholesale, promoting the newest with no gap', async () => {
    // Deleting mb-1 (primary) returns mb-2 promoted — the whole remaining list, written
    // wholesale so there is never a window with no primary. We spy on setQueryData to
    // prove the whole server response lands under the list key (the test client GCs an
    // unobserved entry, so the write itself is the reliable assertion).
    const client = makeTestQueryClient()
    const remaining = { mailboxes: [mailbox('mb-2', true)] }
    jsonFetch.mockResolvedValue(remaining)
    const setData = vi.spyOn(client, 'setQueryData')

    const { result } = renderDisconnect(client)
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(setData).toHaveBeenCalledWith(queryKeys.mailboxes.list('org-1'), remaining)
    expect(result.current.data?.mailboxes).toHaveLength(1)
    expect(result.current.data?.mailboxes.filter((m) => m.isPrimary)).toHaveLength(1)
    expect(result.current.data?.mailboxes[0].id).toBe('mb-2')
  })

  it('writes nothing to the cache when the delete fails, leaving the previous list intact', async () => {
    const client = makeTestQueryClient()
    jsonFetch.mockRejectedValue(new ApiError('Mailbox not found', 404))
    const setData = vi.spyOn(client, 'setQueryData')

    const { result } = renderDisconnect(client)
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(404)
    expect(setData).not.toHaveBeenCalled()
  })
})
