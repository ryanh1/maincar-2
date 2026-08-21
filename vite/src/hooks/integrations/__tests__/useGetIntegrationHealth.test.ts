import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/queryKeys'
import type { BrokenConnection } from '@/lib/integrationTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetIntegrationHealth } from '../useGetIntegrationHealth'

// Only the transport is mocked. The hook's job is the URL it builds, the key it
// caches under, and the enabled gate.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function broken(id: string): BrokenConnection {
  return {
    connectionId: id,
    provider: 'google',
    providerLabel: 'Google',
    emailAddress: 'rep@acme.com',
    errorCode: 'token_revoked',
    detail: 'Reconnect to restore access.',
  }
}

function renderGetHealth(
  orgId: string | null | undefined,
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetIntegrationHealth(orgId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetIntegrationHealth', () => {
  it('reads the health path and returns the broken connections', async () => {
    jsonFetch.mockResolvedValue({ broken: [broken('conn-1')] })

    const { result } = renderGetHealth('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/health')
    expect(result.current.data?.broken[0].connectionId).toBe('conn-1')
  })

  it('reads an empty list as data, not an error', async () => {
    jsonFetch.mockResolvedValue({ broken: [] })

    const { result } = renderGetHealth('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.broken).toEqual([])
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetHealth(null)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized health key', async () => {
    jsonFetch.mockResolvedValue({ broken: [] })

    const { client, result } = renderGetHealth('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.integrations.health('org-1'))).toBeDefined()
  })
})
