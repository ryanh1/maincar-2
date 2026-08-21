import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { TestConnectionResponse } from '@/lib/integrationTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'
import { useTestIntegration } from '../useTestIntegration'

const jsonFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})

function testResult(ok: boolean): TestConnectionResponse {
  return {
    result: {
      ok,
      detail: ok ? 'Every permission is working.' : 'Send email is not allowed.',
      errorCode: ok ? null : 'partial_access',
      capabilities: [
        { capability: 'read_email', label: 'Read email', ok: true, reason: '', errorCode: null },
        {
          capability: 'send_email',
          label: 'Send email',
          ok,
          reason: ok ? '' : 'Send email is not allowed.',
          errorCode: ok ? null : 'partial_access',
        },
        { capability: 'calendar', label: 'See your calendar', ok: true, reason: '', errorCode: null },
      ],
      connection: null,
    },
  }
}

function renderTest(client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => withProviders(children, { client })
  return { client, ...renderHook(() => useTestIntegration(), { wrapper }) }
}

beforeEach(() => {
  jsonFetch.mockReset()
})

describe('useTestIntegration', () => {
  it('POSTs to the connection test path and returns a verdict per capability', async () => {
    jsonFetch.mockResolvedValue(testResult(false))

    const { result } = renderTest()
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(jsonFetch).toHaveBeenCalledWith('/api/integrations/orgs/org-1/conn-1/test', {
      method: 'POST',
    })
    // A broken capability is data, not an error — the rep learns which one failed.
    expect(result.current.data?.result.ok).toBe(false)
    expect(result.current.data?.result.capabilities).toHaveLength(3)
    expect(result.current.data?.result.capabilities[1].ok).toBe(false)
  })

  it('invalidates the integrations prefix on settle so the card re-reads the written verdict', async () => {
    jsonFetch.mockResolvedValue(testResult(true))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderTest(client)
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all('org-1') })
  })

  it('still invalidates when the request itself fails, resyncing the cards', async () => {
    jsonFetch.mockRejectedValue(new ApiError('Something went wrong. Please try again.', 500))
    const client = makeTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderTest(client)
    result.current.mutate({ orgId: 'org-1', connectionId: 'conn-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // 5xx surfaces the generic message jsonFetch builds, never a server stack trace.
    expect((result.current.error as ApiError).message).toBe('Something went wrong. Please try again.')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all('org-1') })
  })
})
