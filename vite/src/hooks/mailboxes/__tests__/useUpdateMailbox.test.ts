import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { Mailbox } from '@/lib/mailboxTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useUpdateMailbox } from '../useUpdateMailbox'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function mailbox(displayName: string | null): Mailbox {
  return {
    id: 'mb-1',
    provider: 'google',
    providerLabel: 'Google',
    emailAddress: 'mb-1@acme.com',
    displayName,
    isPrimary: true,
    status: 'connected',
    statusDetail: '',
    errorCode: null,
    lastValidatedAt: null,
    connectionId: 'conn-mb-1',
    connectedAt: '2026-08-20T12:00:00.000Z',
  }
}

function renderUpdate(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useUpdateMailbox(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useUpdateMailbox', () => {
  it('PATCHes the mailbox path with the display name in the body', async () => {
    jsonFetch.mockResolvedValue({ mailbox: mailbox('Work inbox') })

    const { result } = renderUpdate()
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1', displayName: 'Work inbox' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/mailboxes/orgs/org-1/mb-1', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Work inbox' }),
    })
  })

  it('sends null to clear the name', async () => {
    jsonFetch.mockResolvedValue({ mailbox: mailbox(null) })

    const { result } = renderUpdate()
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1', displayName: null })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/mailboxes/orgs/org-1/mb-1', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: null }),
    })
  })

  it('invalidates the mailboxes prefix on settle, so the rename shows', async () => {
    jsonFetch.mockResolvedValue({ mailbox: mailbox('Work inbox') })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderUpdate(client)
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1', displayName: 'Work inbox' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.mailboxes.all('org-1') })
  })

  it('surfaces the server own message when the name is too long', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('A mailbox name must be 80 characters or fewer.', 400),
    )

    const { result } = renderUpdate()
    result.current.mutate({ orgId: 'org-1', mailboxId: 'mb-1', displayName: 'x'.repeat(200) })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'A mailbox name must be 80 characters or fewer.',
    )
    expect((result.current.error as ApiError).status).toBe(400)
  })
})
