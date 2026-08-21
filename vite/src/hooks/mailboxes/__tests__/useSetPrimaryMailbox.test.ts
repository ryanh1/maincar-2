import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { Mailbox } from '@/lib/mailboxTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useSetPrimaryMailbox } from '../useSetPrimaryMailbox'

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
    errorCode: null,
    lastValidatedAt: null,
    connectionId: `conn-${id}`,
    connectedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderSetPrimary(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useSetPrimaryMailbox(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useSetPrimaryMailbox', () => {
  it('POSTs the org- and mailbox-scoped primary path', async () => {
    jsonFetch.mockResolvedValue({ mailboxes: [] })

    const { result } = renderSetPrimary()
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-2' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/mailboxes/orgs/org-1/mb-2/primary', {
      method: 'POST',
    })
  })

  it('writes the returned whole list into the cache wholesale, so the badge never shows two primaries', async () => {
    // Promoting mb-2 must replace the list wholesale, not merge — a merge could leave
    // both flagged for an instant. We spy on setQueryData to prove the WHOLE server
    // response lands under the list key (the test client GCs an unobserved entry, so
    // reading it back afterward is not the reliable assertion — the write itself is).
    const client = makeTestQueryClient()
    const promoted = { mailboxes: [mailbox('mb-1', false), mailbox('mb-2', true)] }
    jsonFetch.mockResolvedValue(promoted)
    const setData = vi.spyOn(client, 'setQueryData')

    const { result } = renderSetPrimary(client)
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-2' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(setData).toHaveBeenCalledWith(queryKeys.mailboxes.list('org-1'), promoted)
    expect(result.current.data?.mailboxes.filter((m) => m.isPrimary)).toHaveLength(1)
    expect(result.current.data?.mailboxes.find((m) => m.isPrimary)?.id).toBe('mb-2')
  })

  it('writes nothing to the cache when the promote fails, leaving the previous list intact', async () => {
    const client = makeTestQueryClient()
    jsonFetch.mockRejectedValue(new ApiError('Mailbox not found', 404))
    const setData = vi.spyOn(client, 'setQueryData')

    const { result } = renderSetPrimary(client)
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-2' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(404)
    expect(setData).not.toHaveBeenCalled()
  })
})
