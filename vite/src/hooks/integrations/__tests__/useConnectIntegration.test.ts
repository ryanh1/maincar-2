import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useConnectIntegration } from '../useConnectIntegration'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderConnect(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useConnectIntegration(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useConnectIntegration', () => {
  it('POSTs mode to the provider authorize path and returns the consent URL', async () => {
    jsonFetch.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' })

    const { result } = renderConnect()
    result.current.mutate({ orgId: 'org-1', provider: 'google', mode: 'connect' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/google/authorize', {
      method: 'POST',
      body: JSON.stringify({ mode: 'connect', connectionId: undefined }),
    })
    expect(result.current.data?.url).toContain('accounts.google.com')
  })

  it('carries the connectionId when repairing a limited connection', async () => {
    jsonFetch.mockResolvedValue({ url: 'https://login.microsoftonline.com/x' })

    const { result } = renderConnect()
    result.current.mutate({
      orgId: 'org-1',
      provider: 'microsoft',
      mode: 'fix',
      connectionId: 'conn-9',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/microsoft/authorize', {
      method: 'POST',
      body: JSON.stringify({ mode: 'fix', connectionId: 'conn-9' }),
    })
  })

  it('invalidates the integrations prefix on success, refreshing cards and badge together', async () => {
    jsonFetch.mockResolvedValue({ url: 'https://accounts.google.com/x' })
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderConnect(client)
    result.current.mutate({ orgId: 'org-1', provider: 'google', mode: 'connect' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all('org-1') })
  })

  it('surfaces the server own message on a 4xx', async () => {
    jsonFetch.mockRejectedValue(
      new ApiError('This connection has every permission already.', 400),
    )

    const { result } = renderConnect()
    result.current.mutate({ orgId: 'org-1', provider: 'google', mode: 'fix', connectionId: 'c' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'This connection has every permission already.',
    )
  })
})
