import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useDisconnectIntegration } from '../useDisconnectIntegration'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function renderDisconnect(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useDisconnectIntegration(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useDisconnectIntegration', () => {
  it('DELETEs the org-scoped connection path', async () => {
    jsonFetch.mockResolvedValue(undefined)

    const { result } = renderDisconnect()
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/conn-1', {
      method: 'DELETE',
    })
  })

  it('invalidates the integrations prefix on settle, clearing the card and the badge', async () => {
    jsonFetch.mockResolvedValue(undefined)
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderDisconnect(client)
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all('org-1') })
  })

  it('surfaces the server own message when the connection is not the caller own', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Connection not found', 404))

    const { result } = renderDisconnect()
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(404)
  })
})
