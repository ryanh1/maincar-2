import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { IntegrationCard } from '@/lib/integrationTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useGetIntegrations } from '../useGetIntegrations'

// Only the transport is mocked. The hook's job is the URL it builds, the key it
// caches under, and the enabled gate.
const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function googleCard(connected: boolean): IntegrationCard {
  const connection = connected
    ? {
        id: 'conn-1',
        provider: 'google',
        providerAccountId: 'acct-1',
        emailAddress: 'rep@acme.com',
        scopes: [],
        status: 'connected' as const,
        errorCode: null,
        statusDetail: null,
        lastValidatedAt: '2026-08-20T12:00:00.000Z',
        lastRefreshAt: null,
        expiresAt: null,
        createdAt: '2026-08-20T12:00:00.000Z',
        updatedAt: '2026-08-20T12:00:00.000Z',
      }
    : null
  return {
    provider: 'google',
    providerLabel: 'Google Workspace',
    providerShortName: 'Google',
    requiredPermissions: ['Read email', 'Send email', 'See your calendar'],
    connections: connection ? [connection] : [],
    connection,
  }
}

function renderGetIntegrations(
  orgId: string | null | undefined,
  client: QueryClient = makeTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useGetIntegrations(orgId), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useGetIntegrations', () => {
  it('reads the org-scoped path and returns the cards the server built', async () => {
    jsonFetch.mockResolvedValue({ integrations: [googleCard(true), googleCard(false)] })

    const { result } = renderGetIntegrations('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1')
    expect(result.current.data?.integrations).toHaveLength(2)
    expect(result.current.data?.integrations[0].connection?.emailAddress).toBe('rep@acme.com')
    expect(result.current.data?.integrations[1].connection).toBeNull()
  })

  it('does not fire without an org', async () => {
    const { result } = renderGetIntegrations(null)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(jsonFetch).not.toHaveBeenCalled())
  })

  it('caches under the centralized key, so an invalidation reaches it', async () => {
    jsonFetch.mockResolvedValue({ integrations: [] })

    const { client, result } = renderGetIntegrations('org-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.integrations.list('org-1'))).toBeDefined()
  })

  it('surfaces the server own message when the read is forbidden', async () => {
    jsonFetch.mockRejectedValue(new ApiError('You are not a member of this organization.', 403))

    const { result } = renderGetIntegrations('org-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).message).toBe(
      'You are not a member of this organization.',
    )
    expect((result.current.error as ApiError).status).toBe(403)
  })
})
