import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/queryKeys'
import type { ConnectionResponse } from '@/lib/integrationTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useRefreshIntegration } from '../useRefreshIntegration'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function refreshed(status: 'connected' | 'limited'): ConnectionResponse {
  return {
    connection: {
      id: 'conn-1',
      provider: 'google',
      providerAccountId: 'acct-1',
      emailAddress: 'rep@acme.com',
      scopes: [],
      status,
      errorCode: status === 'limited' ? 'partial_access' : null,
      statusDetail: null,
      lastValidatedAt: null,
      lastRefreshAt: '2026-08-20T12:00:00.000Z',
      expiresAt: null,
      createdAt: '2026-08-20T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
    },
  }
}

function renderRefresh(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useRefreshIntegration(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useRefreshIntegration', () => {
  it('POSTs to the refresh path and returns the re-evaluated connection', async () => {
    jsonFetch.mockResolvedValue(refreshed('connected'))

    const { result } = renderRefresh()
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/conn-1/refresh', {
      method: 'POST',
    })
    expect(result.current.data?.connection.status).toBe('connected')
  })

  it('invalidates the integrations prefix on settle', async () => {
    jsonFetch.mockResolvedValue(refreshed('limited'))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderRefresh(client)
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all('org-1') })
  })
})
