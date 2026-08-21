import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { Mailbox } from '@/lib/mailboxTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetMailboxes } from '../useGetMailboxes'

// Only the transport is mocked. The hook's job is the URL it builds, the key it caches
// under, and the enabled gate.
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

function renderGetMailboxes(
  orgId: string | null | undefined,
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetMailboxes(orgId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetMailboxes', () => {
  it('reads the org-scoped path and returns the mailboxes the server built', async () => {
    jsonFetch.mockResolvedValue({ mailboxes: [mailbox('mb-1', true), mailbox('mb-2', false)] })

    const { result } = renderGetMailboxes('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/mailboxes/orgs/org-1')
    expect(result.current.data?.mailboxes).toHaveLength(2)
    expect(result.current.data?.mailboxes[0].isPrimary).toBe(true)
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetMailboxes(null)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized key, so an invalidation reaches it', async () => {
    jsonFetch.mockResolvedValue({ mailboxes: [] })

    const { client, result } = renderGetMailboxes('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.mailboxes.list('org-1'))).toBeDefined()
  })

  it('surfaces the server own message when the read is forbidden', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetMailboxes('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
